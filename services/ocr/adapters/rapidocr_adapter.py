from pathlib import Path

from aihub_kit.adapter import Adapter
from aihub_kit.errors import ApiError
from aihub_kit.files import fetch_input

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}


class RapidOcrAdapter(Adapter):
    """RapidOCR ejecuta los modelos PP-OCRv4 de PaddleOCR sobre onnxruntime:
    misma calidad que PaddleOCR con la mitad de RAM y sin dependencia de paddle."""

    def load(self) -> None:
        from rapidocr_onnxruntime import RapidOCR

        self._m_engine = RapidOCR()

    def infer(self, op: str, payload: dict) -> dict:
        if op != "recognize":
            raise ApiError(400, "invalid_request", f"Operación desconocida: {op}")
        path, is_temp = fetch_input(payload, max_mb=50)
        try:
            if path.suffix.lower() == ".pdf":
                pages = self._pdf_pages(path, payload)
            elif path.suffix.lower() in IMAGE_SUFFIXES:
                pages = [self._ocr_image(self._read_image(path), 1)]
            else:
                raise ApiError(422, "unprocessable",
                               f"Formato no soportado: {path.suffix or 'desconocido'}")
        finally:
            if is_temp:
                path.unlink(missing_ok=True)
        text = "\n".join(
            line["text"] for page in pages for line in page["lines"]
        )
        return {"text": text, "pages": pages}

    # ---- helpers -------------------------------------------------------

    def _read_image(self, path: Path):
        import numpy as np
        from PIL import Image

        with Image.open(path) as img:
            return np.array(img.convert("RGB"))

    def _pdf_pages(self, path: Path, payload: dict) -> list[dict]:
        import numpy as np
        import pypdfium2 as pdfium

        scale = float(self.params.get("pdf_render_scale", 2.0))
        pages = []
        pdf = pdfium.PdfDocument(path)
        try:
            for i, page in enumerate(pdf):
                bitmap = page.render(scale=scale)
                arr = np.array(bitmap.to_pil().convert("RGB"))
                pages.append(self._ocr_image(arr, i + 1))
        finally:
            pdf.close()
        return pages

    def _ocr_image(self, arr, page_number: int) -> dict:
        result, _ = self._m_engine(arr)
        lines = []
        for box, text, score in result or []:
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            lines.append({
                "text": text,
                "confidence": round(float(score), 4),
                "bbox": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))],
            })
        return {
            "page": page_number,
            "width": int(arr.shape[1]),
            "height": int(arr.shape[0]),
            "lines": lines,
        }
