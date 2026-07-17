# Convenciones transversales de la API pública

Aplican a todas las capacidades. Cada capacidad define su contrato en
`contracts/<capacidad>/v1.yaml`; lo que no se defina allí se rige por este documento.

## Versionado

- Prefijo `/v1/` en toda la API pública. Cambio incompatible ⇒ `/v2/` nuevo; `/v1/` se
  mantiene hasta migrar todos los consumidores.
- Añadir campos opcionales de entrada o campos nuevos de salida NO es breaking.
- Eliminar/renombrar campos o cambiar su semántica SÍ es breaking.

## Autenticación

- Cabecera `Authorization: Bearer ah_live_<secreto>`.
- Cada clave tiene *scopes* (lista de capacidades permitidas) y rate limit por minuto.

## Selección de modelo

- Campo opcional `model` (string, alias). Por defecto `"default"`.
- `"default"` es el único alias con garantía de estabilidad. Cualquier otro alias es
  experimental y puede desaparecer sin previo aviso.
- La respuesta siempre incluye `model` (alias resuelto) y `model_id` (identificador
  informativo del modelo real, ej. `intfloat/multilingual-e5-small`). `model_id` es
  **informativo**: las apps no deben tomar decisiones basadas en él.

## Modos de ejecución

- **sync**: respuesta directa `200`.
- **async**: respuesta `202` con `{ "job_id": "<uuid>" }`. Consulta en
  `GET /v1/jobs/{job_id}`. Webhook opcional vía campo `webhook_url`.
- Cada operación declara su modo en su contrato. Una capacidad puede tener operaciones
  de ambos modos.
- Si el modelo está descargado y cargándose, las operaciones sync pueden responder
  `503` con cabecera `Retry-After` (segundos estimados de carga).

## Jobs (`contracts/jobs/v1.yaml`)

Estados: `queued → running → succeeded | failed`.

```json
GET /v1/jobs/{id} →
{
  "job_id": "…", "capability": "speech", "status": "succeeded",
  "created_at": "…", "started_at": "…", "finished_at": "…",
  "result": { …contrato de la capacidad… },
  "error": null
}
```

- Un job solo es visible para la API key que lo creó.
- Webhook: al terminar se hace `POST webhook_url` con el mismo cuerpo que
  `GET /v1/jobs/{id}` y cabecera `X-AIHub-Job-Id`. Sin firma en v1 (apps propias +
  HTTPS); si algún día hay consumidores de terceros, se añadirá firma HMAC.
- Los resultados de jobs se conservan 7 días (configurable).

## Errores

Formato único:

```json
{ "error": { "code": "model_loading", "message": "…", "detail": { } } }
```

| HTTP | code | Cuándo |
|------|------|--------|
| 400 | `invalid_request` | Entrada no cumple el contrato |
| 401 | `unauthorized` | Clave ausente o inválida |
| 403 | `forbidden` | Clave sin scope para esa capacidad |
| 404 | `not_found` | Job/recurso inexistente (o de otra clave) |
| 413 | `payload_too_large` | Fichero supera el límite |
| 422 | `unprocessable` | Entrada válida pero imposible de procesar (ej. audio corrupto) |
| 429 | `rate_limited` | Rate limit por clave; cabecera `Retry-After` |
| 503 | `model_loading` / `over_capacity` | Modelo cargándose / sin RAM; `Retry-After` |
| 502 | `capability_unavailable` | Servicio de la capacidad parado o caído |

## Ficheros de entrada

- Subida `multipart/form-data`: campo `file` + campo `request` (JSON con el resto de
  parámetros), o campo `url` dentro de `request` para que el Hub lo descargue.
- Límite por defecto: 50 MB (configurable por capacidad).
- Los ficheros subidos son efímeros: se borran al completarse el job (o tras TTL 24 h).

## Extras

- Campo de salida `extras` (objeto): datos específicos del modelo activo, **sin
  garantía de estabilidad**. Todo lo que esté fuera de `extras` es contrato estable.

## Métricas de respuesta

Toda respuesta incluye cabeceras `X-AIHub-Latency-Ms` y `X-AIHub-Request-Id`.
