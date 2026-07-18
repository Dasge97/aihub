# Contexto de build: raíz del repo.
# Python 3.11: los wheels de piper-phonemize no existen para 3.12 (aislamiento
# por servicio: el resto de la plataforma va en 3.12 sin problema).
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    XDG_DATA_HOME=/models/xdg \
    COQUI_TOS_AGREED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    espeak-ng libsndfile1 ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY libs/aihub-kit /srv/libs/aihub-kit
RUN pip install --no-cache-dir /srv/libs/aihub-kit \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir "coqui-tts>=0.24" "piper-tts==1.2.0"
COPY services/tts /srv/app
WORKDIR /srv/app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
