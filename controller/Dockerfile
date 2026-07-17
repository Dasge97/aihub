# Contexto de build: raíz del repo
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 HF_HOME=/models/hf
WORKDIR /srv
COPY libs/aihub-kit /srv/libs/aihub-kit
RUN pip install --no-cache-dir /srv/libs/aihub-kit "docker>=7.0" "huggingface_hub>=0.23"
COPY controller /srv/controller
WORKDIR /srv/controller
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
