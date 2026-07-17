# Añadir una capacidad nueva

Objetivo de diseño: una capacidad nueva = **una carpeta + un contrato**, sin tocar
gateway, controller ni panel. Si al añadir una capacidad necesitas modificar otro
componente, algo se ha degradado: párate y arréglalo.

## Pasos

1. **Contrato** — crea `contracts/<capacidad>/v1.yaml`: operaciones, rutas públicas,
   esquema de entrada/salida normalizado (independiente del modelo), modo
   sync/async/auto. Sigue `contracts/_conventions.md`.

2. **Servicio** — crea `services/<capacidad>/`:

   ```
   services/<capacidad>/
   ├── manifest.yaml          # capacidad, rutas, modelos y sus adaptadores
   ├── main.py                # 3 líneas: create_app(Path(__file__).parent)
   ├── adapters/
   │   └── mi_adapter.py      # subclase de aihub_kit.adapter.Adapter
   └── Dockerfile             # copia el de otro servicio y cambia las deps ML
   ```

   El adaptador implementa `load()`, `infer(op, payload)` y opcionalmente
   `unload()`. Guarda las referencias pesadas como `self._m_*` para que el
   `unload()` por defecto las libere. Normaliza SIEMPRE la salida al contrato;
   lo específico del modelo va en `extras`.

3. **Compose** — añade el servicio a `deploy/docker-compose.services.yml`
   (copia un bloque existente: red interna, volúmenes `data` y `models`,
   `mem_limit`/`cpus` acordes a la RAM del modelo).

4. **Arranca** — al arrancar, el servicio se auto-registra en la BD (capacidad,
   rutas, modelos). El gateway publica las rutas y el panel lo muestra sin más
   cambios.

## Añadir solo un modelo a una capacidad existente

- Si el adaptador ya existe en la imagen (ej. otro modelo sentence-transformers):
  panel → Modelos → "Añadir modelo" con el alias nuevo y el `model_id` de HF.
  Sin tocar código.
- Si requiere adaptador nuevo: añade la clase en `adapters/`, el modelo en
  `manifest.yaml` y reconstruye la imagen del servicio.

## Reglas

- La salida de un modelo nunca se expone en crudo: se normaliza en el adaptador.
- `est_ram_mb` honesto: la guardia de memoria lo usa para decidir si puede cargar.
- Operaciones que puedan tardar > ~20 s en CPU ⇒ modo `async` (cola de jobs).
- Proveedores externos (APIs comerciales) = un adaptador más que llama HTTP;
  mismo contrato, mismos alias.
