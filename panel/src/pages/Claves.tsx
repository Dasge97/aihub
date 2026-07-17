import { useState } from "react";
import { api } from "../api";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { IconCopy, IconEdit, IconPlus, IconTrash } from "../components/icons";
import { PageTitle } from "../components/Layout";
import { ConfirmModal, Modal } from "../components/Modal";
import { CenteredSpinner, Spinner } from "../components/Spinner";
import { Table, Td } from "../components/Table";
import { Toggle } from "../components/Toggle";
import { useApi } from "../hooks";
import { useToast } from "../toast";
import type { ApiKey, Capability } from "../types";

interface KeyForm {
  name: string;
  scopes: string[]; // ["*"] o ids de capacidad
  rate_limit_per_min: string;
}

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ScopesEditor({
  scopes,
  capIds,
  onChange,
}: {
  scopes: string[];
  capIds: string[];
  onChange: (scopes: string[]) => void;
}) {
  const all = scopes.includes("*");
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          className="h-4 w-4 accent-indigo-500"
          checked={all}
          onChange={(e) => onChange(e.target.checked ? ["*"] : [])}
        />
        Todas las capacidades (*)
      </label>
      {!all &&
        capIds.map((id) => (
          <label key={id} className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-500"
              checked={scopes.includes(id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...scopes, id]
                    : scopes.filter((s) => s !== id)
                )
              }
            />
            {id}
          </label>
        ))}
    </div>
  );
}

export function Claves() {
  const { toast, toastError } = useToast();
  const keys = useApi<{ keys: ApiKey[] }>(() => api.get("/admin/keys"), []);
  const caps = useApi<{ capabilities: Capability[] }>(
    () => api.get("/admin/capabilities"),
    []
  );

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [form, setForm] = useState<KeyForm>({
    name: "",
    scopes: ["*"],
    rate_limit_per_min: "60",
  });
  const [deleting, setDeleting] = useState<ApiKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const capIds = (caps.data?.capabilities ?? []).map((c) => c.id);

  function openCreate() {
    setForm({ name: "", scopes: ["*"], rate_limit_per_min: "60" });
    setCreating(true);
  }

  function openEdit(k: ApiKey) {
    setForm({
      name: k.name,
      scopes: [...k.scopes],
      rate_limit_per_min: String(k.rate_limit_per_min),
    });
    setEditing(k);
  }

  async function save() {
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        scopes: form.scopes,
        rate_limit_per_min: Number(form.rate_limit_per_min) || 0,
      };
      if (creating) {
        const res = await api.post<{ id: number; key: string }>("/admin/keys", body);
        setCreating(false);
        setCopied(false);
        setNewKey(res.key);
      } else if (editing) {
        await api.patch(`/admin/keys/${editing.id}`, body);
        toast("Clave actualizada", "success");
        setEditing(null);
      }
      await keys.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(k: ApiKey) {
    setTogglingId(k.id);
    try {
      await api.patch(`/admin/keys/${k.id}`, { enabled: !k.enabled });
      await keys.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      await api.delete(`/admin/keys/${deleting.id}`);
      toast(`Clave "${deleting.name}" borrada`, "success");
      setDeleting(null);
      await keys.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      toast("No se pudo copiar al portapapeles; cópiala manualmente", "error");
    }
  }

  const list = keys.data?.keys ?? [];
  const formValid = form.name.trim().length > 0 && form.scopes.length > 0;

  return (
    <div>
      <PageTitle
        title="Claves API"
        right={
          <button className="btn-primary" onClick={openCreate}>
            <IconPlus /> Nueva clave
          </button>
        }
      />

      <Card>
        {keys.loading && !keys.data ? (
          <CenteredSpinner />
        ) : keys.error && !keys.data ? (
          <p className="text-sm text-red-400">{keys.error}</p>
        ) : (
          <Table
            headers={[
              "Nombre",
              "Prefijo",
              "Scopes",
              "Límite/min",
              "Creada",
              "Último uso",
              "Activa",
              "",
            ]}
            empty={list.length === 0}
          >
            {list.map((k) => (
              <tr key={k.id} className="hover:bg-zinc-800/30">
                <Td className="font-medium text-zinc-200">{k.name}</Td>
                <Td className="font-mono text-xs text-zinc-400">{k.prefix}…</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <Badge key={s} tone={s === "*" ? "accent" : "zinc"}>
                        {s === "*" ? "todas" : s}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td className="text-xs">{k.rate_limit_per_min}</Td>
                <Td className="whitespace-nowrap font-mono text-xs text-zinc-500">
                  {fmtTs(k.created_at)}
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs text-zinc-500">
                  {fmtTs(k.last_used_at)}
                </Td>
                <Td>
                  <Toggle
                    checked={k.enabled}
                    busy={togglingId === k.id}
                    onChange={() => toggleEnabled(k)}
                  />
                </Td>
                <Td>
                  <div className="flex gap-1">
                    <button
                      className="btn-ghost !p-1.5"
                      onClick={() => openEdit(k)}
                      title="Editar"
                    >
                      <IconEdit className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="btn-ghost !p-1.5 hover:!text-red-400"
                      onClick={() => setDeleting(k)}
                      title="Borrar"
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {(creating || editing) && (
        <Modal
          title={creating ? "Nueva clave API" : `Editar clave: ${editing?.name}`}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          footer={
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancelar
              </button>
              <button className="btn-primary" onClick={save} disabled={saving || !formValid}>
                {saving ? (
                  <Spinner className="h-4 w-4 text-white" />
                ) : creating ? (
                  "Crear"
                ) : (
                  "Guardar"
                )}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="label">Nombre</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="p. ej. n8n-producción"
              />
            </div>
            <div>
              <label className="label">Scopes</label>
              <ScopesEditor
                scopes={form.scopes}
                capIds={capIds}
                onChange={(scopes) => setForm({ ...form, scopes })}
              />
            </div>
            <div>
              <label className="label">Límite de peticiones por minuto</label>
              <input
                className="input !w-40"
                type="number"
                min={1}
                value={form.rate_limit_per_min}
                onChange={(e) => setForm({ ...form, rate_limit_per_min: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}

      {newKey && (
        <Modal title="Clave creada" onClose={() => setNewKey(null)}>
          <p className="mb-3 rounded-md border border-amber-900 bg-amber-950/40 p-2 text-sm text-amber-300">
            Guarda esta clave ahora: no se volverá a mostrar.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded-md border border-zinc-700 bg-zinc-950 p-3 font-mono text-sm text-zinc-200">
              {newKey}
            </code>
            <button className="btn-secondary shrink-0" onClick={copyKey}>
              <IconCopy /> {copied ? "Copiada" : "Copiar"}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar clave"
          message={
            <>
              ¿Seguro que quieres borrar la clave{" "}
              <strong className="text-zinc-200">{deleting.name}</strong>? Las
              integraciones que la usen dejarán de funcionar.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={confirmDelete}
          busy={saving}
        />
      )}
    </div>
  );
}
