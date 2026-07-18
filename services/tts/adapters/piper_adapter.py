import wave

from aihub_kit.adapter import Adapter
from aihub_kit.errors import ApiError
from aihub_kit.files import new_output


class PiperAdapter(Adapter):
    """Piper: TTS rápido en CPU (onnxruntime), licencia libre. No clona voz.
    Descarga la voz .onnx del repo HF rhasspy/piper-voices en la carga."""

    def load(self) -> None:
        from huggingface_hub import hf_hub_download
        from piper import PiperVoice

        repo = self.params.get("hf_repo", "rhasspy/piper-voices")
        voice_path = self.params["voice_path"]
        onnx = hf_hub_download(repo, voice_path)
        hf_hub_download(repo, voice_path + ".json")  # config junto al modelo
        self._m_voice = PiperVoice.load(onnx)

    def infer(self, op: str, payload: dict) -> dict:
        if op != "synthesize":
            raise ApiError(400, "invalid_request", f"Operación desconocida: {op}")
        text = (payload.get("text") or "").strip()
        if not text:
            raise ApiError(400, "invalid_request", "Falta 'text'")
        if payload.get("file_path"):
            # Piper no clona voz; se avisa en vez de ignorar en silencio.
            raise ApiError(
                400, "invalid_request",
                "El modelo 'piper-es' no admite clonación de voz. Usa 'xtts-v2' "
                "para clonar, o quita la voz de referencia.",
            )
        out_path, name = new_output("wav")
        with wave.open(str(out_path), "wb") as wf:
            self._m_voice.synthesize(text, wf)
        with wave.open(str(out_path), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
        return {
            "audio_url": f"/v1/audio/{name}",
            "format": "wav",
            "sample_rate": rate,
            "duration_s": round(frames / rate, 2) if rate else None,
        }
