import asyncio
import importlib
import logging
import time
from pathlib import Path

import psutil

from .adapter import Adapter
from .config import settings
from .errors import ApiError
from .manifest import ModelSpec
from .registry import CapabilityConfig

log = logging.getLogger("aihub.manager")


def _import_adapter(path: str) -> type[Adapter]:
    module_name, class_name = path.split(":")
    module = importlib.import_module(module_name)
    return getattr(module, class_name)


class ModelState:
    def __init__(self, spec: ModelSpec):
        self.spec = spec
        self.adapter: Adapter | None = None
        self.status = "unloaded"  # unloaded | loading | loaded | error
        self.error: str | None = None
        self.lock = asyncio.Lock()
        self.loaded_at: float | None = None
        self.load_time_s: float | None = None
        self.last_used: float | None = None
        self.n_infer = 0
        self.total_infer_ms = 0.0

    def snapshot(self) -> dict:
        return {
            "alias": self.spec.alias,
            "model_id": self.spec.model_id,
            "status": self.status,
            "error": self.error,
            "load_time_s": round(self.load_time_s, 2) if self.load_time_s else None,
            "last_used": self.last_used,
            "n_infer": self.n_infer,
            "avg_infer_ms": round(self.total_infer_ms / self.n_infer, 1)
            if self.n_infer else None,
            "est_ram_mb": self.spec.est_ram_mb,
        }


class ModelManager:
    """Ciclo de vida de los modelos de un servicio: carga perezosa, guardia de
    memoria, descarga por inactividad y estadísticas de inferencia."""

    def __init__(self, specs: list[ModelSpec], config: CapabilityConfig, models_dir: str):
        self.states = {s.alias: ModelState(s) for s in specs}
        self.config = config
        self.models_dir = Path(models_dir)
        self._idle_task: asyncio.Task | None = None

    # ---- ciclo de vida -------------------------------------------------

    def _memory_guard(self, est_ram_mb: int) -> None:
        available_mb = psutil.virtual_memory().available / 1024 / 1024
        needed = est_ram_mb + settings.memory_margin_mb
        if available_mb < needed:
            raise ApiError(
                503, "over_capacity",
                f"RAM insuficiente para cargar el modelo "
                f"({available_mb:.0f} MB libres, se requieren {needed} MB)",
                retry_after=30,
            )

    async def ensure_loaded(self, alias: str) -> ModelState:
        state = self.states.get(alias)
        if state is None:
            raise ApiError(404, "not_found", f"Modelo '{alias}' no existe en este servicio")
        if state.status == "loaded":
            return state
        async with state.lock:
            if state.status == "loaded":
                return state
            row = await self.config.model(alias) or {}
            params = {**state.spec.params, **(row.get("params") or {})}
            self._memory_guard(row.get("est_ram_mb") or state.spec.est_ram_mb)
            state.status = "loading"
            state.error = None
            t0 = time.monotonic()
            try:
                adapter_cls = _import_adapter(state.spec.adapter)
                adapter = adapter_cls(state.spec, self.models_dir, params)
                await asyncio.wait_for(
                    asyncio.to_thread(adapter.load), timeout=settings.load_timeout_s
                )
            except ApiError:
                state.status = "unloaded"
                raise
            except Exception as e:
                state.status = "error"
                state.error = str(e)
                log.exception("fallo cargando modelo", extra={"ctx": {"alias": alias}})
                raise ApiError(500, "model_load_failed", f"Error cargando '{alias}': {e}")
            state.adapter = adapter
            state.status = "loaded"
            state.loaded_at = time.time()
            state.load_time_s = time.monotonic() - t0
            log.info("modelo cargado", extra={"ctx": {
                "alias": alias, "load_time_s": round(state.load_time_s, 1)}})
            return state

    async def unload(self, alias: str) -> None:
        state = self.states.get(alias)
        if state is None or state.status != "loaded":
            return
        async with state.lock:
            if state.status != "loaded":
                return
            adapter, state.adapter = state.adapter, None
            state.status = "unloaded"
            state.loaded_at = None
            if adapter:
                await asyncio.to_thread(adapter.unload)
            log.info("modelo descargado", extra={"ctx": {"alias": alias}})

    async def unload_all(self) -> None:
        for alias in list(self.states):
            await self.unload(alias)

    # ---- inferencia ----------------------------------------------------

    async def infer(self, alias: str, op: str, payload: dict) -> tuple[dict, ModelState]:
        state = await self.ensure_loaded(alias)
        t0 = time.monotonic()
        try:
            result = await asyncio.to_thread(state.adapter.infer, op, payload)
        except ApiError:
            raise
        except Exception as e:
            log.exception("fallo de inferencia", extra={"ctx": {"alias": alias, "op": op}})
            raise ApiError(422, "unprocessable", f"La inferencia falló: {e}")
        elapsed_ms = (time.monotonic() - t0) * 1000
        state.last_used = time.time()
        state.n_infer += 1
        state.total_infer_ms += elapsed_ms
        return result, state

    # ---- mantenimiento -------------------------------------------------

    async def start_background(self) -> None:
        # keep_warm: cargar al arrancar los modelos marcados en BD
        for alias, state in self.states.items():
            row = await self.config.model(alias)
            if row and row["keep_warm"] and row["enabled"]:
                try:
                    await self.ensure_loaded(alias)
                except Exception:
                    log.warning("keep_warm falló", extra={"ctx": {"alias": alias}})
        self._idle_task = asyncio.create_task(self._idle_loop())

    async def stop_background(self) -> None:
        if self._idle_task:
            self._idle_task.cancel()

    async def _idle_loop(self) -> None:
        while True:
            await asyncio.sleep(settings.idle_check_s)
            now = time.time()
            for alias, state in self.states.items():
                if state.status != "loaded":
                    continue
                try:
                    row = await self.config.model(alias)
                    if row and row["keep_warm"]:
                        continue
                    idle_s = (row or {}).get("idle_unload_s") or state.spec.idle_unload_s
                    ref = state.last_used or state.loaded_at or now
                    if now - ref > idle_s:
                        log.info("idle-unload", extra={"ctx": {"alias": alias}})
                        await self.unload(alias)
                except Exception:
                    log.exception("error en idle loop")

    def snapshot(self) -> list[dict]:
        return [s.snapshot() for s in self.states.values()]
