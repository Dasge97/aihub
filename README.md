# AI Hub

Plataforma que centraliza modelos de IA **especializados** (OCR, embeddings,
speech-to-text…) tras una API única organizada por **capacidades**. Las aplicaciones
consumen `/v1/ocr`, `/v1/embeddings`, `/v1/transcribe`… y nunca dependen del modelo
concreto que hay detrás: cualquier modelo puede sustituirse desde el panel sin tocar
ninguna app.

Documentación principal:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitectura y decisiones (leer primero).
- [docs/adding-a-capability.md](docs/adding-a-capability.md) — cómo añadir una capacidad nueva.
- [contracts/](contracts/) — contratos de la API pública (fuente de verdad).

## Estructura

```
contracts/    contratos versionados de la API pública
libs/aihub-kit/  librería compartida: esqueleto de servicio, ModelManager, jobs, BD
gateway/      API pública: auth por clave, rate limit, enrutado, logging
controller/   API admin: registro, ciclo de vida de servicios/modelos, métricas, playground
services/     un directorio = una capacidad (embeddings, ocr, speech)
panel/        SPA React de administración
deploy/       docker compose + Traefik
```

## Arranque local (desarrollo)

```bash
cd deploy
cp .env.example .env        # editar valores
docker compose -f docker-compose.yml -f docker-compose.services.yml \
               -f docker-compose.local.yml up -d --build
```

- Gateway: http://localhost:8090 — Panel: http://localhost:8082 — Controller: http://localhost:8081
- Entra al panel con el `ADMIN_TOKEN` del `.env` y crea una clave API en "Claves".

Primera petición:

```bash
curl -X POST http://localhost:8090/v1/embeddings \
  -H "Authorization: Bearer <clave>" -H "Content-Type: application/json" \
  -d '{"texts": ["hola mundo"], "task": "passage"}'
```

La primera llamada a cada modelo paga su descarga/carga (lazy loading); las
siguientes son rápidas. Los modelos se descargan de RAM tras un tiempo de
inactividad configurable por modelo desde el panel.

## Despliegue (servidor CodeHive)

Flujo obligatorio: editar aquí → push a GitHub → pull en el servidor → sync + deploy
según `WORKING_RULES.md` del servidor. Traefik enruta por file-provider: plantilla en
[deploy/traefik/aihub.yml.example](deploy/traefik/aihub.yml.example). El compose de
producción no expone puertos; solo Traefik llega al gateway y al panel.
