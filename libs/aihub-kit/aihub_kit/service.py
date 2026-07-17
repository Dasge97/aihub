import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import psutil
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from . import jobs as jobs_mod
from .config import settings
from .db import create_pool, migrate
from .errors import ApiError, install_error_handlers
from .logging import setup_logging
from .manager import ModelManager, ModelState
from .manifest import ModelSpec, ServiceManifest
from .registry import CapabilityConfig, sync_manifest

log = logging.getLogger("aihub.service")


class InvokeRequest(BaseModel):
    op: str
    model: str | None = "default"
    payload: dict = Field(default_factory=dict)
    meta: dict = Field(default_factory=dict)  # source, api_key_id, request_id


def _spec_from_row(row: dict) -> ModelSpec:
    return ModelSpec(
        alias=row["alias"], model_id=row["model_id"], adapter=row["adapter"],
        version=row["version"], framework=row["framework"],
        est_ram_mb=row["est_ram_mb"], params=row["params"] or {},
        idle_unload_s=row["idle_unload_s"], keep_warm=row["keep_warm"],
    )


def create_app(service_dir: Path) -> FastAPI:
    setup_logging(settings.log_level)
    manifest = ServiceManifest.load(service_dir / "manifest.yaml")
    service_url = os.environ.get(
        "SERVICE_URL", f"http://svc-{manifest.capability}:8000"
    )
    container = os.environ.get("SERVICE_CONTAINER", f"aihub-svc-{manifest.capability}")
    has_async = any(r.mode in ("async", "auto") for r in manifest.routes)

    state: dict = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        pool = await create_pool()
        await migrate(pool)
        await sync_manifest(pool, manifest, service_url, container)
        config = CapabilityConfig(pool, manifest.capability)
        await config.refresh(force=True)
        manager = ModelManager(manifest.models, config, settings.models_dir)
        state.update(pool=pool, config=config, manager=manager)
        await manager.start_background()
        worker_tasks: list[asyncio.Task] = []
        if has_async:
            worker_tasks = await jobs_mod.run_workers(
                pool, manifest.capability, _make_job_handler(pool, config, manager)
            )
        log.info("servicio arrancado", extra={"ctx": {"capability": manifest.capability}})
        yield
        for t in worker_tasks:
            t.cancel()
        await manager.stop_background()
        await manager.unload_all()
        await pool.close()

    app = FastAPI(title=f"aihub-svc-{manifest.capability}", lifespan=lifespan)
    install_error_handlers(app)

    async def _resolve(alias: str | None) -> ModelState:
        config: CapabilityConfig = state["config"]
        manager: ModelManager = state["manager"]
        try:
            row = await config.resolve_alias(alias)
        except KeyError:
            raise ApiError(404, "not_found", f"Modelo '{alias}' no disponible")
        if row["alias"] not in manager.states:
            manager.states[row["alias"]] = ModelState(_spec_from_row(row))
        return manager.states[row["alias"]]

    async def _infer(alias: str | None, op: str, payload: dict) -> dict:
        manager: ModelManager = state["manager"]
        mstate = await _resolve(alias)
        result, mstate = await manager.infer(mstate.spec.alias, op, payload)
        result.setdefault("extras", {})
        result["model"] = mstate.spec.alias
        result["model_id"] = mstate.spec.model_id
        return result

    def _make_job_handler(pool, config, manager):
        async def handler(job: dict) -> dict:
            t0 = time.monotonic()
            status, error_code = 200, None
            try:
                return await _infer(job["model_alias"], job["op"], job["payload"] or {})
            except ApiError as e:
                status, error_code = e.status, e.code
                raise
            except Exception:
                status, error_code = 500, "internal_error"
                raise
            finally:
                await pool.execute(
                    """INSERT INTO request_logs (api_key_id, source, capability, op,
                         model_alias, status, latency_ms, error_code, request_id)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
                    job["api_key_id"], job["source"], manifest.capability, job["op"],
                    job["model_alias"], status,
                    int((time.monotonic() - t0) * 1000), error_code, str(job["id"]),
                )
        return handler

    # ---- API interna (solo red interna; el gateway/controller son los clientes) ----

    @app.post("/invoke")
    async def invoke(req: InvokeRequest):
        return await _infer(req.model, req.op, req.payload)

    @app.get("/health")
    async def health():
        manager: ModelManager = state.get("manager")
        return {
            "status": "ok",
            "capability": manifest.capability,
            "mode": manifest.mode,
            "rss_mb": round(psutil.Process().memory_info().rss / 1024 / 1024),
            "models": manager.snapshot() if manager else [],
        }

    @app.get("/models")
    async def models():
        return state["manager"].snapshot()

    @app.post("/models/{alias}/load")
    async def load_model(alias: str):
        mstate = await _resolve(alias)
        await state["manager"].ensure_loaded(mstate.spec.alias)
        return mstate.snapshot()

    @app.post("/models/{alias}/unload")
    async def unload_model(alias: str):
        await state["manager"].unload(alias)
        return {"ok": True}

    @app.get("/metrics", response_class=PlainTextResponse)
    async def metrics():
        lines = [
            f"aihub_process_rss_bytes {psutil.Process().memory_info().rss}",
        ]
        for s in state["manager"].snapshot():
            labels = f'{{capability="{manifest.capability}",alias="{s["alias"]}"}}'
            lines.append(f'aihub_model_loaded{labels} {1 if s["status"] == "loaded" else 0}')
            lines.append(f'aihub_model_infer_total{labels} {s["n_infer"]}')
        return "\n".join(lines) + "\n"

    return app
