import { api } from "../api";
import { Badge, StatusBadge } from "../components/Badge";
import { Card, ProgressBar, StatCard } from "../components/Card";
import { LineChart, StackedBarChart } from "../components/charts";
import { PageTitle } from "../components/Layout";
import { CenteredSpinner } from "../components/Spinner";
import { useApi } from "../hooks";
import type { Overview, TimeseriesPoint } from "../types";

function fmtMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function bucketLabel(bucket: string): string {
  const d = new Date(bucket);
  if (isNaN(d.getTime())) return bucket;
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export function Dashboard() {
  const overview = useApi<Overview>(
    () => api.get("/admin/overview"),
    [],
    10_000
  );
  const timeseries = useApi<{ bucket: string; series: TimeseriesPoint[] }>(
    () => api.get("/admin/stats/timeseries?hours=24"),
    [],
    60_000
  );

  if (overview.loading && !overview.data) return <CenteredSpinner />;
  if (overview.error && !overview.data)
    return <p className="text-sm text-red-400">{overview.error}</p>;

  const ov = overview.data!;
  const sys = ov.system;
  const ramPct = (sys.ram_used_mb / sys.ram_total_mb) * 100;
  const diskPct = (sys.disk_used_gb / sys.disk_total_gb) * 100;

  const series = timeseries.data?.series ?? [];
  const bars = series.map((p) => ({
    label: bucketLabel(p.bucket),
    ok: p.requests - p.errors,
    error: p.errors,
  }));
  const line = series.map((p) => ({
    label: bucketLabel(p.bucket),
    value: p.avg_latency_ms,
  }));

  return (
    <div>
      <PageTitle
        title="Dashboard"
        right={
          <span className="text-xs text-zinc-500">
            Actualización automática cada 10 s
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="CPU" value={`${sys.cpu_pct.toFixed(0)} %`}>
          <ProgressBar pct={sys.cpu_pct} />
        </StatCard>
        <StatCard
          label="RAM"
          value={fmtMb(sys.ram_used_mb)}
          sub={`de ${fmtMb(sys.ram_total_mb)} (${ramPct.toFixed(0)} %)`}
        >
          <ProgressBar pct={ramPct} />
        </StatCard>
        <StatCard
          label="Disco"
          value={`${sys.disk_used_gb.toFixed(1)} GB`}
          sub={`de ${sys.disk_total_gb.toFixed(0)} GB (${diskPct.toFixed(0)} %)`}
        >
          <ProgressBar pct={diskPct} />
        </StatCard>
        <StatCard
          label="Peticiones 24 h"
          value={ov.stats_24h.requests.toLocaleString("es-ES")}
        />
        <StatCard
          label="Errores 24 h"
          value={
            <span className={ov.stats_24h.errors > 0 ? "text-red-400" : undefined}>
              {ov.stats_24h.errors.toLocaleString("es-ES")}
            </span>
          }
        />
        <StatCard
          label="Latencia media"
          value={
            ov.stats_24h.avg_latency_ms !== null
              ? `${Math.round(ov.stats_24h.avg_latency_ms)} ms`
              : "—"
          }
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Peticiones por hora (24 h)">
          <div className="mb-2 flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-indigo-500/80" /> OK
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-red-500/80" /> Errores
            </span>
          </div>
          <StackedBarChart data={bars} />
        </Card>
        <Card title="Latencia media (ms)">
          <LineChart data={line} unit=" ms" />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Servicios" className="xl:col-span-2">
          <div className="space-y-3">
            {ov.services.length === 0 && (
              <p className="text-sm text-zinc-500">No hay servicios registrados.</p>
            )}
            {ov.services.map((svc) => (
              <div
                key={svc.capability}
                className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">{svc.title}</span>
                  <Badge tone="zinc">{svc.capability}</Badge>
                  <Badge tone="zinc">{svc.mode}</Badge>
                  {!svc.enabled && <Badge tone="amber">deshabilitado</Badge>}
                  <StatusBadge status={svc.container_status} />
                  {svc.health && <StatusBadge status={svc.health.status} />}
                  {svc.health?.rss_mb != null && (
                    <span className="text-xs text-zinc-500">
                      RSS {fmtMb(svc.health.rss_mb)}
                    </span>
                  )}
                </div>
                {svc.health && svc.health.models.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {svc.health.models.map((m) => (
                      <span
                        key={m.alias}
                        title={`${m.model_id}\nInferencias: ${m.n_infer ?? 0}\nLatencia media: ${
                          m.avg_infer_ms != null ? Math.round(m.avg_infer_ms) + " ms" : "—"
                        }${m.error ? `\nError: ${m.error}` : ""}`}
                        className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-xs text-zinc-300"
                      >
                        {m.alias}
                        <StatusBadge status={m.status} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Peticiones por capacidad (24 h)">
          {ov.stats_24h_by_capability.length === 0 ? (
            <p className="text-sm text-zinc-500">Sin actividad.</p>
          ) : (
            <div className="space-y-2">
              {ov.stats_24h_by_capability.map((c) => (
                <div key={c.capability} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{c.capability}</span>
                  <span className="text-zinc-500">
                    {c.requests.toLocaleString("es-ES")} req ·{" "}
                    {c.avg_latency_ms !== null ? `${Math.round(c.avg_latency_ms)} ms` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
