import { useState } from "react";
import { api } from "../api";
import { Badge, StatusBadge } from "../components/Badge";
import { Card } from "../components/Card";
import { PageTitle } from "../components/Layout";
import { CenteredSpinner } from "../components/Spinner";
import { Table, Td } from "../components/Table";
import { Toggle } from "../components/Toggle";
import { useApi } from "../hooks";
import { useToast } from "../toast";
import type { Capability, ModelInfo } from "../types";

export function Capacidades() {
  const { toastError, toast } = useToast();
  const caps = useApi<{ capabilities: Capability[] }>(
    () => api.get("/admin/capabilities"),
    []
  );
  const models = useApi<{ models: ModelInfo[] }>(() => api.get("/admin/models"), []);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [savingDefault, setSavingDefault] = useState<string | null>(null);

  async function toggleEnabled(cap: Capability) {
    setTogglingId(cap.id);
    try {
      await api.patch(`/admin/capabilities/${cap.id}`, { enabled: !cap.enabled });
      toast(
        `Capacidad ${cap.id} ${!cap.enabled ? "activada" : "desactivada"}`,
        "success"
      );
      await caps.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setTogglingId(null);
    }
  }

  async function changeDefault(cap: Capability, alias: string) {
    setSavingDefault(cap.id);
    try {
      await api.patch(`/admin/capabilities/${cap.id}`, { default_model: alias });
      toast(`Modelo por defecto de ${cap.id}: ${alias}`, "success");
      await caps.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setSavingDefault(null);
    }
  }

  if (caps.loading && !caps.data) return <CenteredSpinner />;
  if (caps.error && !caps.data)
    return <p className="text-sm text-red-400">{caps.error}</p>;

  const list = caps.data?.capabilities ?? [];
  const modelsByCap = new Map<string, ModelInfo[]>();
  for (const m of models.data?.models ?? []) {
    const arr = modelsByCap.get(m.capability) ?? [];
    arr.push(m);
    modelsByCap.set(m.capability, arr);
  }

  return (
    <div>
      <PageTitle title="Capacidades" />
      <Card>
        <Table
          headers={[
            "ID",
            "Título",
            "Modo",
            "Endpoints",
            "Modelo por defecto",
            "Contenedor",
            "Health",
            "Activa",
          ]}
          empty={list.length === 0}
        >
          {list.map((cap) => {
            const capModels = modelsByCap.get(cap.id) ?? [];
            return (
              <tr key={cap.id} className="hover:bg-zinc-800/30">
                <Td className="font-mono text-xs text-zinc-300">{cap.id}</Td>
                <Td className="text-zinc-200">{cap.title}</Td>
                <Td>
                  <Badge tone="zinc">{cap.mode}</Badge>
                </Td>
                <Td>
                  <div className="flex max-w-xs flex-wrap gap-1">
                    {cap.routes.map((r) => (
                      <span
                        key={r.path + r.op}
                        title={`op: ${r.op} · modo: ${r.mode} · contenido: ${r.content}`}
                        className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400"
                      >
                        {r.path}
                      </span>
                    ))}
                  </div>
                </Td>
                <Td>
                  <select
                    className="input !w-auto min-w-[9rem] !py-1 text-xs"
                    value={cap.default_model ?? ""}
                    disabled={savingDefault === cap.id || capModels.length === 0}
                    onChange={(e) => changeDefault(cap, e.target.value)}
                  >
                    {cap.default_model === null && <option value="">—</option>}
                    {capModels.map((m) => (
                      <option key={m.id} value={m.alias}>
                        {m.alias}
                      </option>
                    ))}
                    {/* por si el default no está en la lista de modelos */}
                    {cap.default_model &&
                      !capModels.some((m) => m.alias === cap.default_model) && (
                        <option value={cap.default_model}>{cap.default_model}</option>
                      )}
                  </select>
                </Td>
                <Td>
                  <StatusBadge status={cap.container_status} />
                </Td>
                <Td>
                  {cap.health ? <StatusBadge status={cap.health.status} /> : <Badge>—</Badge>}
                </Td>
                <Td>
                  <Toggle
                    checked={cap.enabled}
                    busy={togglingId === cap.id}
                    onChange={() => toggleEnabled(cap)}
                  />
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
      <p className="mt-2 text-xs text-zinc-600">
        Al activar o desactivar una capacidad el contenedor puede tardar unos segundos en
        arrancar o pararse.
      </p>
    </div>
  );
}
