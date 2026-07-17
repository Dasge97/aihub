import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

import asyncpg
import httpx

from .config import settings

log = logging.getLogger("aihub.jobs")

JobHandler = Callable[[dict], Awaitable[dict]]
"""Recibe la fila del job (dict) y devuelve el `result` (contrato de la capacidad)."""


async def enqueue(
    pool: asyncpg.Pool,
    capability: str,
    op: str,
    payload: dict,
    api_key_id: int | None,
    model_alias: str = "default",
    source: str = "app",
    webhook_url: str | None = None,
) -> str:
    job_id = str(uuid.uuid4())
    await pool.execute(
        """
        INSERT INTO jobs (id, capability, op, api_key_id, source, model_alias,
                          payload, webhook_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        """,
        job_id, capability, op, api_key_id, source, model_alias, payload, webhook_url,
    )
    return job_id


def job_public_view(row: dict, include_result: bool = True) -> dict:
    out = {
        "job_id": str(row["id"]),
        "capability": row["capability"],
        "status": row["status"],
        "created_at": _iso(row["created_at"]),
        "started_at": _iso(row["started_at"]),
        "finished_at": _iso(row["finished_at"]),
        "error": row["error"],
    }
    if include_result:
        out["result"] = row["result"]
    return out


def _iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


async def _post_webhook(url: str, body: dict, job_id: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(url, json=body, headers={"X-AIHub-Job-Id": job_id})
    except Exception as e:
        log.warning("webhook falló", extra={"ctx": {"job_id": job_id, "error": str(e)}})


def _cleanup_files(payload: dict) -> None:
    path = payload.get("file_path")
    if path:
        Path(path).unlink(missing_ok=True)


async def run_workers(
    pool: asyncpg.Pool, capability: str, handler: JobHandler,
    concurrency: int | None = None,
) -> list[asyncio.Task]:
    n = concurrency or settings.job_concurrency
    return [
        asyncio.create_task(_worker_loop(pool, capability, handler, i))
        for i in range(n)
    ]


async def _worker_loop(
    pool: asyncpg.Pool, capability: str, handler: JobHandler, worker_id: int
) -> None:
    while True:
        try:
            job = await _claim(pool, capability)
            if job is None:
                await asyncio.sleep(settings.job_poll_s)
                continue
            await _execute(pool, job, handler)
        except asyncio.CancelledError:
            return
        except Exception:
            log.exception("error en worker", extra={"ctx": {"worker": worker_id}})
            await asyncio.sleep(settings.job_poll_s)


async def _claim(pool: asyncpg.Pool, capability: str) -> dict | None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT * FROM jobs
                WHERE capability=$1 AND status='queued'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """,
                capability,
            )
            if row is None:
                return None
            await conn.execute(
                "UPDATE jobs SET status='running', started_at=now(), "
                "attempts=attempts+1 WHERE id=$1",
                row["id"],
            )
            return dict(row)


async def _execute(pool: asyncpg.Pool, job: dict, handler: JobHandler) -> None:
    job_id = job["id"]
    log.info("job iniciado", extra={"ctx": {"job_id": str(job_id), "op": job["op"]}})
    try:
        result = await handler(job)
        await pool.execute(
            """
            UPDATE jobs SET status='succeeded', result=$2, finished_at=now(),
              latency_ms=(EXTRACT(EPOCH FROM (now()-started_at))*1000)::int
            WHERE id=$1
            """,
            job_id, result,
        )
    except Exception as e:
        code = getattr(e, "code", "job_failed")
        message = getattr(e, "message", str(e))
        log.exception("job falló", extra={"ctx": {"job_id": str(job_id)}})
        await pool.execute(
            """
            UPDATE jobs SET status='failed', error=$2, finished_at=now(),
              latency_ms=(EXTRACT(EPOCH FROM (now()-started_at))*1000)::int
            WHERE id=$1
            """,
            job_id, {"code": code, "message": message},
        )
    finally:
        _cleanup_files(job.get("payload") or {})
    if job.get("webhook_url"):
        row = await pool.fetchrow("SELECT * FROM jobs WHERE id=$1", job_id)
        await _post_webhook(job["webhook_url"], job_public_view(dict(row)), str(job_id))
