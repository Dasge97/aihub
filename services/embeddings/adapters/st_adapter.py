from aihub_kit.adapter import Adapter
from aihub_kit.errors import ApiError


class SentenceTransformersAdapter(Adapter):
    """Cualquier modelo compatible con sentence-transformers. Los modelos E5
    requieren prefijos query/passage: se configuran vía params."""

    def load(self) -> None:
        from sentence_transformers import SentenceTransformer

        # la caché es el HF_HOME compartido (/models/hf), común a todos los servicios
        self._m_model = SentenceTransformer(self.spec.model_id, device="cpu")

    def infer(self, op: str, payload: dict) -> dict:
        if op != "embed":
            raise ApiError(400, "invalid_request", f"Operación desconocida: {op}")
        texts = payload.get("texts")
        if not isinstance(texts, list) or not texts or len(texts) > 256:
            raise ApiError(400, "invalid_request",
                           "'texts' debe ser una lista de 1 a 256 strings")
        task = payload.get("task", "passage")
        prefix = self.params.get(f"{task}_prefix", "")
        if prefix:
            texts = [prefix + t for t in texts]
        vectors = self._m_model.encode(
            texts,
            normalize_embeddings=payload.get("normalize", True),
            batch_size=int(self.params.get("batch_size", 32)),
            show_progress_bar=False,
        )
        return {
            "embeddings": vectors.tolist(),
            "dimensions": int(vectors.shape[1]),
            "usage": {"texts": len(texts)},
        }
