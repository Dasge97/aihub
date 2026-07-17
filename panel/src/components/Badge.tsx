import type { ReactNode } from "react";

export type BadgeTone = "green" | "amber" | "red" | "zinc" | "accent";

const TONES: Record<BadgeTone, string> = {
  green: "bg-emerald-950/60 text-emerald-400 border-emerald-900",
  amber: "bg-amber-950/60 text-amber-400 border-amber-900",
  red: "bg-red-950/60 text-red-400 border-red-900",
  zinc: "bg-zinc-800/80 text-zinc-400 border-zinc-700",
  accent: "bg-indigo-950/60 text-indigo-300 border-indigo-900",
};

export function Badge({ tone = "zinc", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Badge de estado de contenedor / servicio / runtime con color automático. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status ?? "desconocido").toLowerCase();
  let tone: BadgeTone = "zinc";
  if (["running", "ok", "healthy", "loaded", "succeeded", "ready"].some((k) => s.includes(k)))
    tone = "green";
  else if (
    ["loading", "downloading", "queued", "running_job", "starting", "pending", "restarting"].some(
      (k) => s.includes(k)
    )
  )
    tone = "amber";
  else if (["error", "failed", "exited", "dead", "unhealthy"].some((k) => s.includes(k)))
    tone = "red";
  return <Badge tone={tone}>{status ?? "—"}</Badge>;
}

/** Badge de código HTTP. */
export function HttpBadge({ status }: { status: number }) {
  const tone: BadgeTone = status < 400 ? "green" : status < 500 ? "amber" : "red";
  return <Badge tone={tone}>{status}</Badge>;
}
