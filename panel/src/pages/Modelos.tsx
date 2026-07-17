import { useState } from "react";
import { api } from "../api";
import { Badge, StatusBadge } from "../components/Badge";
import { Card } from "../components/Card";
import {
  IconDownload,
  IconEdit,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconStop,
  IconTrash,
} from "../components/icons";
import { PageTitle } from "../components/Layout";
import { ConfirmModal, Modal } from "../components/Modal";
import { CenteredSpinner, Spinner } from "../components/Spinner";
import { Toggle } from "../components/Toggle";
import { useApi } from "../hooks";
import { useToast } from "../toast";
import type { Capability, ModelInfo } from "../types";

interface EditForm {
  alias: string;
  idle_unload_s: string;
  keep_warm: boolean;
  est_ram_mb: string;
  params: string;
  notes: string;
}

interface CreateForm {
  capability: string;
  alias: string;
  model_id: string;
  adapter: string;
  version: string;
  framework: string;
  est_ram_mb: string;
  params: string;
  idle_unload_s: string;
  keep_warm: boolean;
  notes: string;
}

const EMPTY_CREATE: CreateForm = {
  capability: "",
  alias: "",
  model_id: "",
  adapter: "",
  version: "",
  framework: "",
  est_ram_mb: "",
  params: "",
  idle_unload_s: "",
  keep_warm: false,
  notes: "",
};

/** Parsea el textarea de params: vacío → undefined; JSON inválido → lanza. */
function parseParams(text: string): Record<string, unknown> | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const parsed = JSON.parse(t);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("params debe ser un objeto JSON");
  }
  return parsed as Record<string, unknown>;
}

