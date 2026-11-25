"use client";

import { Children, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type RowTone = "ok" | "warn" | "busy" | "idle";

/** Resumen de una revisión en una línea: lo que se ve sin abrir nada. */
export interface RowSummary {
  text: string;
  tone: RowTone;
}

/**
 * Una fila de la revisión contra el banco: un ícono (✓ cuadra, ⚠ por revisar, leyendo, sin revisar), el título y UNA línea de resumen.
 * El detalle solo se ve al tocarla: se despliega debajo (`children`) o abre otra pantalla (`onClick`).
 */
export function ReviewRow({ title, status, tone, order, onClick, children }: {
  title: string;
  status: string;
  tone: RowTone;
  /** Posición en la lista (las filas de componentes distintos se ordenan con esto). */
  order?: number;
  /** La fila abre otra pantalla en vez de desplegarse. */
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = Children.toArray(children).length > 0;
  const expandable = !!onClick || hasDetail;
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : tone === "busy" ? Loader2 : Circle;
  return (
    <div style={{ order }} className="overflow-hidden rounded-xl border border-border bg-surface">
      <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left" disabled={!expandable}
        aria-expanded={onClick ? undefined : open} onClick={onClick ?? (() => setOpen((o) => !o))}>
        <Icon size={18} className={cn("shrink-0", tone === "ok" && "text-olive", tone === "warn" && "text-warning", tone === "busy" && "animate-spin text-muted", tone === "idle" && "text-muted")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className={cn("block text-xs", tone === "warn" ? "text-warning" : "text-muted")}>{status}</span>
        </span>
        {expandable && (onClick ? <ChevronRight size={16} className="shrink-0 text-muted" /> : <ChevronDown size={16} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />)}
      </button>
      {!onClick && open && hasDetail && <div className="space-y-3 border-t border-border px-3 py-3 text-xs">{children}</div>}
    </div>
  );
}
