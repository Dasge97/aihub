import asyncio
import hashlib
import logging
import secrets

from fastapi import APIRouter

from aihub_kit.errors import ApiError
from aihub_kit.jobs import job_public_view

from . import main as ctl

log = logging.getLogger("aihub.controller")
router = APIRouter()

MODEL_EDITABLE = {"params", "idle_unload_s", "keep_warm", "enabled", "notes",
                  "est_ram_mb", "alias"}


async def _model_or_404(model_id: int) -> dict:
    row = await ctl.state["pool"].fetchrow("SELECT * FROM models WHERE id=$1", model_id)
    if row is None:
        raise ApiError(404, "not_found", "Modelo no encontrado")
    return dict(row)


async def _service_url(capability: str) -> str:
    cap = await ctl.state["pool"].fetchrow(
        "SELECT service_url FROM capabilities WHERE id=$1", capability
    )
    if cap is None:
        raise ApiError(404, "not_found", f"Capacidad '{capability}' no existe")
    return cap["service_url"]


# ---------- modelos ----------

@router.get("/admin/models")
async def list_models(capability: str | None = None):
    pool = ctl.state["pool"]
    if capability:
        rows = await pool.fetch(
            "SELECT * FROM models WHERE capability=$1 ORDER BY alias", capability
        )
    else:
        rows = await pool.fetch("SELECT * FROM models ORDER BY capability, alias")
    models = [dict(r) for r in rows]
    # estado runtime desde cada servicio activo (best effort)
    caps = {m["capability"] for m in models}
    runtime: dict[tuple, dict] = {}
    for cap in caps:
        url = await _service_url(cap)
        health = await ctl.service_health(url)
        for s in (health or {}).get("models", []):
            runtime[(cap, s["alias"])] = s
    for m in models:
        m["runtime"] = runtime.get((m["capability"], m["alias"]))
        m["created_at"] = str(m["created_at"])
    return {"models": models}


@router.post("/admin/models")
async def create_model(body: dict):
    required = {"capability", "alias", "model_id", "adapter"}
    if not required.issubset(body):
        raise ApiError(400, "invalid_request", f"Faltan campos: {required - set(body)}")
    pool = ctl.state["pool"]
    try:
        row = await pool.fetchrow(
            """INSERT INTO models (capability, alias, model_id, adapter, version,
                 framework, est_ram_mb, params, idle_unload_s, keep_warm, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id""",
            body["capability"], body["alias"], body["model_id"], body["adapter"],
            body.get("version", ""), body.get("framework", ""),
            int(body.get("est_ram_mb", 512)), body.get("params", {}),
            int(body.get("idle_unload_s", 600)), bool(body.get("keep_warm", False)),
            body.get("notes", ""),
        )
    except Exception as e:
        raise ApiError(400, "invalid_request", f"No se pudo crear el modelo: {e}")
    return {"id": row["id"]}


@router.patch("/admin/models/{model_id}")
async def patch_model(model_id: int, body: dict):
    model = await _model_or_404(model_id)
    updates = {k: v for k, v in body.items() if k in MODEL_EDITABLE}
    if not updates:
        raise ApiError(400, "invalid_request",
                       f"Campos editables: {sorted(MODEL_EDITABLE)}")
    sets = ", ".join(f"{k}=${i + 2}" for i, k in enumerate(updates))
    await ctl.state["pool"].execute(
        f"UPDATE models SET {sets} WHERE id=$1", model_id, *updates.values()
    )
    return {"ok": True}


@router.delete("/admin/models/{model_id}")
async def delete_model(model_id: int):
    model = await _model_or_404(model_id)
    cap = await ctl.state["pool"].fetchrow(
        "SELECT default_model FROM capabilities WHERE id=$1", model["capability"]
    )
    if cap and cap["default_model"] == model["alias"]:
        raise ApiError(400, "invalid_request",
                       "No se puede borrar el modelo por defecto de la capacidad; "
                       "cambia primero el default")
    await ctl.state["pool"].execute("DELETE FROM models WHERE id=$1", model_id)
    return {"ok": True}