export function Modelos() {
  const { toast, toastError } = useToast();
  const [capFilter, setCapFilter] = useState("");
  const models = useApi<{ models: ModelInfo[] }>(
    () => api.get(`/admin/models${capFilter ? `?capability=${capFilter}` : ""}`),
    [capFilter]
  );
  const caps = useApi<{ capabilities: Capability[] }>(
    () => api.get("/admin/capabilities"),
    []
  );

  const [busyAction, setBusyAction] = useState<string | null>(null); // `${id}:${accion}`
  const [editing, setEditing] = useState<ModelInfo | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [deleting, setDeleting] = useState<ModelInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [saving, setSaving] = useState(false);

  async function runAction(
    m: ModelInfo,
    action: "load" | "unload" | "download",
    okMsg: string
  ) {
    setBusyAction(`${m.id}:${action}`);
    try {
      await api.post(`/admin/models/${m.id}/${action}`);
      toast(okMsg, "success");
      await models.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleEnabled(m: ModelInfo) {
    setBusyAction(`${m.id}:enabled`);
    try {
      await api.patch(`/admin/models/${m.id}`, { enabled: !m.enabled });
      await models.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setBusyAction(null);
    }
  }

  function openEdit(m: ModelInfo) {
    setEditing(m);
    setEditForm({
      alias: m.alias,
      idle_unload_s: m.idle_unload_s?.toString() ?? "",
      keep_warm: m.keep_warm,
      est_ram_mb: m.est_ram_mb?.toString() ?? "",
      params: m.params ? JSON.stringify(m.params, null, 2) : "",
      notes: m.notes ?? "",
    });
  }

  async function saveEdit() {
    if (!editing || !editForm) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        alias: editForm.alias.trim(),
        keep_warm: editForm.keep_warm,
        notes: editForm.notes.trim() || null,
        idle_unload_s: editForm.idle_unload_s.trim()
          ? Number(editForm.idle_unload_s)
          : null,
        est_ram_mb: editForm.est_ram_mb.trim() ? Number(editForm.est_ram_mb) : null,
      };
      const params = parseParams(editForm.params);
      if (params !== undefined || editForm.params.trim() === "") {
        body.params = params ?? null;
      }
      await api.patch(`/admin/models/${editing.id}`, body);
      toast("Modelo actualizado", "success");
      setEditing(null);
      await models.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      await api.delete(`/admin/models/${deleting.id}`);
      toast(`Modelo ${deleting.alias} borrado`, "success");
      setDeleting(null);
      await models.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }

  async function saveCreate() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        capability: createForm.capability,
        alias: createForm.alias.trim(),
        model_id: createForm.model_id.trim(),
        adapter: createForm.adapter.trim(),
        keep_warm: createForm.keep_warm,
      };
      if (createForm.version.trim()) body.version = createForm.version.trim();
      if (createForm.framework.trim()) body.framework = createForm.framework.trim();
      if (createForm.est_ram_mb.trim()) body.est_ram_mb = Number(createForm.est_ram_mb);
      if (createForm.idle_unload_s.trim())
        body.idle_unload_s = Number(createForm.idle_unload_s);
      if (createForm.notes.trim()) body.notes = createForm.notes.trim();
      const params = parseParams(createForm.params);
      if (params !== undefined) body.params = params;

      await api.post("/admin/models", body);
      toast("Modelo creado", "success");
      setCreating(false);
      setCreateForm(EMPTY_CREATE);
      await models.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }

  const list = models.data?.models ?? [];
  const capIds = (caps.data?.capabilities ?? []).map((c) => c.id);

  return (
    <div>
      <PageTitle
        title="Modelos"
        right={
          <>
            <select
              className="input !w-auto !py-1"
              value={capFilter}
              onChange={(e) => setCapFilter(e.target.value)}
            >
              <option value="">Todas las capacidades</option>
              {capIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button
              className="btn-ghost"
              onClick={() => models.reload()}
              title="Recargar"
            >
              <IconRefresh />
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setCreateForm({ ...EMPTY_CREATE, capability: capIds[0] ?? "" });
                setCreating(true);
              }}
            >
              <IconPlus /> Añadir modelo
            </button>
          </>
        }
      />

      {models.loading && !models.data ? (
        <CenteredSpinner />
      ) : models.error && !models.data ? (
        <p className="text-sm text-red-400">{models.error}</p>
      ) : list.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-zinc-500">No hay modelos.</p>
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {list.map((m) => {
            const rt = m.runtime;
            const loaded = rt?.status?.toLowerCase().includes("loaded") ?? false;
            return (
              <div
                key={m.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-100">{m.alias}</span>
                  <Badge tone="accent">{m.capability}</Badge>
                  {m.framework && <Badge tone="zinc">{m.framework}</Badge>}
                  {m.version && <Badge tone="zinc">v{m.version}</Badge>}
                  <StatusBadge status={rt?.status ?? (m.installed ? "descargado" : "sin pesos")} />
                  {!m.enabled && <Badge tone="amber">deshabilitado</Badge>}
                  {m.keep_warm && <Badge tone="zinc">keep-warm</Badge>}
                </div>
                <div className="mt-1 font-mono text-xs text-zinc-500">{m.model_id}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                  <span>RAM est.: {m.est_ram_mb != null ? `${m.est_ram_mb} MB` : "—"}</span>
                  <span>Inferencias: {rt?.n_infer ?? 0}</span>
                  <span>
                    Latencia media:{" "}
                    {rt?.avg_infer_ms != null ? `${Math.round(rt.avg_infer_ms)} ms` : "—"}
                  </span>
                  <span>
                    Carga: {rt?.load_time_s != null ? `${rt.load_time_s.toFixed(1)} s` : "—"}
                  </span>
                </div>
                {m.notes && <p className="mt-2 text-xs italic text-zinc-500">{m.notes}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-zinc-800 pt-3">
                  <button
                    className="btn-secondary !px-2 !py-1 text-xs"
                    disabled={busyAction === `${m.id}:load` || loaded}
                    onClick={() => runAction(m, "load", `Cargando ${m.alias}…`)}
                    title="Cargar en memoria"
                  >
                    {busyAction === `${m.id}:load` ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <IconPlay className="h-3.5 w-3.5" />
                    )}
                    Cargar
                  </button>
                  <button
                    className="btn-secondary !px-2 !py-1 text-xs"
                    disabled={busyAction === `${m.id}:unload` || !loaded}
                    onClick={() => runAction(m, "unload", `${m.alias} descargado de memoria`)}
                    title="Descargar de memoria"
                  >
                    {busyAction === `${m.id}:unload` ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <IconStop className="h-3.5 w-3.5" />
                    )}
                    Descargar
                  </button>
                  <button
                    className="btn-secondary !px-2 !py-1 text-xs"
                    disabled={busyAction === `${m.id}:download`}
                    onClick={() =>
                      runAction(m, "download", `Descargando pesos de ${m.alias} en segundo plano`)
                    }
                    title="Descargar pesos (Hugging Face)"
                  >
                    {busyAction === `${m.id}:download` ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <IconDownload className="h-3.5 w-3.5" />
                    )}
                    Pesos
                  </button>
                  <button
                    className="btn-secondary !px-2 !py-1 text-xs"
                    onClick={() => openEdit(m)}
                  >
                    <IconEdit className="h-3.5 w-3.5" /> Editar
                  </button>
                  <button
                    className="btn-danger !px-2 !py-1 text-xs"
                    onClick={() => setDeleting(m)}
                  >
                    <IconTrash className="h-3.5 w-3.5" /> Borrar
                  </button>
                  <div className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
                    Habilitado
                    <Toggle
                      checked={m.enabled}
                      busy={busyAction === `${m.id}:enabled`}
                      onChange={() => toggleEnabled(m)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && editForm && (
        <Modal
          title={`Editar modelo: ${editing.alias}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? <Spinner className="h-4 w-4 text-white" /> : "Guardar"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="label">Alias</label>
              <input
                className="input"
                value={editForm.alias}
                onChange={(e) => setEditForm({ ...editForm, alias: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">idle_unload_s</label>
                <input
                  className="input"
                  type="number"
                  value={editForm.idle_unload_s}
                  onChange={(e) =>
                    setEditForm({ ...editForm, idle_unload_s: e.target.value })
                  }
                  placeholder="vacío = sin descarga"
                />
              </div>
              <div>
                <label className="label">RAM estimada (MB)</label>
                <input
                  className="input"
                  type="number"
                  value={editForm.est_ram_mb}
                  onChange={(e) =>
                    setEditForm({ ...editForm, est_ram_mb: e.target.value })
                  }
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <Toggle
                checked={editForm.keep_warm}
                onChange={(v) => setEditForm({ ...editForm, keep_warm: v })}
              />
              keep_warm (mantener cargado)
            </label>
            <div>
              <label className="label">Params (JSON)</label>
              <textarea
                className="input h-32 font-mono text-xs"
                value={editForm.params}
                onChange={(e) => setEditForm({ ...editForm, params: e.target.value })}
                placeholder="{}"
              />
            </div>
            <div>
              <label className="label">Notas</label>
              <textarea
                className="input h-16"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar modelo"
          message={
            <>
              ¿Seguro que quieres borrar el modelo{" "}
              <strong className="text-zinc-200">{deleting.alias}</strong> (
              {deleting.model_id})? Esta acción no se puede deshacer.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={confirmDelete}
          busy={saving}
        />
      )}

      {creating && (
        <Modal
          title="Añadir modelo"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setCreating(false)}>
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={saveCreate}
                disabled={
                  saving ||
                  !createForm.capability ||
                  !createForm.alias.trim() ||
                  !createForm.model_id.trim() ||
                  !createForm.adapter.trim()
                }
              >
                {saving ? <Spinner className="h-4 w-4 text-white" /> : "Crear"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Capacidad *</label>
                <select
                  className="input"
                  value={createForm.capability}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, capability: e.target.value })
                  }
                >
                  {capIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Alias *</label>
                <input
                  className="input"
                  value={createForm.alias}
                  onChange={(e) => setCreateForm({ ...createForm, alias: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">Model ID (Hugging Face) *</label>
              <input
                className="input font-mono"
                value={createForm.model_id}
                onChange={(e) =>
                  setCreateForm({ ...createForm, model_id: e.target.value })
                }
                placeholder="org/nombre-del-modelo"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Adapter *</label>
                <input
                  className="input"
                  value={createForm.adapter}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, adapter: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Versión</label>
                <input
                  className="input"
                  value={createForm.version}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, version: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Framework</label>
                <input
                  className="input"
                  value={createForm.framework}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, framework: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">RAM estimada (MB)</label>
                <input
                  className="input"
                  type="number"
                  value={createForm.est_ram_mb}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, est_ram_mb: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">idle_unload_s</label>
                <input
                  className="input"
                  type="number"
                  value={createForm.idle_unload_s}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, idle_unload_s: e.target.value })
                  }
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <Toggle
                checked={createForm.keep_warm}
                onChange={(v) => setCreateForm({ ...createForm, keep_warm: v })}
              />
              keep_warm
            </label>
            <div>
              <label className="label">Params (JSON)</label>
              <textarea
                className="input h-24 font-mono text-xs"
                value={createForm.params}
                onChange={(e) => setCreateForm({ ...createForm, params: e.target.value })}
                placeholder="{}"
              />
            </div>
            <div>
              <label className="label">Notas</label>
              <textarea
                className="input h-16"
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
