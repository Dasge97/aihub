# Contexto de build: raíz del repo
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY libs/aihub-kit /srv/libs/aihub-kit
RUN pip install --no-cache-dir /srv/libs/aihub-kit \
    && pip install --no-cache-dir "rapidocr-onnxruntime>=1.3" "pypdfium2>=4.28" "pillow>=10"
COPY services/ocr /srv/app
WORKDIR /srv/app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
