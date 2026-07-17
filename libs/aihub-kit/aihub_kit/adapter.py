import gc
from abc import ABC, abstractmethod
from pathlib import Path

from .manifest import ModelSpec


class Adapter(ABC):
    """Un adaptador envuelve UN modelo concreto y lo normaliza al contrato de su
    capacidad. load/unload/infer se ejecutan siempre en threadpool (son bloqueantes)."""

    def __init__(self, spec: ModelSpec, models_dir: Path, params: dict):
        self.spec = spec
        self.models_dir = models_dir
        self.params = params  # params del manifiesto con overrides del panel

    @abstractmethod
    def load(self) -> None: ...

    def unload(self) -> None:
        for attr in list(vars(self)):
            if attr.startswith("_m_"):  # convención: refs pesadas como self._m_*
                setattr(self, attr, None)
        gc.collect()

    @abstractmethod
    def infer(self, op: str, payload: dict) -> dict:
        """Recibe el payload del contrato público; devuelve el cuerpo de respuesta
        del contrato (sin `model`/`model_id`, que añade el runtime)."""
