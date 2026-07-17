from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://aihub:aihub@postgres:5432/aihub"
    models_dir: str = "/models"
    data_dir: str = "/data"
    # Margen de RAM que debe quedar libre DESPUÉS de cargar un modelo.
    memory_margin_mb: int = 512
    load_timeout_s: int = 300
    job_poll_s: float = 2.0
    job_concurrency: int = 1
    config_cache_s: float = 10.0
    idle_check_s: float = 30.0
    log_level: str = "INFO"


settings = Settings()