@router.post("/admin/models/{model_id}/download")
async def download_model(model_id: int):
    """Descarga los pesos desde Hugging Face al volumen (en segundo plano)."""
    model = await _model_or_404(model_id)

    async def _download():
        from huggingface_hub import snapshot_download
        try:
            await asyncio.to_thread(snapshot_download, model["model_id"])
            await ctl.state["pool"].execute(
                "UPDATE models SET installed=true WHERE id=$1", model_id
            )
            log.info("modelo descargado", extra={"ctx": {"model": model["model_id"]}})
        except Exception as e:
            log.error("descarga falló: %s", e)

    asyncio.get_running_loop().create_task(_download())
    return {"ok": True, "status": "downloading"}


@router.post("/admin/models/{model_id}/load")
async def load_model(model_id: int):
    model = await _model_or_404(model_id)
    url = await _service_url(model["capability"])
    try:
        r = await ctl.state["client"].post(
            f"{url}/models/{model['alias']}/load", timeout=600
        )
        return r.json()
    except Exception as e:
        raise ApiError(502, "capability_unavailable", f"El servicio no responde: {e}")


@router.post("/admin/models/{model_id}/unload")
async def unload_model(model_id: int):
    model = await _model_or_404(model_id)
    url = await _service_url(model["capability"])
    try:
        r = await ctl.state["client"].post(
            f"{url}/models/{model['alias']}/unload", timeout=60
        )
        return r.json()
    except Exception as e:
        raise ApiError(502, "capability_unavailable", f"El servicio no responde: {e}")


# ---------- claves API ----------

@router.get("/admin/keys")
async def list_keys():
    rows = await ctl.state["pool"].fetch(
        """SELECT id, name, prefix, scopes, rate_limit_per_min, enabled,
                  created_at, last_used_at FROM api_keys ORDER BY id"""
    )
    return {"keys": [dict(r) | {"created_at": str(r["created_at"]),
                                "last_used_at": str(r["last_used_at"] or "")}
                     for r in rows]}


@router.post("/admin/keys")
async def create_key(body: dict):
    if not body.get("name"):
        raise ApiError(400, "invalid_request", "Falta 'name'")
    raw = f"ah_live_{secrets.token_urlsafe(32)}"
    digest = hashlib.sha256(raw.encode()).hexdigest()
    row = await ctl.state["pool"].fetchrow(
        """INSERT INTO api_keys (name, prefix, key_hash, scopes, rate_limit_per_min)
           VALUES ($1,$2,$3,$4,$5) RETURNING id""",
        body["name"], raw[:12], digest, body.get("scopes", ["*"]),
        int(body.get("rate_limit_per_min", 120)),
    )
    # la clave en claro solo se devuelve aquí, una única vez
    return {"id": row["id"], "key": raw}


@router.patch("/admin/keys/{key_id}")
async def patch_key(key_id: int, body: dict):
    editable = {"name", "scopes", "rate_limit_per_min", "enabled"}
    updates = {k: v for k, v in body.items() if k in editable}
    if not updates:
        raise ApiError(400, "invalid_request", f"Campos editables: {sorted(editable)}")
    sets = ", ".join(f"{k}=${i + 2}" for i, k in enumerate(updates))
    await ctl.state["pool"].execute(
        f"UPDATE api_keys SET {sets} WHERE id=$1", key_id, *updates.values()
    )
    return {"ok": True}


@router.delete("/admin/keys/{key_id}")
async def delete_key(key_id: int):
    await ctl.state["pool"].execute("DELETE FROM api_keys WHERE id=$1", key_id)
    return {"ok": True}


# ---------- peticiones y estadísticas ----------

