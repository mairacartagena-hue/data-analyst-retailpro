"use client";
import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/** Selector de opciones tipo píldora, con el indicador animado. */
export function Segmented<T extends string>({
  value, onChange, options, className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  const id = useId();
  return (
    <div role="tablist" className={cn("flex rounded-2xl bg-surface-2 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn("relative min-w-0 flex-1 rounded-xl px-2 py-2 text-sm font-medium leading-tight transition-colors", active ? "text-text" : "text-muted")}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-xl bg-surface shadow-soft"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Grupo de chips para elegir una opción (cuentas, personas, etc.). */
export function ChipGroup<T extends string>({
  value, onChange, options, className,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; color?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
              active ? "border-olive bg-olive-soft text-text" : "border-border bg-surface text-muted",
            )}
          >
            {o.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: o.color }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
