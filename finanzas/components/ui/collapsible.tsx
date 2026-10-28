"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Sección que se abre y se cierra tocando su título (para listas largas dentro de una hoja). */
export function Collapsible({ title, summary, defaultOpen = false, children, className }: {
  title: string;
  /** Texto corto a la derecha del título (ej. un total o cuántos hay). */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={cn("rounded-2xl border border-border bg-surface", className)}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left">
        <span className="min-w-0 flex-1 text-sm font-medium">{title}</span>
        {summary != null && <span className="num shrink-0 text-sm text-muted">{summary}</span>}
        <ChevronDown size={18} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-3 border-t border-border px-3.5 pb-3.5 pt-3">{children}</div>}
    </div>
  );
}
