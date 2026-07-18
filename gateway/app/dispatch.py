import json
import time
import uuid
from pathlib import Path

import asyncpg
import httpx
from fastapi import Request

from aihub_kit import jobs as jobs_mod
from aihub_kit.config import settings
from aihub_kit.errors import ApiError

_ROUTES_TTL = 10.0


class RouteTable:
    """Mapa ruta pública → (capacidad, ruta) construido desde la BD (lo publican
    los servicios al registrarse). Cacheado con TTL corto."""

    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
        self._cached_at = 0.0
        self._table: dict[str, tuple[dict, dict]] = {}
        self._caps: list[dict] = []

    async def _refresh(self) -> None:
        if time.monotonic() - self._cached_at < _ROUTES_TTL:
            return
        rows = await self.pool.fetch("SELECT * FROM capabilities")
        self._caps = [dict(r) for r in rows]
        table = {}
        for cap in self._caps:
            if not cap["enabled"]:
                continue
            for route in cap["routes"]:
                table[route["path"]] = (cap, route)
        self._table = table
        self._cached_at = time.monotonic()

    async def resolve(self, path: str) -> tuple[dict, dict]:
        await self._refresh()
        entry = self._table.get(path)
        if entry is None:
            raise ApiError(404, "not_found", f"No existe el endpoint {path}")
        return entry

    async def capabilities(self) -> list[dict]:
        await self._refresh()
        return [
            {
                "capability": c["id"], "title": c["title"], "mode": c["mode"],
                "enabled": c["enabled"],
                "routes": [
                    {"path": r["path"], "mode": r["mode"], "content": r["content"]}
                    for r in c["routes"]
                ],
            }
            for c in self._caps
        ]


async def build_payload(request: Request, route: dict) -> dict:
    """Normaliza la entrada a un payload dict. Multipart: guarda el fichero en el
    volumen compartido y referencia su ruta."""
    content_type = request.headers.get("content-type", "")
    if route["content"] == "json" or content_type.startswith("application/json"):
        try:
            body = await request.json()
        except Exception:
            raise ApiError(400, "invalid_request", "Cuerpo JSON inválido")
        if not isinstance(body, dict):
            raise ApiError(400, "invalid_request", "El cuerpo debe ser un objeto JSON")
        return body

    if not content_type.startswith("multipart/"):
        raise ApiError(400, "invalid_request",
                       "Se esperaba multipart/form-data o application/json")
    form = await request.form()
    payload: dict = {}
    if form.get("request"):
        try:
            payload = json.loads(form["request"])
        except Exception:
            raise ApiError(400, "invalid_request", "El campo 'request' no es JSON válido")
    upload = form.get("file")
    if upload is not None and hasattr(upload, "filename"):
        max_bytes = route.get("max_upload_mb", 50) * 1024 * 1024
        uploads_dir = Path(settings.data_dir) / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(upload.filename or "file").suffix.lower()
        dest = uploads_dir / f"{uuid.uuid4()}{suffix}"
        size = 0
        with dest.open("wb") as f:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    f.close()
                    dest.unlink(missing_ok=True)
                    raise ApiError(413, "payload_too_large",
                                   f"El fichero supera {route.get('max_upload_mb', 50)} MB")
                f.write(chunk)
        payload["file_path"] = str(dest)
        payload["filename"] = upload.filename
        payload["content_type"] = upload.content_type
    # Nota: no se exige fichero aquí. Cada servicio valida sus entradas (p. ej. OCR
    # y speech requieren fichero/url; TTS acepta solo texto sin voz de referencia).
    return payload


def _is_async(route: dict, payload: dict) -> bool:
    if route["mode"] == "async":
        return True
    if route["mode"] == "auto":
        if payload.get("as_job"):  # el cliente lo pide explícitamente (p. ej. XTTS)
            return True
        name = (payload.get("filename") or payload.get("url") or "").lower()
        ctype = (payload.get("content_type") or "").lower()
        return name.endswith(".pdf") or ctype == "application/pdf"
    return False


async def dispatch(
    pool: asyncpg.Pool, client: httpx.AsyncClient,
    cap: dict, route: dict, payload: dict, key: dict, request_id: str,
) -> tuple[int, dict, str]:
    """Ejecuta la operación. Devuelve (status, body, model_alias)."""
    model_alias = payload.pop("model", None) or "default"
    webhook_url = payload.pop("webhook_url", None)

    if _is_async(route, payload):
        job_id = await jobs_mod.enqueue(
            pool, cap["id"], route["op"], payload, key["id"],
            model_alias=model_alias, webhook_url=webhook_url,
        )
        return 202, {"job_id": job_id, "status": "queued"}, model_alias

    try:
        resp = await client.post(
            f"{cap['service_url']}/invoke",
            json={
                "op": route["op"], "model": model_alias, "payload": payload,
                "meta": {"source": "app", "api_key_id": key["id"],
                         "request_id": request_id},
            },
            timeout=route.get("timeout_s", 120),
        )
    except httpx.HTTPError:
        raise ApiError(502, "capability_unavailable",
                       f"El servicio de '{cap['id']}' no responde (¿está activo?)")
    finally:
        # en sync el fichero subido ya se ha consumido; en async lo limpia el worker
        if payload.get("file_path"):
            Path(payload["file_path"]).unlink(missing_ok=True)
    body = resp.json()
    return resp.status_code, body, model_alias
