import asyncio
import hashlib
import time

import asyncpg
from fastapi import Request

from aihub_kit.errors import ApiError

_CACHE_TTL = 30.0
_cache: dict[str, tuple[float, dict | None]] = {}
_last_touch: dict[int, float] = {}


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def authenticate(request: Request, pool: asyncpg.Pool) -> dict:
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise ApiError(401, "unauthorized", "Falta la cabecera Authorization: Bearer <clave>")
    raw = header.removeprefix("Bearer ").strip()
    digest = hash_key(raw)
    now = time.monotonic()
    cached = _cache.get(digest)
    if cached and now - cached[0] < _CACHE_TTL:
        row = cached[1]
    else:
        rec = await pool.fetchrow(
            "SELECT * FROM api_keys WHERE key_hash=$1 AND enabled", digest
        )
        row = dict(rec) if rec else None
        _cache[digest] = (now, row)
    if row is None:
        raise ApiError(401, "unauthorized", "Clave API inválida o deshabilitada")
    # last_used_at: como mucho una escritura por minuto y clave
    if now - _last_touch.get(row["id"], 0) > 60:
        _last_touch[row["id"]] = now
        asyncio.get_running_loop().create_task(
            pool.execute("UPDATE api_keys SET last_used_at=now() WHERE id=$1", row["id"])
        )
    return row


def check_scope(key: dict, capability: str) -> None:
    scopes = key["scopes"] or []
    if "*" not in scopes and capability not in scopes:
        raise ApiError(
            403, "forbidden",
            f"La clave '{key['name']}' no tiene acceso a la capacidad '{capability}'",
        )
