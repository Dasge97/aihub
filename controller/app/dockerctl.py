import logging

log = logging.getLogger("aihub.dockerctl")

_client = None


def client():
    global _client
    if _client is None:
        import docker

        _client = docker.from_env()
    return _client


def container_status(name: str) -> str:
    """running | exited | absent | error"""
    try:
        return client().containers.get(name).status
    except Exception as e:
        if type(e).__name__ == "NotFound":
            return "absent"
        log.warning("docker status falló: %s", e)
        return "error"


def start(name: str) -> None:
    client().containers.get(name).start()


def stop(name: str) -> None:
    client().containers.get(name).stop(timeout=30)


def stats(name: str) -> dict | None:
    """CPU % y RAM del contenedor (una sola muestra, no bloqueante)."""
    try:
        c = client().containers.get(name)
        if c.status != "running":
            return None
        s = c.stats(stream=False)
        cpu_delta = (s["cpu_stats"]["cpu_usage"]["total_usage"]
                     - s["precpu_stats"]["cpu_usage"]["total_usage"])
        sys_delta = (s["cpu_stats"].get("system_cpu_usage", 0)
                     - s["precpu_stats"].get("system_cpu_usage", 0))
        n_cpus = s["cpu_stats"].get("online_cpus") or 1
        cpu_pct = (cpu_delta / sys_delta * n_cpus * 100) if sys_delta > 0 else 0.0
        mem = s.get("memory_stats", {})
        return {
            "cpu_pct": round(cpu_pct, 1),
            "mem_mb": round(mem.get("usage", 0) / 1024 / 1024),
            "mem_limit_mb": round(mem.get("limit", 0) / 1024 / 1024),
        }
    except Exception:
        return None


def list_aihub_containers() -> list[dict]:
    out = []
    try:
        for c in client().containers.list(all=True):
            if c.name.startswith("aihub-"):
                out.append({"name": c.name, "status": c.status,
                            "image": c.image.tags[0] if c.image.tags else ""})
    except Exception as e:
        log.warning("docker list falló: %s", e)
    return out
