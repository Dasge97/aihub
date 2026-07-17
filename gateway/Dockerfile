# Contexto de build: raíz del repo
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY libs/aihub-kit /srv/libs/aihub-kit
RUN pip install --no-cache-dir /srv/libs/aihub-kit
COPY gateway /srv/gateway
WORKDIR /srv/gateway
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
