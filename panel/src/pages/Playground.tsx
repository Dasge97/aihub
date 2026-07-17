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
    duration:
      typeof b.duration === "number"
        ? b.duration
        : typeof b.duration_s === "number"
          ? b.duration_s
          : null,
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

// ---------- utilidades UI ----------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className="btn-secondary !py-1 !text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard puede estar bloqueado; se ignora en silencio
        }
      }}
    >
      {copied ? "Copiado ✓" : "Copiar"}
    </button>
  );
}

/** Selección de modelos (checkboxes). */
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

type Media = { file: File; url: string; source: "file" | "mic" };

const RUN_LABEL: Record<string, string> = {
  embeddings: "Generar embeddings",
  ocr: "Reconocer texto",
  speech: "Transcribir",
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

  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<PlaygroundResult[] | null>(null);

  // embeddings
  const [texts, setTexts] = useState("");
  const [task, setTask] = useState<"passage" | "query">("passage");

  // ocr / speech: fichero seleccionado (subido o grabado) con su preview
  const [media, setMedia] = useState<Media | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function setMediaFile(file: File | null, source: "file" | "mic") {
    setMedia((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return file ? { file, url: URL.createObjectURL(file), source } : null;
    });
  }
  function clearMedia() {
    setMedia((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
  }
  // limpiar preview al desmontar
  useEffect(() => {
    return () => {
      setMedia((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
    };
  }, []);

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

  // al cambiar de capacidad, resetear todo
  useEffect(() => {
    setOp(ops[0] ?? "");
    setSelected([]);
    setResults(null);
    setSpeechJobs(null);
    clearMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capId]);

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
        if (!media) return;
        const form = new FormData();
        form.append("file", media.file);
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
    (kind === "embeddings" ? textList.length > 0 : media !== null);

  const hint: Record<string, string> = {
    embeddings:
      "Escribe uno o varios textos (uno por línea), elige modelos y genera sus vectores. Con 2+ textos verás la matriz de similitud.",
    ocr: "Sube una imagen, elige modelos y extrae el texto.",
    speech:
      "Sube o graba un audio, elige modelos y pulsa Transcribir. La transcripción se procesa en segundo plano (unos segundos) y aparece más abajo.",
  };

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

        {kind !== "otro" && (
          <p className="mt-3 text-xs text-zinc-500">{hint[kind]}</p>
        )}

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
            <div className="space-y-3">
              <div>
                <label className="label">
                  {kind === "ocr" ? "Imagen" : "Audio"}
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept={kind === "ocr" ? "image/*" : "audio/*"}
                    onChange={(e) => setMediaFile(e.target.files?.[0] ?? null, "file")}
                    className="block text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-sm file:text-zinc-200 hover:file:bg-zinc-600"
                  />
                  {kind === "speech" && (
                    <MicRecorder
                      hasAudio={media?.source === "mic"}
                      onRecorded={(f) => setMediaFile(f, "mic")}
                    />
                  )}
                </div>
              </div>

              {media && (
                <MediaPreview kind={kind} media={media} onClear={clearMedia} />
              )}
            </div>
          )}

          {kind === "otro" && (
            <p className="text-sm text-zinc-500">
              Esta capacidad no tiene interfaz de playground específica.
            </p>
          )}
        </div>

        {kind !== "otro" && (
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" onClick={run} disabled={!canRun}>
              {running ? (
                <Spinner className="h-4 w-4 text-white" />
              ) : (
                RUN_LABEL[kind] ?? "Ejecutar"
              )}
            </button>
            {kind === "speech" && (
              <span className="text-xs text-zinc-600">
                {selected.length === 0
                  ? "Elige al menos un modelo"
                  : !media
                    ? "Sube o graba un audio"
                    : ""}
              </span>
            )}
          </div>
        )}
      </Card>

      {results && kind === "embeddings" && (
        <EmbeddingsResults results={results} texts={textList} />
      )}
      {results && kind === "ocr" && <OcrResults results={results} />}
      {speechJobs && <SpeechResults jobs={speechJobs} />}
    </div>
  );
}

/** Vista previa del audio/imagen seleccionado, con botón de borrar. */
function MediaPreview({
  kind,
  media,
  onClear,
}: {
  kind: "ocr" | "speech";
  media: Media;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      {kind === "speech" ? (
        <audio controls src={media.url} className="h-9 max-w-full" />
      ) : (
        <img
          src={media.url}
          alt="previsualización"
          className="max-h-32 rounded border border-zinc-800"
        />
      )}
      <div className="min-w-0 text-xs text-zinc-500">
        <div className="truncate text-zinc-300">
          {media.file.name}
          {media.source === "mic" && (
            <span className="ml-2">
              <Badge tone="accent">grabado</Badge>
            </span>
          )}
        </div>
        <div>{(media.file.size / 1024).toFixed(0)} KB</div>
      </div>
      <button
        type="button"
        className="btn-secondary !py-1 !text-xs text-red-400"
        onClick={onClear}
      >
        Borrar
      </button>
    </div>
  );
}

/** Grabación de audio desde el micrófono del navegador (MediaRecorder).
 * Entrega un File al padre. Requiere contexto seguro (HTTPS o localhost). */
function MicRecorder({
  onRecorded,
  hasAudio,
}: {
  onRecorded: (file: File) => void;
  hasAudio: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recRef.current && recRef.current.state !== "inactive") {
        recRef.current.stop();
      }
      recRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Tu navegador no permite grabar audio (o no es un contexto seguro).");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/ogg")
          ? "audio/ogg"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunksRef.current, { type });
        onRecorded(new File([blob], `grabacion.${ext}`, { type }));
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    recRef.current?.stop();
    setRecording(false);
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="inline-flex flex-col gap-1">
      {!recording ? (
        <button type="button" className="btn-secondary" onClick={start}>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          {hasAudio ? "Grabar de nuevo" : "Grabar micrófono"}
        </button>
      ) : (
        <button type="button" className="btn-secondary" onClick={stop}>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 animate-pulse rounded-sm bg-red-500" />
          Detener ({mm}:{ss})
        </button>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
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
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
              <span>
                Latencia: {r.latency_ms != null ? `${Math.round(r.latency_ms)} ms` : "—"}
              </span>
              <span>Líneas: {ocr.nLines}</span>
              <span>
                Confianza media:{" "}
                {ocr.avgConfidence != null ? `${(ocr.avgConfidence * 100).toFixed(1)} %` : "—"}
              </span>
              <span className="ml-auto">
                <CopyButton text={ocr.text} />
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

const SPEECH_STATUS: Record<string, { label: string; tone: "zinc" | "accent" | "green" | "red" }> = {
  queued: { label: "En cola", tone: "zinc" },
  running: { label: "Transcribiendo…", tone: "accent" },
  succeeded: { label: "Listo", tone: "green" },
  failed: { label: "Error", tone: "red" },
};

function SpeechResults({ jobs }: { jobs: SpeechJob[] }) {
  return (
    <div className="mt-4 space-y-4">
      <h2 className="text-sm font-semibold text-zinc-300">Transcripción</h2>
      {jobs.map((j) => {
        const done = ["succeeded", "failed"].includes(j.status);
        const st = SPEECH_STATUS[j.status] ?? { label: j.status, tone: "zinc" as const };
        const sp = j.detail ? extractSpeech(j.detail.result) : null;
        return (
          <Card
            key={j.jobId || j.model}
            title={
              <span className="flex items-center gap-2">
                {j.model}
                <Badge tone={st.tone}>{st.label}</Badge>
                {!done && <Spinner className="h-3.5 w-3.5" />}
              </span>
            }
          >
            {!done && (
              <p className="text-sm text-zinc-500">
                Procesando el audio… el resultado aparecerá aquí automáticamente.
              </p>
            )}

            {j.status === "failed" && (
              <p className="text-sm text-red-400">
                {typeof j.detail?.error === "string"
                  ? j.detail.error
                  : j.detail?.error
                    ? JSON.stringify(j.detail.error)
                    : "El job ha fallado."}
              </p>
            )}

            {j.status === "succeeded" && sp && (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                  <span>Idioma: {sp.language ?? "—"}</span>
                  <span>
                    Duración: {sp.duration != null ? `${sp.duration.toFixed(1)} s` : "—"}
                  </span>
                  {j.detail?.latency_ms != null && (
                    <span>Latencia: {Math.round(j.detail.latency_ms)} ms</span>
                  )}
                  <span className="ml-auto">
                    <CopyButton text={sp.text} />
                  </span>
                </div>

                <div className="label">Texto transcrito</div>
                <div className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm leading-relaxed text-zinc-100">
                  {sp.text || "(sin texto)"}
                </div>

                {sp.segments.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
                      Ver {sp.segments.length} segmentos con marcas de tiempo
                    </summary>
                    <div className="mt-2">
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
                  </details>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
