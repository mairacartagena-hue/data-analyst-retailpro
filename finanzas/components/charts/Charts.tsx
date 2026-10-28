"use client";

// Gráficos simples en HTML/SVG con la guía de visualización: marcas delgadas, extremos redondeados de 4px,
// 2px de separación entre segmentos, leyenda con 2 series, detalle al tocar y vista de tabla.

import { useEffect, useState } from "react";
import { ChevronDown, Table2 } from "lucide-react";
import { formatCop, formatCopShort } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

/**
 * Tarjeta de un informe. Se pliega y despliega tocando el título; plegada muestra solo el título y un resumen.
 * Con `id`, el celular recuerda si quedó abierta o cerrada.
 */
export function ChartCard({ id, title, subtitle, summary, defaultOpen = true, children, table }: {
  id?: string;
  title: string;
  subtitle?: string;
  /** Texto corto que se ve con la tarjeta plegada (ej. un total). */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  table?: { columns: string[]; rows: (string | number)[][] };
}) {
  const [showTable, setShowTable] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!id) return;
    try {
      const saved = localStorage.getItem(`informe:${id}`);
      if (saved === "1" || saved === "0") setOpen(saved === "1");
    } catch {}
  }, [id]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (id) try { localStorage.setItem(`informe:${id}`, next ? "1" : "0"); } catch {}
  };
  return (
    <section className="rounded-3xl border border-border bg-surface p-4 shadow-soft">
      <div className={cn("flex items-start justify-between gap-3", open && "mb-3")}>
        <button type="button" onClick={toggle} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <ChevronDown size={18} className={cn("mt-0.5 shrink-0 text-muted transition-transform", !open && "-rotate-90")} />
          <span className="min-w-0">
            <h2 className="font-semibold">{title}</h2>
            {open && subtitle && <span className="block text-xs text-muted">{subtitle}</span>}
            {!open && summary != null && <span className="num block text-xs text-muted">{summary}</span>}
          </span>
        </button>
        {open && table && (
          <button onClick={() => setShowTable(!showTable)} aria-pressed={showTable}
            className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-xs", showTable ? "bg-olive-soft text-text" : "text-muted hover:bg-surface-2")}>
            <Table2 size={14} /> Tabla
          </button>
        )}
      </div>
      {!open ? null : showTable && table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>{table.columns.map((c, i) => <th key={c} className={cn("pb-1 font-medium text-muted", i > 0 ? "text-right" : "text-left")}>{c}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((v, j) => <td key={j} className={cn("num py-1.5", j > 0 ? "text-right" : "text-left")}>{typeof v === "number" ? formatCop(v) : v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  );
}

/** Barras horizontales de una sola serie (magnitud): una fila por categoría, con su valor al lado. */
export function BarList({ items, color = "var(--series-1)", onSelect }: {
  items: { key: string; label: string; value: number }[];
  color?: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key}>
          <button className="w-full text-left" onClick={() => onSelect?.(i.key)} disabled={!onSelect}
            aria-label={`${i.label}: ${formatCop(i.value)}, ${total ? Math.round((i.value / total) * 100) : 0} %`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{i.label}</span>
              <span className="num shrink-0 text-muted">{formatCop(i.value)} · {total ? Math.round((i.value / total) * 100) : 0} %</span>
            </div>
            <div className="h-3 w-full">
              <div className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (i.value / max) * 100)}%`, background: color }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Columnas agrupadas (2 series) por mes, con detalle del mes tocado. */
export function GroupedColumns({ data, series }: {
  data: { label: string; values: number[] }[];
  series: { label: string; color: string }[];
}) {
  const [active, setActive] = useState<number | null>(data.length - 1);
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const height = 150;
  const ticks = [0, max / 2, max];
  const sel = active !== null ? data[active] : null;
  return (
    <div>
      <Legend items={series} />
      <p className="num mb-2 min-h-5 text-sm" aria-live="polite">
        {sel ? <><strong>{sel.label}</strong>{series.map((s, i) => ` · ${s.label} ${formatCop(sel.values[i])}`)}</> : "Toca un mes para ver el detalle"}
      </p>
      <div className="relative flex" style={{ height }}>
        <div className="pointer-events-none absolute inset-0">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t" style={{ bottom: `${(t / max) * 100}%`, borderColor: "var(--grid)" }}>
              <span className="num absolute -top-2 right-0 bg-surface pl-1 text-[10px] text-muted">{formatCopShort(t)}</span>
            </div>
          ))}
        </div>
        <div className="relative flex flex-1 items-end justify-around pr-12">
          {data.map((d, idx) => (
            <button key={d.label} onClick={() => setActive(idx)} onMouseEnter={() => setActive(idx)}
              aria-label={`${d.label}: ${series.map((s, i) => `${s.label} ${formatCop(d.values[i])}`).join(", ")}`}
              className={cn("flex h-full flex-1 items-end justify-center gap-[2px] rounded-lg", active === idx && "bg-surface-2/70")}>
              {d.values.map((v, i) => (
                <span key={i} className="w-2.5 rounded-t-[4px]" style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0, background: series[i].color }} />
              ))}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-around pr-12 pt-1.5 text-[11px] text-muted">
        {data.map((d, idx) => <span key={d.label} className={cn("flex-1 text-center capitalize", active === idx && "font-semibold text-text")}>{d.label}</span>)}
      </div>
    </div>
  );
}

/** Barras horizontales apiladas (2 series) por persona. */
export function StackedRows({ rows, series }: {
  rows: { label: string; values: number[] }[];
  series: { label: string; color: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, v) => a + v, 0)));
  return (
    <div>
      <Legend items={series} />
      <ul className="space-y-3">
        {rows.map((r) => {
          const total = r.values.reduce((a, v) => a + v, 0);
          return (
            <li key={r.label} aria-label={`${r.label}: ${series.map((s, i) => `${s.label} ${formatCop(r.values[i])}`).join(", ")}`}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="num text-muted">{formatCop(total)}</span>
              </div>
              <div className="flex h-3 w-full gap-[2px]" style={{ width: `${Math.max(2, (total / max) * 100)}%` }}>
                {r.values.map((v, i) => v > 0 && (
                  <span key={i} className={cn("h-3", i === r.values.length - 1 || r.values.slice(i + 1).every((x) => x === 0) ? "rounded-r-[4px]" : "")}
                    style={{ flexGrow: v, background: series[i].color }} title={`${series[i].label}: ${formatCop(v)}`} />
                ))}
              </div>
              <div className="num mt-1 flex gap-3 text-xs text-muted">
                {series.map((s, i) => <span key={s.label}>{s.label} {formatCop(r.values[i])}</span>)}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
