# AI Hub — spec

Plataforma que centraliza modelos de IA especializados tras una API por
capacidades (`/v1/embeddings`, `/v1/ocr`, `/v1/transcribe`) con panel de
administración. Detalle en `docs/ARCHITECTURE.md`.

## Deployment

- mode: compose multi-container
- public_service: panel
- internal_port: 80
- healthcheck_path: /
- notas:
  - El panel (nginx) es el único servicio público: sirve la SPA y proxya
    `/api` → controller y `/v1` → gateway.
  - Compose de producción: `deploy/docker-compose.yml` +
    `deploy/docker-compose.services.yml` (los puertos los añade el override
    del deployment).
  - Requiere `.env` con `POSTGRES_PASSWORD` y `ADMIN_TOKEN` en el directorio
    de proyecto de compose (`deploy/`).
  - El controller necesita `/var/run/docker.sock` (arranca/para los
    servicios de capacidad del propio stack).
