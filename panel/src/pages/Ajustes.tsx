import { useEffect, useState } from "react";
import { api } from "../api";
import { Card } from "../components/Card";
import { PageTitle } from "../components/Layout";
import { CenteredSpinner, Spinner } from "../components/Spinner";
import { useApi } from "../hooks";
import { useToast } from "../toast";

const FIELDS = [
  {
    key: "jobs_retention_days",
    label: "Retención de jobs (días)",
    default: 7,
    help: "Los jobs más antiguos se eliminan automáticamente.",
  },
  {
    key: "logs_retention_days",
    label: "Retención de logs de peticiones (días)",
    default: 90,
    help: "Historial de request_logs que se conserva.",
  },
  {
    key: "uploads_ttl_h",
    label: "TTL de ficheros subidos (horas)",
    default: 24,
    help: "Tiempo que se conservan los ficheros subidos (imágenes, audio).",
  },
] as const;

export function Ajustes() {
  const { toast, toastError } = useToast();
  const settings = useApi<{ settings: Record<string, unknown> }>(
    () => api.get("/admin/settings"),
    []
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    const s = settings.data.settings ?? {};
    const next: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = s[f.key];
      next[f.key] =
        v !== undefined && v !== null ? String(v) : String(f.default);
    }
    setValues(next);
  }, [settings.data]);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, number> = {};
      for (const f of FIELDS) {
        const n = Number(values[f.key]);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`Valor no válido en "${f.label}"`);
        }
        body[f.key] = n;
      }
      await api.patch("/admin/settings", body);
      toast("Ajustes guardados", "success");
      await settings.reload({ silent: true });
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }

  if (settings.loading && !settings.data) return <CenteredSpinner />;
  if (settings.error && !settings.data)
    return <p className="text-sm text-red-400">{settings.error}</p>;

  return (
    <div>
      <PageTitle title="Ajustes" />
      <Card className="max-w-xl">
        <div className="space-y-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={f.key}>
                {f.label}
              </label>
              <input
                id={f.key}
                className="input !w-40"
                type="number"
                min={1}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
              <p className="mt-1 text-xs text-zinc-600">{f.help}</p>
            </div>
          ))}
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <Spinner className="h-4 w-4 text-white" /> : "Guardar"}
          </button>
        </div>
      </Card>
    </div>
  );
}
