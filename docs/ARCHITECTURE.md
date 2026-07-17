# AI Hub — Arquitectura

> Estado: diseño aprobado (2026-07-17). Este documento es la fuente de verdad de las
> decisiones de arquitectura. Si el código contradice este documento, uno de los dos
> está mal y hay que reconciliarlos explícitamente.

## 1. Propósito

Plataforma que centraliza modelos de IA **especializados** (no LLMs generalistas) y los
expone a las aplicaciones del ecosistema mediante una API común organizada por
**capacidades**, no por modelos.

- Las aplicaciones consumen `/v1/ocr`, `/v1/embeddings`, `/v1/transcribe`… y **nunca**
  dependen del modelo concreto que hay detrás.
- Cualquier modelo debe poder sustituirse sin tocar ninguna aplicación consumidora.
- Doble rol: **infraestructura de producción** para las apps y **banco de pruebas** para
  experimentar con modelos que aún no tienen consumidor (ver §6).
- Panel web de administración para gestionar todo el ecosistema (un solo administrador).

## 2. Decisiones clave (registro)

| # | Decisión | Motivo | Alternativa descartada |
|---|----------|--------|------------------------|
| D1 | Un contenedor por capacidad | Aislamiento de dependencias ML (Paddle/Torch/etc. son incompatibles entre sí), no escalabilidad | Monolito Python (dependency hell); microservicios "por escalar" (innecesario en 1 nodo) |
| D2 | Plano de datos (gateway) separado del plano de control (controller) | El controller monta `docker.sock`; jamás debe estar en un contenedor expuesto a internet | Un solo backend con todo |
| D3 | PostgreSQL como única pieza con estado: registro, claves, logs, jobs, config | Menos piezas que operar; la cola con `SKIP LOCKED` aguanta este volumen durante años | Redis/RabbitMQ desde el día 1 |
| D4 | Contratos versionados en `contracts/` como fuente de verdad; salida normalizada al esquema del Hub en el adaptador | Es lo que permite cambiar de modelo sin romper apps | Exponer el formato nativo de cada modelo |
| D5 | Librería compartida `aihub-kit` + plantilla de servicio | Añadir la capacidad N debe costar ~una carpeta con un adaptador y un manifiesto | Servicios artesanales independientes |
| D6 | Modelos con alias; `"model": "default"` es lo único estable | Compatibiliza "las apps no conocen el modelo" con la necesidad de experimentar (§6) | Prohibir seleccionar modelo (impide experimentar) o exponer nombres reales (acopla) |
| D7 | Servicio parado = contenedor parado; modelo inactivo = descargado de RAM con idle-unload | 16 GB compartidos y sin GPU: la RAM es el recurso crítico | Mantener todo residente |
| D8 | Síncrono o asíncrono se decide por capacidad en su contrato; cola en Postgres serializa lo pesado | En CPU una transcripción tarda minutos; HTTP síncrono no lo sostiene | Todo síncrono con timeouts largos |
| D9 | Panel = SPA React/Vite estática contra el controller | Panel interno sin SEO; nada de servidor Node que operar | Next.js |
| D10 | Compose + Traefik (flujo CodeHive), monorepo | Un nodo; k8s sería coste sin beneficio. El diseño es portable a más nodos cambiando URLs internas, no código | Kubernetes; multi-repo |
| D11 | Pesos de modelos en volumen `/models` (descarga huggingface-hub), nunca en la imagen Docker | Imágenes ligeras, builds rápidos, actualizar modelo ≠ rebuild | Hornear pesos en imágenes |
| D12 | Claves API `ah_…` hasheadas (SHA-256), scopes por capacidad, rate limit por clave | Suficiente para apps internas propias | OAuth/JWT entre apps propias (sobreingeniería) |
| D13 | OCR por defecto: RapidOCR (modelos PP-OCRv4 sobre onnxruntime) | Mismos modelos que PaddleOCR con ~la mitad de RAM e imagen mucho menor; sin dependencia de paddlepaddle | Paquete PaddleOCR completo (puede añadirse como adaptador experimental) |
| D14 | Modelos iniciales: `e5-small` (multilingual-e5-small, default embeddings), `minilm-l6`, `ppocr-v4`, `whisper-small` int8 (default speech), `whisper-base` | Variantes pequeñas por la restricción de RAM (D7); e5 es multilingüe (es/ca/en) | bge-m3, NLLB… (≥2 GB por modelo) |
| D15 | El panel llama a `/api/*` y su propio nginx lo proxya al controller | Sin CORS, misma configuración en local y producción | Panel llamando al controller cross-origin |
| D16 | Caché de pesos unificada: `HF_HOME=/models/hf` compartido entre controller y servicios | La descarga desde el panel y la carga en el servicio usan la misma caché | Caché por framework/servicio (descargas duplicadas) |
| D17 | Webhooks de jobs sin firma en v1 | Consumidores propios sobre HTTPS; se añadirá HMAC si hay terceros | Firma HMAC desde el día 1 |

