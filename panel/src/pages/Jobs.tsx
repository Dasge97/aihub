import { useState } from "react";
import { api, qs } from "../api";
import { Badge, StatusBadge } from "../components/Badge";
import { Card } from "../components/Card";
import { IconRefresh } from "../components/icons";
import { PageTitle } from "../components/Layout";
import { Modal } from "../components/Modal";
import { CenteredSpinner } from "../components/Spinner";
import { Table, Td } from "../components/Table";
import { useApi } from "../hooks";
import { useToast } from "../toast";
import type { Capability, Job, JobDetail } from "../types";

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** El error de un job puede ser null, una cadena o {code, message}. Lo pasa a texto
 * (renderizar el objeto directamente rompía la página con el error #31 de React). */
function errText(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const o = e as { code?: string; message?: string };
    return o.message ?? o.code ?? JSON.stringify(e);
  }
  return String(e);
}

const STATUSES = ["", "queued", "running", "succeeded", "failed"];

export function Jobs() {
  const { toastError } = useToast();
  const [status, setStatus] = useState("");
  const [capability, setCapability] = useState("");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const caps = useApi<{ capabilities: Capability[] }>(
    () => api.get("/admin/capabilities"),
    []
  );
  const jobs = useApi<{ jobs: Job[] }>(
    () => api.get(`/admin/jobs${qs({ status, capability, limit: 50 })}`),
    [status, capability]
  );

  async function openDetail(job: Job) {
    setLoadingDetail(true);
    try {
      const d = await api.get<JobDetail>(`/admin/jobs/${job.job_id}`);
      setDetail(d);
    } catch (err) {
      toastError(err);
    } finally {
      setLoadingDetail(false);
    }
  }

  const list = jobs.data?.jobs ?? [];

  return (
    <div>
      <PageTitle
        title="Jobs"
        right={
          <>
            <select
              className="input !w-auto !py-1"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "Todos los estados" : s}
                </option>
              ))}
            </select>
            <select
              className="input !w-auto !py-1"
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
            >
              <option value="">Todas las capacidades</option>
              {(caps.data?.capabilities ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </select>
            <button className="btn-secondary" onClick={() => jobs.reload()}>
              <IconRefresh /> Actualizar
            </button>
          </>
        }
      />

      <Card>
        {jobs.loading && !jobs.data ? (
          <CenteredSpinner />
        ) : jobs.error && !jobs.data ? (
          <p className="text-sm text-red-400">{jobs.error}</p>
        ) : (
          <Table
            headers={[
              "Job",
              "Capacidad",
              "Modelo",
              "Estado",
              "Creado",
              "Terminado",
              "Latencia",
              "Error",
            ]}
            empty={list.length === 0}
          >
            {list.map((j) => (
              <tr
                key={j.job_id}
                className="cursor-pointer hover:bg-zinc-800/40"
                onClick={() => openDetail(j)}
                title="Ver detalle"
              >
                <Td className="font-mono text-xs text-zinc-400">
                  {j.job_id.slice(0, 12)}…
                </Td>
                <Td>
                  <Badge tone="accent">{j.capability}</Badge>
                </Td>
                <Td className="text-xs text-zinc-300">{j.model_alias ?? "—"}</Td>
                <Td>
                  <StatusBadge status={j.status} />
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs text-zinc-400">
                  {fmtTs(j.created_at)}
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs text-zinc-400">
                  {fmtTs(j.finished_at)}
                </Td>
                <Td className="text-xs">
                  {j.latency_ms != null ? `${Math.round(j.latency_ms)} ms` : "—"}
                </Td>
                <Td className="max-w-[12rem] truncate text-xs text-red-400">
                  <span title={errText(j.error)}>{errText(j.error)}</span>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {loadingDetail && (
          <p className="mt-2 text-xs text-zinc-500">Cargando detalle…</p>
        )}
      </Card>

      {detail && (
        <Modal title={`Job ${detail.job_id}`} onClose={() => setDetail(null)} wide>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="accent">{detail.capability}</Badge>
            <StatusBadge status={detail.status} />
            {detail.model_alias && <Badge tone="zinc">{detail.model_alias}</Badge>}
            {detail.source && <Badge tone="zinc">src: {detail.source}</Badge>}
            {detail.latency_ms != null && (
              <span className="text-xs text-zinc-500">
                {Math.round(detail.latency_ms)} ms
              </span>
            )}
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2 text-xs text-zinc-500">
            <span>Creado: {fmtTs(detail.created_at)}</span>
            <span>Iniciado: {fmtTs(detail.started_at)}</span>
            <span>Terminado: {fmtTs(detail.finished_at)}</span>
          </div>
          {detail.error && (
            <p className="mb-3 rounded-md border border-red-900 bg-red-950/40 p-2 text-sm text-red-300">
              {errText(detail.error)}
            </p>
          )}
          <div className="label">Payload</div>
          <pre className="mb-3 max-h-52 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
            {JSON.stringify(detail.payload, null, 2) ?? "null"}
          </pre>
          <div className="label">Result</div>
          <pre className="max-h-52 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
            {JSON.stringify(detail.result, null, 2) ?? "null"}
          </pre>
        </Modal>
      )}
    </div>
  );
}
