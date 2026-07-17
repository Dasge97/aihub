import type { ReactNode } from "react";

/** Tabla densa con estilo consistente. Envolver en overflow-x-auto ya incluido. */
export function Table({
  headers,
  children,
  empty,
}: {
  headers: ReactNode[];
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-500">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {empty ? (
            <tr>
              <td
                colSpan={headers.length}
                className="px-3 py-8 text-center text-zinc-500"
              >
                Sin datos
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-middle ${className ?? ""}`}>{children}</td>;
}