## 3. Arquitectura general

```
                        Internet
                           │
                    ┌──────▼──────┐
                    │   Traefik    │  (ya existe en el servidor)
                    └──┬────────┬──┘
        api.<dominio>  │        │  panel.<dominio>
                ┌──────▼─────┐ ┌▼──────────┐
                │  GATEWAY   │ │  PANEL     │  SPA estática (nginx)
                │  FastAPI   │ └─┬──────────┘
                │  auth·rate │   │ https
                │  log·route │ ┌─▼──────────┐
                └──────┬─────┘ │ CONTROLLER │  FastAPI, plano de control
                       │       │ registro ·  │
              red interna      │ ciclo vida ·│──── docker.sock
              (no expuesta)    │ métricas    │     (start/stop servicios)
                       │       └─┬───────────┘
        ┌──────────┬───┴────────┼───────────┐
   ┌────▼───┐ ┌────▼────┐ ┌─────▼───┐  ┌────▼────┐
   │ svc-   │ │ svc-    │ │ svc-    │  │ svc-N   │  1 contenedor por
   │ ocr    │ │ embed   │ │ speech  │  │  ...    │  capacidad, clones
   └────┬───┘ └────┬────┘ └────┬────┘  └────┬────┘  de una plantilla
        └──────────┴─────┬─────┴────────────┘
                   ┌─────▼──────┐   ┌──────────────┐
                   │ PostgreSQL │   │ volumen      │
                   │            │   │ /models      │
                   └────────────┘   └──────────────┘
```

### Componentes

- **Gateway** (expuesto): auth por API key, rate limiting, validación de contrato,
  enrutado a servicios por el registro, log de cada petición en Postgres. Sin
  dependencias ML, siempre encendido, ligero.
- **Controller** (solo panel/admin): CRUD de capacidades, modelos y claves; arranca y
  para contenedores de servicios; descarga modelos de HF al volumen; recoge métricas
  (Docker stats + psutil); expone la API que consume el panel.
- **Servicios de capacidad** (`services/<capacidad>/`): FastAPI sobre `aihub-kit`, solo
  en la red interna. Contienen 1..N **adaptadores** (§5). Al arrancar se registran en el
  controller.
- **Panel**: dashboard, fichas de modelos, gestión de capacidades/claves, playground de
  pruebas (§6), monitorización.
- **PostgreSQL**: registro (capacidades, modelos, alias, estado), claves API, request
  logs, cola de jobs, configuración.

## 4. Contrato de capacidad (nivel público)

- Un esquema OpenAPI parcial por capacidad y versión en `contracts/<capacidad>/v1.yaml`.
- Prefijo `/v1/` en toda la API pública. Romper un contrato ⇒ nueva versión `/v2/`,
  la `/v1/` se mantiene hasta migrar consumidores.
- La salida se **normaliza al esquema del Hub** en el adaptador (p. ej. OCR devuelve
  bloques/líneas/palabras con texto, confianza y bbox, sea cual sea el motor). Campos
  que solo da un modelo concreto van en `extras`, documentado como **no garantizado**.
- Errores comunes, formato de jobs y convenciones transversales: `contracts/_conventions.md`.
- Capacidades síncronas responden directo; las asíncronas devuelven `202 + job_id`,
  consulta en `GET /v1/jobs/{id}` (webhooks en fase posterior).

## 5. Adaptadores (nivel interno)

Interfaz única por capacidad; un adaptador por modelo:

```python
class Adapter(Protocol):
    manifest: ModelManifest      # nombre, versión, framework, RAM estimada, alias
    def load(self) -> None       # carga pesos a memoria
    def unload(self) -> None
    def infer(self, req) -> res  # tipos generados del contrato de la capacidad
```

`aihub-kit` aporta: esqueleto FastAPI, `ModelManager` (lazy load, idle-unload
configurable, guardia de memoria: si no hay RAM libre suficiente según el manifiesto ⇒
`503 + Retry-After` o encolar, nunca OOM), logging estructurado JSON, middleware de
métricas (`/metrics` Prometheus), worker de cola, auto-registro en el controller.

**Objetivo de diseño medible**: añadir una capacidad nueva = carpeta en `services/` con
adaptador + `manifest.yaml` + contrato en `contracts/`. Sin tocar gateway, controller ni
panel. Si algún día esto deja de ser cierto, la arquitectura se ha degradado.

