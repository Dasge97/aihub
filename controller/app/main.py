import asyncio
import logging
import os
from contextlib import asynccontextmanager

import httpx
import psutil
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from aihub_kit.config import settings
from aihub_kit.db import create_pool, migrate
from aihub_kit.errors import ApiError, install_error_handlers
from aihub_kit.logging import setup_logging

from . import adminauth, dockerctl
from .janitor import janitor_loop

log = logging.getLogger("aihub.controller")
state: dict = {}

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

# Rutas públicas (sin auth): el propio login.
PUBLIC_PATHS = {"/admin/login"}


async def admin_auth(request: Request) -> None:
    if request.url.path in PUBLIC_PATHS:
        return
    header = request.headers.get("authorization", "")
    token = header.removeprefix("Bearer ").strip()
    identity = await adminauth.resolve(state["pool"], token)
    if identity is None:
        raise ApiError(401, "unauthorized", "Sesión no válida")
    request.state.identity = identity


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)
    if not ADMIN_TOKEN:
        log.error("ADMIN_TOKEN no configurado: la API admin rechazará todo")
    pool = await create_pool()
    await migrate(pool)
    state.update(pool=pool, client=httpx.AsyncClient())
    await adminauth.seed_admin(pool)
    janitor = asyncio.create_task(janitor_loop(pool))
    log.info("controller arrancado")
    yield
    janitor.cancel()
    await state["client"].aclose()
    await pool.close()


app = FastAPI(title="AI Hub Controller", lifespan=lifespan,
              dependencies=[Depends(admin_auth)])
