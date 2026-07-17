import time
from collections import deque

from aihub_kit.errors import ApiError

_windows: dict[int, deque[float]] = {}


def check_rate_limit(key: dict) -> None:
    """Ventana deslizante de 60 s en memoria. Suficiente para una única instancia
    de gateway; si algún día hay varias réplicas, mover a Postgres/Redis."""
    limit = key["rate_limit_per_min"]
    if limit <= 0:
        return
    now = time.monotonic()
    window = _windows.setdefault(key["id"], deque())
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= limit:
        raise ApiError(
            429, "rate_limited",
            f"Límite de {limit} peticiones/min superado",
            retry_after=max(1, int(61 - (now - window[0]))),
        )
    window.append(now)
