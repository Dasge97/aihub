import type { ReactNode } from "react";

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-900/60 ${className ?? ""}`}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-300">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
      {children}
    </div>
  );
}

/** Barra de progreso fina (uso: RAM, disco). */
export function ProgressBar({ pct, tone }: { pct: number; tone?: "ok" | "warn" | "bad" }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const auto = clamped > 90 ? "bad" : clamped > 75 ? "warn" : "ok";
  const t = tone ?? auto;
  const color =
    t === "bad" ? "bg-red-500" : t === "warn" ? "bg-amber-500" : "bg-accent-500";
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