install_error_handlers(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def service_health(service_url: str) -> dict | None:
    try:
        r = await state["client"].get(f"{service_url}/health", timeout=3)
        return r.json()
    except Exception:
        return None


from . import routes_data  # noqa: E402  (necesita `app`/`state` ya definidos)

app.include_router(routes_data.router)


@app.post("/admin/login")
async def login(body: dict):
    return await adminauth.login(
        state["pool"], body.get("username", ""), body.get("password", "")
    )


@app.post("/admin/logout")
async def logout(request: Request):
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    await adminauth.logout(state["pool"], token)
    return {"ok": True}


@app.post("/admin/change-password")
async def change_password(request: Request, body: dict):
    identity = request.state.identity
    await adminauth.change_password(
        state["pool"], identity["user_id"],
        body.get("current", ""), body.get("new", ""),
    )
    return {"ok": True}


@app.get("/admin/me")
async def me(request: Request):
    identity = getattr(request.state, "identity", {})
    return {"ok": True, "component": "controller",
            "username": identity.get("username", "")}


@app.get("/admin/overview")
async def overview():
    pool = state["pool"]
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    caps = [dict(r) for r in await pool.fetch("SELECT * FROM capabilities ORDER BY id")]
    healths = await asyncio.gather(*(service_health(c["service_url"]) for c in caps))
    services = []
    for cap, health in zip(caps, healths):
        services.append({
            "capability": cap["id"], "title": cap["title"], "mode": cap["mode"],
            "enabled": cap["enabled"],
            "container_status": dockerctl.container_status(cap["container"]),
            "health": health,
        })
    stats = await pool.fetchrow(
        """SELECT count(*) AS requests,
                  count(*) FILTER (WHERE status >= 400) AS errors,
                  coalesce(avg(latency_ms), 0)::int AS avg_latency_ms
           FROM request_logs WHERE ts > now() - interval '24 hours'"""
    )
    by_cap = await pool.fetch(
        """SELECT capability, count(*) AS requests,
                  coalesce(avg(latency_ms), 0)::int AS avg_latency_ms
           FROM request_logs WHERE ts > now() - interval '24 hours'
           GROUP BY capability ORDER BY requests DESC"""
    )
    return {
        "system": {
            "cpu_pct": psutil.cpu_percent(interval=0.2),
            "ram_total_mb": round(vm.total / 1024 / 1024),
            "ram_used_mb": round((vm.total - vm.available) / 1024 / 1024),
            "ram_available_mb": round(vm.available / 1024 / 1024),
            "disk_used_gb": round(disk.used / 1024**3, 1),
            "disk_total_gb": round(disk.total / 1024**3, 1),
            "gpu": None,
        },
        "containers": dockerctl.list_aihub_containers(),
        "services": services,
        "stats_24h": dict(stats) if stats else {},
        "stats_24h_by_capability": [dict(r) for r in by_cap],
    }


@app.get("/admin/capabilities")
async def list_capabilities():
    pool = state["pool"]
    caps = [dict(r) for r in await pool.fetch("SELECT * FROM capabilities ORDER BY id")]
    healths = await asyncio.gather(*(service_health(c["service_url"]) for c in caps))
    for cap, health in zip(caps, healths):
        cap["container_status"] = dockerctl.container_status(cap["container"])
        cap["health"] = health
        cap["updated_at"] = str(cap["updated_at"])
    return {"capabilities": caps}


@app.patch("/admin/capabilities/{cap_id}")
async def patch_capability(cap_id: str, body: dict):
    pool = state["pool"]
    cap = await pool.fetchrow("SELECT * FROM capabilities WHERE id=$1", cap_id)
    if cap is None:
        raise ApiError(404, "not_found", f"Capacidad '{cap_id}' no existe")
    if "default_model" in body:
        row = await pool.fetchrow(
            "SELECT 1 FROM models WHERE capability=$1 AND alias=$2 AND enabled",
            cap_id, body["default_model"],
        )
        if row is None:
            raise ApiError(400, "invalid_request",
                           f"No hay modelo habilitado con alias '{body['default_model']}'")
        await pool.execute(
            "UPDATE capabilities SET default_model=$2, updated_at=now() WHERE id=$1",
            cap_id, body["default_model"],
        )
    if "enabled" in body:
        enabled = bool(body["enabled"])
        await pool.execute(
            "UPDATE capabilities SET enabled=$2, updated_at=now() WHERE id=$1",
            cap_id, enabled,
        )
        try:
            await asyncio.to_thread(
                dockerctl.start if enabled else dockerctl.stop, cap["container"]
            )
        except Exception as e:
            raise ApiError(502, "docker_error",
                           f"No se pudo {'arrancar' if enabled else 'parar'} "
                           f"{cap['container']}: {e}")
    return {"ok": True}


@app.post("/admin/playground/{cap_id}")
async def playground(cap_id: str, request: Request):
    """Prueba una operación contra uno o varios modelos y compara resultados.
    Acepta JSON {op, payload, models} o multipart (file + request)."""
    from aihub_kit.jobs import enqueue

    pool = state["pool"]
    cap = await pool.fetchrow("SELECT * FROM capabilities WHERE id=$1", cap_id)
    if cap is None:
        raise ApiError(404, "not_found", f"Capacidad '{cap_id}' no existe")

    content_type = request.headers.get("content-type", "")
    file_path = None
    if content_type.startswith("multipart/"):
        import json as _json
        import uuid as _uuid
        from pathlib import Path

        form = await request.form()
        body = _json.loads(form.get("request") or "{}")
        upload = form.get("file")
        if upload is not None and hasattr(upload, "filename"):
            uploads = Path(settings.data_dir) / "uploads"
            uploads.mkdir(parents=True, exist_ok=True)
            dest = uploads / f"pg-{_uuid.uuid4()}{Path(upload.filename or '').suffix}"
            dest.write_bytes(await upload.read())
            file_path = str(dest)
    else:
        body = await request.json()

    op = body.get("op") or (cap["routes"][0]["op"] if cap["routes"] else "")
    aliases = body.get("models") or ["default"]
    payload = body.get("payload") or {}
    if file_path:
        payload["file_path"] = file_path
    run_async = bool(body.get("as_job"))

    results = []
    try:
        for alias in aliases:  # secuencial a propósito: no cargar 2 modelos a la vez
            if run_async:
                job_id = await enqueue(pool, cap_id, op, dict(payload), None,
                                       model_alias=alias, source="playground")
                results.append({"model": alias, "job_id": job_id, "status": "queued"})
                continue
            import time
            t0 = time.monotonic()
            try:
                r = await state["client"].post(
                    f"{cap['service_url']}/invoke",
                    json={"op": op, "model": alias, "payload": payload,
                          "meta": {"source": "playground"}},
                    timeout=600,
                )
                entry = {"model": alias, "status": r.status_code,
                         "latency_ms": int((time.monotonic() - t0) * 1000),
                         "body": r.json()}
            except httpx.HTTPError as e:
                entry = {"model": alias, "status": 502,
                         "latency_ms": int((time.monotonic() - t0) * 1000),
                         "body": {"error": {"code": "capability_unavailable",
                                            "message": str(e)}}}
            results.append(entry)
            await pool.execute(
                """INSERT INTO request_logs (source, capability, op, model_alias,
                     status, latency_ms, error_code)
                   VALUES ('playground',$1,$2,$3,$4,$5,$6)""",
                cap_id, op, alias, entry["status"], entry["latency_ms"],
                None if entry["status"] < 400 else "playground_error",
            )
    finally:
        if file_path and not run_async:
            from pathlib import Path
            Path(file_path).unlink(missing_ok=True)
    return {"results": results}
