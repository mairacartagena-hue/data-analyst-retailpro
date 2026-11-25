"use client";

import { Link2 } from "lucide-react";
import { Select } from "@/components/ui/input";

/** Lista corta para elegir con qué se vincula a mano algo que el cruce automático no unió; no se muestra si no hay nada que ofrecer. */
export function LinkSelect({ label, options, onPick }: { label: string; options: { value: string; label: string }[]; onPick: (value: string) => void }) {
  if (options.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 pt-0.5">
      <Link2 size={14} className="shrink-0 text-muted" />
      <Select value="" aria-label={label} className="h-9 text-xs" onChange={(e) => e.target.value && onPick(e.target.value)}>
        <option value="">{label}…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </div>
  );
}
