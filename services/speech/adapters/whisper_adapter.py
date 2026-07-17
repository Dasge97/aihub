from aihub_kit.adapter import Adapter
from aihub_kit.errors import ApiError
from aihub_kit.files import fetch_input


class FasterWhisperAdapter(Adapter):
    def load(self) -> None:
        from faster_whisper import WhisperModel

        # descarga/caché vía huggingface_hub → HF_HOME compartido (/models/hf)
        self._m_model = WhisperModel(
            self.spec.model_id,
            device="cpu",
            compute_type=self.params.get("compute_type", "int8"),
        )

    def infer(self, op: str, payload: dict) -> dict:
        if op != "transcribe":
            raise ApiError(400, "invalid_request", f"Operación desconocida: {op}")
        path, is_temp = fetch_input(payload, max_mb=200)
        try:
            segments_iter, info = self._m_model.transcribe(
                str(path),
                language=payload.get("language"),
                task=payload.get("task", "transcribe"),
                beam_size=int(self.params.get("beam_size", 5)),
                vad_filter=bool(self.params.get("vad_filter", True)),
            )
            segments = [
                {
                    "start": round(s.start, 2),
                    "end": round(s.end, 2),
                    "text": s.text.strip(),
                    "confidence": round(float(min(1.0, max(0.0, 1.0 + s.avg_logprob))), 3),
                }
                for s in segments_iter
            ]
        except ApiError:
            raise
        except Exception as e:
            raise ApiError(422, "unprocessable", f"No se pudo transcribir el audio: {e}")
        finally:
            if is_temp:
                path.unlink(missing_ok=True)
        result = {
            "text": " ".join(s["text"] for s in segments).strip(),
            "language": info.language,
            "language_confidence": round(float(info.language_probability), 3),
            "duration_s": round(float(info.duration), 2),
            "segments": segments if payload.get("timestamps", "segment") != "none" else [],
        }
        return result
