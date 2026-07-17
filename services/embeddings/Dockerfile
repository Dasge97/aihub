# Contexto de build: raíz del repo
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 HF_HOME=/models/hf
WORKDIR /srv
COPY libs/aihub-kit /srv/libs/aihub-kit
RUN pip install --no-cache-dir /srv/libs/aihub-kit \
    && pip install --no-cache-dir sentence-transformers>=3.0 \
       --extra-index-url https://download.pytorch.org/whl/cpu
COPY services/embeddings /srv/app
WORKDIR /srv/app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
