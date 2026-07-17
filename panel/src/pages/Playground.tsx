import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Badge, StatusBadge } from "../components/Badge";
import { Card } from "../components/Card";
import { PageTitle } from "../components/Layout";
import { Spinner } from "../components/Spinner";
import { Table, Td } from "../components/Table";
import { useApi } from "../hooks";
import { useToast } from "../toast";
import type { Capability, JobDetail, ModelInfo, PlaygroundResult } from "../types";

// ---------- helpers de extracción defensiva (el shape exacto depende del servicio) ----------

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Busca los vectores de embeddings en varios shapes habituales. */
function extractVectors(body: unknown): number[][] | null {
  const b = asRecord(body);
  if (!b) return null;
  const candidates = [b.embeddings, b.vectors, b.result];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0 && Array.isArray(c[0])) {
      return c as number[][];
    }
  }
  if (Array.isArray(b.data)) {
    const vecs = (b.data as unknown[])
      .map((d) => asRecord(d)?.embedding)
      .filter((e): e is number[] => Array.isArray(e));
    if (vecs.length > 0) return vecs;
  }
  return null;
}

interface OcrExtract {
  text: string;
  nLines: number;
  avgConfidence: number | null;
}

function extractOcr(body: unknown): OcrExtract {
  const b = asRecord(body) ?? {};
  const text = typeof b.text === "string" ? b.text : "";
  let nLines = 0;
  let avgConfidence: number | null = null;
  if (Array.isArray(b.lines)) {
    nLines = b.lines.length;
    const confs = (b.lines as unknown[])
      .map((l) => asRecord(l)?.confidence)
      .filter((c): c is number => typeof c === "number");
    if (confs.length > 0)
      avgConfidence = confs.reduce((a, c) => a + c, 0) / confs.length;
  } else if (text) {
    nLines = text.split("\n").filter((l) => l.trim()).length;
  }
  if (avgConfidence === null) {
    const direct = b.avg_confidence ?? b.confidence;
    if (typeof direct === "number") avgConfidence = direct;
  }
  return { text, nLines, avgConfidence };
}

interface SpeechExtract {
  text: string;
  language: string | null;
  duration: number | null;
  segments: { start?: number; end?: number; text?: string }[];
}

