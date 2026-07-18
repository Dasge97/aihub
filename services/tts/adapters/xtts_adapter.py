import wave

from aihub_kit.adapter import Adapter
from aihub_kit.errors import ApiError
from aihub_kit.files import fetch_input, new_output


class XttsAdapter(Adapter):
    """XTTS-v2 (Coqui): alta calidad y CLONACIÓN de voz multilingüe en CPU.
    Licencia NO comercial. Lento en CPU ⇒ usar as_job=true.

    Si el payload trae 'file_path' (muestra de voz), clona esa voz; si no, usa
    una voz predefinida del modelo (default_speaker)."""

    def load(self) -> None:
        import os

        os.environ.setdefault("COQUI_TOS_AGREED", "1")
        from TTS.api import TTS

        # sin GPU: coqui-tts usa CPU automáticamente
        self._m_tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")

    def infer(self, op: str, payload: dict) -> dict:
        if op != "synthesize":
            raise ApiError(400, "invalid_request", f"Operación desconocida: {op}")
        text = (payload.get("text") or "").strip()
        if not text:
            raise ApiError(400, "invalid_request", "Falta 'text'")
        language = payload.get("language") or "es"
        out_path, name = new_output("wav")

        ref_path, is_temp = None, False
        if payload.get("file_path") or payload.get("url"):
            ref, is_temp = fetch_input(payload, max_mb=25)
            ref_path = str(ref)
        try:
            kwargs = {"text": text, "language": language, "file_path": str(out_path)}
            if ref_path:
                kwargs["speaker_wav"] = ref_path
            else:
                kwargs["speaker"] = self.params.get("default_speaker", "Claribel Dervla")
            self._m_tts.tts_to_file(**kwargs)
        except ApiError:
            raise
        except Exception as e:
            raise ApiError(422, "unprocessable", f"No se pudo generar el audio: {e}")
        finally:
            if is_temp and ref_path:
                from pathlib import Path

                Path(ref_path).unlink(missing_ok=True)

        with wave.open(str(out_path), "rb") as wf:
            frames, rate = wf.getnframes(), wf.getframerate()
        return {
            "audio_url": f"/v1/audio/{name}",
            "format": "wav",
            "sample_rate": rate,
            "duration_s": round(frames / rate, 2) if rate else None,
            "extras": {"cloned": bool(ref_path)},
        }
