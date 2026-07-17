// Gráficas SVG propias: barras apiladas y línea. Sin librerías.
// Ejes discretos en color muted, tooltips con <title> nativo, alto máx 180px.

const H = 180;
const PAD_L = 44;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;
const W = 720; // ancho lógico del viewBox; el SVG escala al contenedor

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

export interface BarPoint {
  label: string;
  ok: number;
  error: number;
}

/** Barras apiladas ok/error por bucket temporal. */
export function StackedBarChart({ data }: { data: BarPoint[] }) {
  if (data.length === 0) {
    return <div className="py-10 text-center text-sm text-zinc-600">Sin datos</div>;
  }
  const max = niceMax(Math.max(...data.map((d) => d.ok + d.error)));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const step = plotW / data.length;
  const barW = Math.max(2, Math.min(step * 0.7, 26));
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;

  // Como mucho ~8 etiquetas en el eje X
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      {/* eje Y: solo 0 y máximo */}
      <text x={PAD_L - 6} y={y(0) + 4} textAnchor="end" className="fill-zinc-600 text-[10px]">
        0
      </text>
      <text x={PAD_L - 6} y={y(max) + 8} textAnchor="end" className="fill-zinc-600 text-[10px]">
        {max}
      </text>
      <line x1={PAD_L} y1={y(0)} x2={W - PAD_R} y2={y(0)} className="stroke-zinc-800" />
      {data.map((d, i) => {
        const x = PAD_L + i * step + (step - barW) / 2;
        const total = d.ok + d.error;
        return (
          <g key={i}>
            <title>{`${d.label}\nOK: ${d.ok}\nErrores: ${d.error}`}</title>
            {/* zona de hover completa */}
            <rect x={PAD_L + i * step} y={PAD_T} width={step} height={plotH} fill="transparent" />
            {d.ok > 0 && (
              <rect
                x={x}
                y={y(d.ok)}
                width={barW}
                height={y(0) - y(d.ok)}
                rx={1}
                className="fill-indigo-500/80"
              />
            )}
            {d.error > 0 && (
              <rect
                x={x}
                y={y(total)}
                width={barW}
                height={y(d.ok) - y(total)}
                rx={1}
                className="fill-red-500/80"
              />
            )}
            {i % labelEvery === 0 && (
              <text
                x={PAD_L + i * step + step / 2}
                y={H - 6}
                textAnchor="middle"
                className="fill-zinc-600 text-[10px]"
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export interface LinePoint {
  label: string;
  value: number | null;
}

/** Línea simple (latencia media). Los puntos null se omiten. */
export function LineChart({ data, unit }: { data: LinePoint[]; unit?: string }) {
  const valid = data.filter((d) => d.value !== null);
  if (data.length === 0 || valid.length === 0) {
    return <div className="py-10 text-center text-sm text-zinc-600">Sin datos</div>;
  }
  const max = niceMax(Math.max(...valid.map((d) => d.value as number)));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const step = plotW / data.length;
  const xAt = (i: number) => PAD_L + i * step + step / 2;
  const yAt = (v: number) => PAD_T + plotH - (v / max) * plotH;

  const pathParts: string[] = [];
  let pen = false;
  data.forEach((d, i) => {
    if (d.value === null) {
      pen = false;
      return;
    }
    pathParts.push(`${pen ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(d.value).toFixed(1)}`);
    pen = true;
  });

  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      <text x={PAD_L - 6} y={yAt(0) + 4} textAnchor="end" className="fill-zinc-600 text-[10px]">
        0
      </text>
      <text x={PAD_L - 6} y={yAt(max) + 8} textAnchor="end" className="fill-zinc-600 text-[10px]">
        {max}
        {unit ?? ""}
      </text>
      <line x1={PAD_L} y1={yAt(0)} x2={W - PAD_R} y2={yAt(0)} className="stroke-zinc-800" />
      <path d={pathParts.join(" ")} fill="none" className="stroke-teal-400" strokeWidth={1.5} />
      {data.map((d, i) => (
        <g key={i}>
          {d.value !== null && (
            <circle cx={xAt(i)} cy={yAt(d.value)} r={2.5} className="fill-teal-400">
              <title>{`${d.label}: ${Math.round(d.value)}${unit ?? ""}`}</title>
            </circle>
          )}
          {i % labelEvery === 0 && (
            <text
              x={xAt(i)}
              y={H - 6}
              textAnchor="middle"
              className="fill-zinc-600 text-[10px]"
            >
              {d.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
