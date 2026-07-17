import { useState } from "react";
import { api, qs } from "../api";
import { Badge, HttpBadge } from "../components/Badge";
import { Card } from "../components/Card";
import { IconRefresh } from "../components/icons";
import { PageTitle } from "../components/Layout";
import { CenteredSpinner } from "../components/Spinner";
import { Table, Td } from "../components/Table";
import { useApi } from "../hooks";
import type { Capability, RequestLog } from "../types";

function fmtTs(ts: string): string {
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

export function Peticiones() {
  const [capability, setCapability] = useState("");
  const [source, setSource] = useState("");
  const [hours, setHours] = useState(24);

  const caps = useApi<{ capabilities: Capability[] }>(
    () => api.get("/admin/capabilities"),
    []
  );
  const logs = useApi<{ requests: RequestLog[] }>(
    () =>
      api.get(
        `/admin/requests${qs({ capability, source, hours, limit: 100 })}`
      ),
    [capability, source, hours]
  );

  const list = logs.data?.requests ?? [];

  return (
    <div>
      <PageTitle
        title="Peticiones"
        right={
          <>
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
            <input
              className="input !w-36 !py-1"
              placeholder="Source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && logs.reload()}
            />
            <select
              className="input !w-auto !py-1"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              <option value={1}>Última hora</option>
              <option value={6}>Últimas 6 h</option>
              <option value={24}>Últimas 24 h</option>
              <option value={72}>Últimos 3 días</option>
              <option value={168}>Última semana</option>
            </select>
            <button className="btn-secondary" onClick={() => logs.reload()}>
              <IconRefresh /> Actualizar
            </button>
          </>
        }
      />

      <Card>
        {logs.loading && !logs.data ? (
          <CenteredSpinner />
        ) : logs.error && !logs.data ? (
          <p className="text-sm text-red-400">{logs.error}</p>
        ) : (
          <Table
            headers={[
              "Fecha",
              "Capacidad",
              "Op",
              "Modelo",
              "Source",
              "Status",
              "Latencia",
              "Error",
            ]}
            empty={list.length === 0}
          >
            {list.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-800/30">
                <Td className="whitespace-nowrap font-mono text-xs text-zinc-400">
                  {fmtTs(r.ts)}
                </Td>
                <Td>
                  <Badge tone="accent">{r.capability}</Badge>
                </Td>
                <Td className="text-xs text-zinc-300">{r.op ?? "—"}</Td>
                <Td className="text-xs text-zinc-300">{r.model_alias ?? "—"}</Td>
                <Td className="text-xs text-zinc-400">{r.source ?? "—"}</Td>
                <Td>
                  <HttpBadge status={r.status} />
                </Td>
                <Td className="text-xs">
                  {r.latency_ms != null ? `${Math.round(r.latency_ms)} ms` : "—"}
                </Td>
                <Td className="font-mono text-xs text-red-400">{r.error_code ?? ""}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
