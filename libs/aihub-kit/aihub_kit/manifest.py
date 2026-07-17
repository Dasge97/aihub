from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field


class ModelSpec(BaseModel):
    alias: str
    model_id: str
    adapter: str  # "adapters.modulo:Clase"
    version: str = ""
    framework: str = ""
    est_ram_mb: int = 512
    params: dict = Field(default_factory=dict)
    idle_unload_s: int = 600
    keep_warm: bool = False


class RouteSpec(BaseModel):
    path: str  # ruta pública, ej. /v1/embeddings
    op: str
    # auto: el gateway decide sync/async según la entrada (ej. PDF ⇒ async)
    mode: Literal["sync", "async", "auto"] = "sync"
    content: Literal["json", "multipart"] = "json"
    max_upload_mb: int = 50
    timeout_s: int = 120


class ServiceManifest(BaseModel):
    capability: str
    title: str = ""
    mode: Literal["sync", "async", "mixed"] = "sync"
    default_model: str
    routes: list[RouteSpec]
    models: list[ModelSpec]

    @classmethod
    def load(cls, path: Path) -> "ServiceManifest":
        return cls.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
