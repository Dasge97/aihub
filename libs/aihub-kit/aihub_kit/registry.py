import time

import asyncpg

from .config import settings
from .manifest import ServiceManifest


async def sync_manifest(
    pool: asyncpg.Pool, manifest: ServiceManifest, service_url: str, container: str
) -> None:
    """Registra capacidad y modelos al arrancar el servicio.

    Upsert conservador: los campos que el panel puede editar (enabled,
    default_model, idle_unload_s, keep_warm, params) NO se pisan al re-registrar.
    """
    routes = [r.model_dump() for r in manifest.routes]
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO capabilities (id, title, mode, service_url, container, routes, default_model)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (id) DO UPDATE SET
              title=EXCLUDED.title, mode=EXCLUDED.mode,
              service_url=EXCLUDED.service_url, container=EXCLUDED.container,
              routes=EXCLUDED.routes, updated_at=now()
            """,
            manifest.capability, manifest.title, manifest.mode,
            service_url, container, routes, manifest.default_model,
        )
        for m in manifest.models:
            await conn.execute(
                """
                INSERT INTO models (capability, alias, model_id, adapter, version,
                                    framework, est_ram_mb, params, idle_unload_s, keep_warm)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (capability, alias) DO UPDATE SET
                  model_id=EXCLUDED.model_id, adapter=EXCLUDED.adapter,
                  version=EXCLUDED.version, framework=EXCLUDED.framework,
                  est_ram_mb=EXCLUDED.est_ram_mb
                """,
                manifest.capability, m.alias, m.model_id, m.adapter, m.version,
                m.framework, m.est_ram_mb, m.params, m.idle_unload_s, m.keep_warm,
            )


class CapabilityConfig:
    """Vista cacheada (TTL corto) de la configuración en BD de una capacidad.
    Es el mecanismo por el que los cambios hechos en el panel llegan al servicio
    sin reiniciarlo."""

    def __init__(self, pool: asyncpg.Pool, capability: str):
        self.pool = pool
        self.capability = capability
        self._cached_at = 0.0
        self._cap: dict = {}
        self._models: dict[str, dict] = {}

    async def refresh(self, force: bool = False) -> None:
        if not force and time.monotonic() - self._cached_at < settings.config_cache_s:
            return
        async with self.pool.acquire() as conn:
            cap = await conn.fetchrow(
                "SELECT * FROM capabilities WHERE id=$1", self.capability
            )
            rows = await conn.fetch(
                "SELECT * FROM models WHERE capability=$1", self.capability
            )
        self._cap = dict(cap) if cap else {}
        self._models = {r["alias"]: dict(r) for r in rows}
        self._cached_at = time.monotonic()

    async def resolve_alias(self, alias: str | None) -> dict:
        """'default' (o vacío) → modelo por defecto de la capacidad. Devuelve la fila
        del modelo. Lanza KeyError si no existe o está deshabilitado."""
        await self.refresh()
        alias = alias or "default"
        if alias == "default":
            alias = self._cap.get("default_model") or ""
        row = self._models.get(alias)
        if not row or not row["enabled"]:
            raise KeyError(alias)
        return row

    async def model(self, alias: str) -> dict | None:
        await self.refresh()
        return self._models.get(alias)

    async def all_models(self) -> dict[str, dict]:
        await self.refresh()
        return self._models

    async def default_alias(self) -> str:
        await self.refresh()
        return self._cap.get("default_model") or ""
