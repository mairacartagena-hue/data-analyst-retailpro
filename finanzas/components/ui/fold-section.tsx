"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Sección de una pantalla que se pliega tocando su título y recuerda cómo la dejaste (ej. Ajustes). */
export function FoldSection({ id, title, summary, icon, defaultOpen = false, children, className }: {
  /** Clave para recordar si quedó abierta. */
  id: string;
  title: string;
  /** Texto corto bajo el título cuando está plegada. */
  summary?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(`fold:${id}`);
      if (saved === "1" || saved === "0") setOpen(saved === "1");
    } catch {}
  }, [id]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(`fold:${id}`, next ? "1" : "0"); } catch {}
  };
  return (
    <section className={cn("overflow-hidden rounded-3xl border border-border bg-surface shadow-soft", className)}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          {summary != null && <span className="block truncate text-xs text-muted">{summary}</span>}
        </span>
        <ChevronDown size={18} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-4 border-t border-border p-4">{children}</div>}
    </section>
  );
}
