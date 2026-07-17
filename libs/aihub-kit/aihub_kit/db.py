import asyncio
import importlib.resources
import json
import logging

import asyncpg

from .config import settings

log = logging.getLogger("aihub.db")

MIGRATION_LOCK = 748291  # advisory lock compartido por todos los componentes


async def _init_conn(conn: asyncpg.Connection) -> None:
    for typ in ("jsonb", "json"):
        await conn.set_type_codec(
            typ, encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )


async def create_pool(dsn: str | None = None, retries: int = 30) -> asyncpg.Pool:
    """Pool con reintentos: postgres puede tardar en estar listo al arrancar el stack."""
    dsn = dsn or settings.database_url
    last: Exception | None = None
    for _ in range(retries):
        try:
            return await asyncpg.create_pool(
                dsn, min_size=1, max_size=5, init=_init_conn
            )
        except (OSError, asyncpg.PostgresError) as e:
            last = e
            await asyncio.sleep(2)
    raise RuntimeError(f"No se pudo conectar a Postgres: {last}")


async def migrate(pool: asyncpg.Pool) -> None:
    """Aplica las migraciones SQL empaquetadas. Idempotente y protegida con
    advisory lock: cualquier componente puede ejecutarla al arrancar."""
    sql_dir = importlib.resources.files("aihub_kit") / "sql"
    files = sorted(f for f in sql_dir.iterdir() if f.name.endswith(".sql"))
    async with pool.acquire() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", MIGRATION_LOCK)
        try:
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations("
                "version int PRIMARY KEY, applied_at timestamptz DEFAULT now())"
            )
            applied = {
                r["version"]
                for r in await conn.fetch("SELECT version FROM schema_migrations")
            }
            for f in files:
                version = int(f.name.split("_")[0])
                if version in applied:
                    continue
                async with conn.transaction():
                    await conn.execute(f.read_text(encoding="utf-8"))
                    await conn.execute(
                        "INSERT INTO schema_migrations(version) VALUES($1)", version
                    )
                log.info("migración aplicada", extra={"ctx": {"version": version}})
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", MIGRATION_LOCK)
