import logging
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from aihub_kit.config import settings
from aihub_kit.db import create_pool, migrate
from aihub_kit.errors import ApiError, install_error_handlers
from aihub_kit.jobs import job_public_view
from aihub_kit.logging import setup_logging

from .auth import authenticate, check_scope
from .dispatch import RouteTable, build_payload, dispatch
from .ratelimit import check_rate_limit

log = logging.getLogger("aihub.gateway")
state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)
    pool = await create_pool()
    await migrate(pool)
    state.update(
        pool=pool,
        client=httpx.AsyncClient(),
        routes=RouteTable(pool),
    )
    log.info("gateway arrancado")
    yield
    await state["client"].aclose()
    await pool.close()


app = FastAPI(title="AI Hub Gateway", lifespan=lifespan)
install_error_handlers(app)


def _log_request(key_id, capability, op, model_alias, status, latency_ms,
                 error_code, request_id, source="app"):
    import asyncio

    asyncio.get_running_loop().create_task(
        state["pool"].execute(
            """INSERT INTO request_logs (api_key_id, source, capability, op,
                 model_alias, status, latency_ms, error_code, request_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
            key_id, source, capability, op, model_alias, status, latency_ms,
            error_code, request_id,
        )
    )


@app.get("/health")
async def health():
    return {"status": "ok", "component": "gateway"}


@app.get("/v1/capabilities")
async def capabilities(request: Request):
    await authenticate(request, state["pool"])
    return {"capabilities": await state["routes"].capabilities()}


@app.get("/v1/jobs")
async def list_jobs(request: Request, status: str | None = None, limit: int = 50):
    key = await authenticate(request, state["pool"])
    limit = min(limit, 200)
    query = "SELECT * FROM jobs WHERE api_key_id=$1"
    args: list = [key["id"]]
    if status:
        query += " AND status=$2"
        args.append(status)
    query += f" ORDER BY created_at DESC LIMIT {limit}"
    rows = await state["pool"].fetch(query, *args)
    return {"jobs": [job_public_view(dict(r), include_result=False) for r in rows]}


@app.get("/v1/jobs/{job_id}")
async def get_job(request: Request, job_id: uuid.UUID):
    key = await authenticate(request, state["pool"])
    row = await state["pool"].fetchrow(
        "SELECT * FROM jobs WHERE id=$1 AND api_key_id=$2", job_id, key["id"]
    )
    if row is None:
        raise ApiError(404, "not_found", "Job no encontrado")
    return job_public_view(dict(row))


@app.post("/v1/{rest:path}")
async def invoke_capability(request: Request, rest: str):
    t0 = time.monotonic()
    request_id = uuid.uuid4().hex[:16]
    path = f"/v1/{rest}"
    key = await authenticate(request, state["pool"])
    cap, route = await state["routes"].resolve(path)
    check_scope(key, cap["id"])
    check_rate_limit(key)
    model_alias, status, error_code = "", 0, None
    try:
        payload = await build_payload(request, route)
        status, body, model_alias = await dispatch(
            state["pool"], state["client"], cap, route, payload, key, request_id
        )
        error_code = (body.get("error") or {}).get("code") if status >= 400 else None
        latency_ms = int((time.monotonic() - t0) * 1000)
        return JSONResponse(
            status_code=status, content=body,
            headers={"X-AIHub-Request-Id": request_id,
                     "X-AIHub-Latency-Ms": str(latency_ms)},
        )
    except ApiError as e:
        status, error_code = e.status, e.code
        raise
    finally:
        _log_request(
            key["id"], cap["id"], route["op"], model_alias, status,
            int((time.monotonic() - t0) * 1000), error_code, request_id,
        )