function extractSpeech(result: unknown): SpeechExtract {
  const b = asRecord(result) ?? {};
  return {
    text: typeof b.text === "string" ? b.text : "",
    language: typeof b.language === "string" ? b.language : null,
    duration: typeof b.duration === "number" ? b.duration : null,
    segments: Array.isArray(b.segments)
      ? (b.segments as SpeechExtract["segments"])
      : [],
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ---------- selección de modelos (checkboxes) ----------

function ModelPicker({
  models,
  selected,
  onChange,
}: {
  models: ModelInfo[];
  selected: string[];
  onChange: (aliases: string[]) => void;
}) {
  if (models.length === 0)
    return <p className="text-sm text-zinc-500">No hay modelos para esta capacidad.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {models.map((m) => {
        const checked = selected.includes(m.alias);
        return (
          <label
            key={m.id}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
              checked
                ? "border-accent-500 bg-accent-600/15 text-accent-400"
                : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={checked}
              onChange={() =>
                onChange(
                  checked
                    ? selected.filter((a) => a !== m.alias)
                    : [...selected, m.alias]
                )
              }
            />
            {m.alias}
            {!m.enabled && <Badge tone="amber">off</Badge>}
          </label>
        );
      })}
    </div>
  );
}

// ---------- página ----------

type SpeechJob = {
  model: string;
  jobId: string;
  status: string;
  detail: JobDetail | null;
};

export function Playground() {
  const { toastError } = useToast();
  const caps = useApi<{ capabilities: Capability[] }>(
    () => api.get("/admin/capabilities"),
    []
  );
  const [capId, setCapId] = useState("");
  const models = useApi<{ models: ModelInfo[] }>(
    () => (capId ? api.get(`/admin/models?capability=${capId}`) : Promise.resolve({ models: [] })),
    [capId]
  );

  const capList = caps.data?.capabilities ?? [];
  const cap = capList.find((c) => c.id === capId) ?? null;
  useEffect(() => {
    if (!capId && capList.length > 0) setCapId(capList[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capList.length]);

  const ops = useMemo(
    () => Array.from(new Set(cap?.routes.map((r) => r.op) ?? [])),
    [cap]
  );
  const [op, setOp] = useState("");
  useEffect(() => {
    setOp(ops[0] ?? "");
    setSelected([]);
    setResults(null);
    setSpeechJobs(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capId]);

  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<PlaygroundResult[] | null>(null);

  // embeddings
  const [texts, setTexts] = useState("");
  const [task, setTask] = useState<"passage" | "query">("passage");

  // ocr / speech
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // speech jobs + polling
  const [speechJobs, setSpeechJobs] = useState<SpeechJob[] | null>(null);
  useEffect(() => {
    if (!speechJobs) return;
    const pending = speechJobs.filter(
      (j) => !["succeeded", "failed"].includes(j.status)
    );
    if (pending.length === 0) return;
    const t = setInterval(async () => {
      try {
        const updates = await Promise.all(
          pending.map((j) => api.get<JobDetail>(`/admin/jobs/${j.jobId}`))
        );
        setSpeechJobs((prev) =>
          prev
            ? prev.map((j) => {
                const u = updates.find((d) => d.job_id === j.jobId);
                return u ? { ...j, status: u.status, detail: u } : j;
              })
            : prev
        );
      } catch {
        // errores transitorios de polling: se reintenta en el siguiente tick
      }
    }, 3000);
    return () => clearInterval(t);
  }, [speechJobs]);

  const kind: "embeddings" | "ocr" | "speech" | "otro" =
    capId.includes("embed")
      ? "embeddings"
      : capId.includes("ocr")
        ? "ocr"
        : capId.includes("speech") || capId.includes("stt") || capId.includes("audio")
          ? "speech"
          : "otro";

  async function run() {
    if (!cap || selected.length === 0) return;
    setRunning(true);
    setResults(null);
    setSpeechJobs(null);
    try {
      if (kind === "embeddings") {
        const textList = texts
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean);
        const res = await api.post<{ results: PlaygroundResult[] }>(
          `/admin/playground/${cap.id}`,
          { op, payload: { texts: textList, task }, models: selected }
        );
        setResults(res.results);
      } else {
        if (!file) return;
        const form = new FormData();
        form.append("file", file);
        form.append(
          "request",
          JSON.stringify({
            op,
            payload: {},
            models: selected,
            ...(kind === "speech" ? { as_job: true } : {}),
          })
        );
        const res = await api.postForm<{ results: PlaygroundResult[] }>(
          `/admin/playground/${cap.id}`,
          form
        );
        if (kind === "speech") {
          setSpeechJobs(
            res.results.map((r) => ({
              model: r.model,
              jobId: r.job_id ?? "",
              status: String(r.status ?? "queued"),
              detail: null,
            }))
          );
        } else {
          setResults(res.results);
        }
      }
    } catch (err) {
      toastError(err);
    } finally {
      setRunning(false);
    }
  }

  const textList = texts
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);

  const canRun =
    selected.length > 0 &&
    !running &&
    (kind === "embeddings" ? textList.length > 0 : file !== null);

  return (
    <div>
      <PageTitle title="Playground" />

      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label">Capacidad</label>
            <select
              className="input !w-auto"
              value={capId}
              onChange={(e) => setCapId(e.target.value)}
            >
              {capList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.id})
                </option>
              ))}
            </select>
          </div>
          {ops.length > 1 && (
            <div>
              <label className="label">Operación</label>
              <select
                className="input !w-auto"
                value={op}
                onChange={(e) => setOp(e.target.value)}
              >
                {ops.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          )}
          {kind === "embeddings" && (
            <div>
              <label className="label">Task</label>
              <select
                className="input !w-auto"
                value={task}
                onChange={(e) => setTask(e.target.value as "passage" | "query")}
              >
                <option value="passage">passage</option>
                <option value="query">query</option>
              </select>
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="label">Modelos</label>
          <ModelPicker
            models={models.data?.models ?? []}
            selected={selected}
            onChange={setSelected}
          />
        </div>

        <div className="mt-4">
          {kind === "embeddings" && (
            <>
              <label className="label">Textos (una línea = un texto)</label>
              <textarea
                className="input h-28"
                value={texts}
                onChange={(e) => setTexts(e.target.value)}
                placeholder={"El gato duerme en el sofá\nUn felino descansa en el sillón"}
              />
            </>
          )}
          {(kind === "ocr" || kind === "speech") && (
            <>
              <label className="label">
                {kind === "ocr" ? "Imagen" : "Audio"}
              </label>
              <input
                ref={fileRef}
                type="file"
                accept={kind === "ocr" ? "image/*" : "audio/*"}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-sm file:text-zinc-200 hover:file:bg-zinc-600"
              />
              {kind === "speech" && (
                <p className="mt-1 text-xs text-zinc-600">
                  Se ejecuta como job en segundo plano; el resultado se consulta
                  automáticamente cada 3 s.
                </p>
              )}
            </>
          )}
          {kind === "otro" && (
            <p className="text-sm text-zinc-500">
              Esta capacidad no tiene interfaz de playground específica.
            </p>
          )}
        </div>

        {kind !== "otro" && (
          <button className="btn-primary mt-4" onClick={run} disabled={!canRun}>
            {running ? <Spinner className="h-4 w-4 text-white" /> : "Ejecutar"}
          </button>
        )}
      </Card>

      {/* resultados embeddings */}
      {results && kind === "embeddings" && (
        <EmbeddingsResults results={results} texts={textList} />
      )}

      {/* resultados ocr */}
      {results && kind === "ocr" && <OcrResults results={results} />}

      {/* resultados speech */}
      {speechJobs && <SpeechResults jobs={speechJobs} />}
    </div>
  );
}

function EmbeddingsResults({
  results,
  texts,
}: {
  results: PlaygroundResult[];
  texts: string[];
}) {
  return (
    <>
      <Card title="Resultados" className="mt-4">
        <Table headers={["Modelo", "Estado", "Latencia", "Dimensiones", "Primeros valores"]}>
          {results.map((r) => {
            const vecs = extractVectors(r.body);
            const first = vecs?.[0];
            return (
              <tr key={r.model}>
                <Td className="font-medium text-zinc-200">{r.model}</Td>
                <Td>
                  <StatusBadge status={String(r.status)} />
                </Td>
                <Td>{r.latency_ms != null ? `${Math.round(r.latency_ms)} ms` : "—"}</Td>
                <Td>{first ? first.length : "—"}</Td>
                <Td className="font-mono text-xs text-zinc-400">
                  {first
                    ? `[${first
                        .slice(0, 8)
                        .map((v) => v.toFixed(4))
                        .join(", ")}${first.length > 8 ? ", …" : ""}]`
                    : "—"}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {texts.length >= 2 &&
        results.map((r) => {
          const vecs = extractVectors(r.body);
          if (!vecs || vecs.length < 2) return null;
          return (
            <Card key={r.model} title={`Similitud coseno — ${r.model}`} className="mt-4">
              <div className="overflow-x-auto">
                <table className="text-xs">
                  <thead>
                    <tr>
                      <th className="px-2 py-1" />
                      {texts.map((_, j) => (
                        <th key={j} className="px-2 py-1 font-medium text-zinc-500">
                          T{j + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vecs.map((va, i) => (
                      <tr key={i}>
                        <th
                          className="max-w-[16rem] truncate px-2 py-1 text-left font-medium text-zinc-500"
                          title={texts[i]}
                        >
                          T{i + 1}
                        </th>
                        {vecs.map((vb, j) => {
                          const sim = cosine(va, vb);
                          // intensidad de fondo proporcional a la similitud
                          const alpha = Math.max(0, Math.min(1, (sim + 1) / 2));
                          return (
                            <td
                              key={j}
                              className="px-2 py-1 text-center font-mono"
                              title={`T${i + 1} · T${j + 1}: ${sim.toFixed(4)}`}
                              style={{
                                backgroundColor: `rgba(99, 102, 241, ${(alpha * 0.45).toFixed(2)})`,
                              }}
                            >
                              {sim.toFixed(3)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-zinc-600">
                T{"n"} = texto n (en orden de entrada). Calculado en el navegador.
              </p>
            </Card>
          );
        })}
    </>
  );
}

function OcrResults({ results }: { results: PlaygroundResult[] }) {
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {results.map((r) => {
        const ocr = extractOcr(r.body);
        return (
          <Card
            key={r.model}
            title={
              <span className="flex items-center gap-2">
                {r.model} <StatusBadge status={String(r.status)} />
              </span>
            }
          >
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
              <span>
                Latencia: {r.latency_ms != null ? `${Math.round(r.latency_ms)} ms` : "—"}
              </span>
              <span>Líneas: {ocr.nLines}</span>
              <span>
                Confianza media:{" "}
                {ocr.avgConfidence != null ? `${(ocr.avgConfidence * 100).toFixed(1)} %` : "—"}
              </span>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
              {ocr.text || "(sin texto extraído)"}
            </pre>
          </Card>
        );
      })}
    </div>
  );
}

function SpeechResults({ jobs }: { jobs: SpeechJob[] }) {
  return (
    <div className="mt-4 space-y-4">
      {jobs.map((j) => {
        const done = ["succeeded", "failed"].includes(j.status);
        const sp = j.detail ? extractSpeech(j.detail.result) : null;
        return (
          <Card
            key={j.jobId || j.model}
            title={
              <span className="flex items-center gap-2">
                {j.model} <StatusBadge status={j.status} />
                {!done && <Spinner className="h-3.5 w-3.5" />}
              </span>
            }
          >
            <div className="mb-2 text-xs text-zinc-500">
              Job: <span className="font-mono">{j.jobId || "—"}</span>
            </div>
            {j.status === "failed" && (
              <p className="text-sm text-red-400">
                {j.detail?.error ?? "El job ha fallado."}
              </p>
            )}
            {j.status === "succeeded" && sp && (
              <>
                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                  <span>Idioma: {sp.language ?? "—"}</span>
                  <span>
                    Duración: {sp.duration != null ? `${sp.duration.toFixed(1)} s` : "—"}
                  </span>
                  {j.detail?.latency_ms != null && (
                    <span>Latencia: {Math.round(j.detail.latency_ms)} ms</span>
                  )}
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                  {sp.text || "(sin texto)"}
                </pre>
                {sp.segments.length > 0 && (
                  <div className="mt-3">
                    <div className="label">Segmentos</div>
                    <Table headers={["Inicio", "Fin", "Texto"]}>
                      {sp.segments.map((s, i) => (
                        <tr key={i}>
                          <Td className="font-mono text-xs">
                            {s.start != null ? `${s.start.toFixed(1)}s` : "—"}
                          </Td>
                          <Td className="font-mono text-xs">
                            {s.end != null ? `${s.end.toFixed(1)}s` : "—"}
                          </Td>
                          <Td className="text-xs">{s.text ?? ""}</Td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
