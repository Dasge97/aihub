import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .config import settings
from .errors import ApiError


def fetch_input(payload: dict, max_mb: int = 200) -> tuple[Path, bool]:
    """Devuelve (ruta_local, es_temporal). Si el payload trae `url`, descarga al
    directorio de datos; si trae `file_path` (subido vía gateway), lo usa tal cual.
    El llamante debe borrar el fichero si es_temporal es True."""
    if payload.get("file_path"):
        path = Path(payload["file_path"])
        if not path.exists():
            raise ApiError(422, "unprocessable", "El fichero subido ya no existe")
        return path, False
    url = payload.get("url")
    if not url:
        raise ApiError(400, "invalid_request", "Falta 'file' o 'url'")
    suffix = Path(urlparse(url).path).suffix.lower() or ""
    dest = Path(settings.data_dir) / "uploads" / f"{uuid.uuid4()}{suffix}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    max_bytes = max_mb * 1024 * 1024
    try:
        with httpx.stream("GET", url, timeout=60, follow_redirects=True) as r:
            r.raise_for_status()
            size = 0
            with dest.open("wb") as f:
                for chunk in r.iter_bytes(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise ApiError(413, "payload_too_large",
                                       f"La descarga supera {max_mb} MB")
                    f.write(chunk)
    except ApiError:
        dest.unlink(missing_ok=True)
        raise
    except httpx.HTTPError as e:
        dest.unlink(missing_ok=True)
        raise ApiError(422, "unprocessable", f"No se pudo descargar la URL: {e}")
    return dest, True
