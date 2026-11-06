"use client";
import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Explicación plegada: una línea “Cómo funciona” que al tocarla muestra el texto. */
export function InfoNote({ label = "Cómo funciona", children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={cn("px-1", className)}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-text">
        <Info size={13} /> {open ? "Ocultar" : label}
      </button>
      {open && <div className="mt-1 text-xs text-muted">{children}</div>}
    </div>
  );
}