@router.get("/admin/requests")
async def list_requests(capability: str | None = None, source: str | None = None,
                        hours: int = 24, limit: int = 100):
    conditions = ["ts > now() - make_interval(hours => $1)"]
    args: list = [min(hours, 24 * 90)]
    if capability:
        args.append(capability)
        conditions.append(f"capability = ${len(args)}")
    if source:
        args.append(source)
        conditions.append(f"source = ${len(args)}")
    rows = await ctl.state["pool"].fetch(
        f"""SELECT * FROM request_logs WHERE {' AND '.join(conditions)}
            ORDER BY ts DESC LIMIT {min(limit, 500)}""",
        *args,
    )
    return {"requests": [dict(r) | {"ts": str(r["ts"])} for r in rows]}


@router.get("/admin/stats/timeseries")
async def stats_timeseries(hours: int = 24, capability: str | None = None):
    bucket = "hour" if hours > 3 else "minute"
    args: list = [min(hours, 24 * 90)]
    cap_filter = ""
    if capability:
        args.append(capability)
        cap_filter = f"AND capability = ${len(args)}"
    rows = await ctl.state["pool"].fetch(
        f"""SELECT date_trunc('{bucket}', ts) AS bucket, count(*) AS requests,
                   count(*) FILTER (WHERE status >= 400) AS errors,
                   coalesce(avg(latency_ms), 0)::int AS avg_latency_ms
            FROM request_logs
            WHERE ts > now() - make_interval(hours => $1) {cap_filter}
            GROUP BY 1 ORDER BY 1""",
        *args,
    )
    return {"bucket": bucket,
            "series": [dict(r) | {"bucket": str(r["bucket"])} for r in rows]}


@router.get("/admin/stats/summary")
async def stats_summary(hours: int = 24):
    pool = ctl.state["pool"]
    h = min(hours, 24 * 90)
    top_models = await pool.fetch(
        """SELECT capability, model_alias, count(*) AS requests,
                  coalesce(avg(latency_ms), 0)::int AS avg_latency_ms
           FROM request_logs
           WHERE ts > now() - make_interval(hours => $1) AND model_alias <> ''
           GROUP BY 1, 2 ORDER BY requests DESC LIMIT 10""",
        h,
    )
    errors = await pool.fetch(
        """SELECT capability, error_code, count(*) AS n FROM request_logs
           WHERE ts > now() - make_interval(hours => $1) AND status >= 400
           GROUP BY 1, 2 ORDER BY n DESC LIMIT 10""",
        h,
    )
    return {"top_models": [dict(r) for r in top_models],
            "top_errors": [dict(r) for r in errors]}


# ---------- jobs ----------

@router.get("/admin/jobs")
async def list_jobs(status: str | None = None, capability: str | None = None,
                    limit: int = 50):
    conditions, args = ["true"], []
    if status:
        args.append(status)
        conditions.append(f"status = ${len(args)}")
    if capability:
        args.append(capability)
        conditions.append(f"capability = ${len(args)}")
    rows = await ctl.state["pool"].fetch(
        f"""SELECT * FROM jobs WHERE {' AND '.join(conditions)}
            ORDER BY created_at DESC LIMIT {min(limit, 200)}""",
        *args,
    )
    return {"jobs": [job_public_view(dict(r), include_result=False)
                     | {"model_alias": r["model_alias"], "source": r["source"],
                        "latency_ms": r["latency_ms"]}
                     for r in rows]}


@router.get("/admin/jobs/{job_id}")
async def get_job(job_id: str):
    row = await ctl.state["pool"].fetchrow("SELECT * FROM jobs WHERE id=$1::uuid", job_id)
    if row is None:
        raise ApiError(404, "not_found", "Job no encontrado")
    return job_public_view(dict(row)) | {"model_alias": row["model_alias"],
                                         "source": row["source"],
                                         "payload": row["payload"]}


# ---------- configuración ----------

@router.get("/admin/settings")
async def get_settings():
    rows = await ctl.state["pool"].fetch("SELECT * FROM settings")
    return {"settings": {r["key"]: r["value"] for r in rows}}


@router.patch("/admin/settings")
async def patch_settings(body: dict):
    pool = ctl.state["pool"]
    for key, value in body.items():
        await pool.execute(
            """INSERT INTO settings (key, value) VALUES ($1, $2)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
            key, value,
        )
    return {"ok": True}