## 6. Modo experimentación

El Hub es también banco de pruebas: se instalan y prueban modelos **antes** de que
ninguna app los use.

- Cada capacidad puede tener N modelos instalados simultáneamente (no solo el default).
- Cada modelo tiene **alias** estables (`default`, `experimental`, o alias propio tipo
  `paddle-v4`). Las peticiones aceptan `"model": "<alias>"` opcional; sin él se usa
  `default`. Solo `default` tiene garantía de estabilidad para apps.
- El panel incluye **playground** por capacidad: lanzar una petición de prueba contra
  uno o varios modelos a la vez y comparar salida, latencia y RAM lado a lado.
- Promocionar un experimento = reasignar el alias `default` en el panel. Cero cambios
  en apps.
- Los request-logs marcan `source: app | playground` para que las pruebas no
  contaminen las estadísticas de las aplicaciones.

## 7. Stack tecnológico

| Componente | Tecnología |
|---|---|
| Gateway, controller, servicios | Python 3.12, FastAPI, Pydantic v2, `uv` |
| Panel | React + Vite + TypeScript + Tailwind + shadcn/ui |
| Base de datos | PostgreSQL 16 (única pieza con estado) |
| Cola de trabajos | Postgres `SELECT … FOR UPDATE SKIP LOCKED` |
| Métricas | Docker stats API + psutil (controller); `/metrics` Prometheus por servicio (Grafana opcional futuro) |
| Modelos | huggingface-hub → volumen `/models` |
| Despliegue | Docker Compose + Traefik file-provider (flujo CodeHive), imágenes por servicio |

## 8. Estructura del repositorio (monorepo)

```
aihub/
├── contracts/                  # fuente de verdad de la API pública
│   ├── _conventions.md
│   └── <capacidad>/v1.yaml
├── libs/aihub-kit/             # librería compartida de servicios
├── gateway/
├── controller/
├── services/
│   └── <capacidad>/
│       ├── adapters/
│       ├── manifest.yaml
│       └── Dockerfile
├── panel/
├── deploy/
│   ├── docker-compose.yml            # núcleo: gateway, controller, postgres, panel
│   ├── docker-compose.services.yml   # servicios de capacidad (profiles)
│   └── traefik/
└── docs/
    ├── ARCHITECTURE.md
    └── adding-a-capability.md
```

## 9. Gestión de recursos (restricción de primera clase)

Servidor inicial: 8 vCPU EPYC, 16 GB RAM compartidos con otros stacks, sin GPU, sin
swap. Parte de los stacks no usados se pararán para liberar RAM.

- Servicio inactivo ⇒ contenedor parado (0 RAM). Modelo inactivo ⇒ descargado
  (idle-unload, timeout configurable por modelo desde el panel).
- Guardia de memoria antes de cada `load` (RAM estimada del manifiesto vs disponible).
- Jobs pesados serializados por la cola (concurrencia 1-2 por servicio).
- `cpus:` y `mem_limit` en compose por servicio para no degradar los demás stacks.
- Preferencia por variantes pequeñas: faster-whisper small int8, bge-small, etc.
- Techo práctico estimado: ~2 capacidades pesadas activas a la vez. Cuando duela, el
  paso siguiente es mover `services/` a un nodo dedicado (cambio de URLs internas en
  configuración, no de código).

## 10. Seguridad

- Único punto de entrada público: Traefik → gateway (API) y panel.
- Servicios de capacidad solo en red interna Docker; nunca publicados.
- `docker.sock` solo en el controller; el controller se expone únicamente al panel con
  auth de administrador (un solo usuario; sin sistema de roles por ahora).
- Claves API por aplicación, hasheadas, con scopes por capacidad y rate limit por clave.
- Payloads: límites de tamaño en Traefik; ficheros subidos a volumen temporal con TTL.

## 11. Roadmap

1. **Fase 0 — Fundación**: `contracts/` (embeddings + ocr), `aihub-kit`, gateway
   (claves + logging), Postgres, `svc-embeddings` funcionando end-to-end con API key.
2. **Fase 1**: `svc-ocr` (ficheros + modo async con cola), panel MVP (dashboard,
   claves, capacidades/modelos, playground).
3. **Fase 2**: `svc-speech` (faster-whisper), webhooks de jobs, métricas históricas,
   comparador de modelos en playground.
4. **Fase 3+**: nuevas capacidades como rutina (traducción, reranking, NER, detección
   de idioma…); proveedores externos comerciales como un adaptador más.

Capacidades iniciales acordadas: **OCR, embeddings y speech-to-text**.
