import asyncio
import logging
import time
from pathlib import Path

import asyncpg

from aihub_kit.config import settings

log = logging.getLogger("aihub.janitor")

DEFAULTS = {"jobs_retention_days": 7, "logs_retention_days": 90, "uploads_ttl_h": 24}


async def _setting(pool: asyncpg.Pool, key: str) -> int:
    row = await pool.fetchrow("SELECT value FROM settings WHERE key=$1", key)
    return int(row["value"]) if row else DEFAULTS[key]


async def janitor_loop(pool: asyncpg.Pool, interval_s: int = 3600) -> None:
    while True:
        try:
            jobs_days = await _setting(pool, "jobs_retention_days")
            logs_days = await _setting(pool, "logs_retention_days")
            uploads_h = await _setting(pool, "uploads_ttl_h")
            deleted_jobs = await pool.execute(
                "DELETE FROM jobs WHERE created_at < now() - make_interval(days => $1)",
                jobs_days,
            )
            deleted_logs = await pool.execute(
                "DELETE FROM request_logs WHERE ts < now() - make_interval(days => $1)",
                logs_days,
            )
            n_files = 0
            cutoff = time.time() - uploads_h * 3600
            for sub in ("uploads", "outputs"):
                d = Path(settings.data_dir) / sub
                if not d.exists():
                    continue
                for f in d.iterdir():
                    if f.is_file() and f.stat().st_mtime < cutoff:
                        f.unlink(missing_ok=True)
                        n_files += 1
            log.info("janitor", extra={"ctx": {
                "jobs": deleted_jobs, "logs": deleted_logs, "files": n_files}})
        except asyncio.CancelledError:
            return
        except Exception:
            log.exception("janitor falló")
        await asyncio.sleep(interval_s)
