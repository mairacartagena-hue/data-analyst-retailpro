"use client";

import { forwardRef } from "react";
import { parseCop } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

/** Campo de pesos: guarda solo dígitos y muestra los separadores de miles mientras se escribe. */
export const AmountInput = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (v: string) => void; large?: boolean; className?: string; id?: string; placeholder?: string; autoFocus?: boolean }
>(function AmountInput({ value, onChange, large, className, id, placeholder = "0", autoFocus }, ref) {
  const n = parseCop(value);
  return (
    <div className={cn("flex items-center rounded-2xl border border-border bg-surface px-4 focus-within:border-olive focus-within:ring-2 focus-within:ring-olive-soft", large ? "h-20" : "h-12", className)}>
      <span className={cn("mr-1 text-muted", large ? "text-3xl" : "text-base")}>$</span>
      <input
        ref={ref}
        id={id}
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        className={cn("num w-full bg-transparent text-text outline-none placeholder:text-muted/60", large ? "font-display text-4xl" : "text-base")}
        value={n === null ? "" : n.toLocaleString("es-CO")}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      />
    </div>
  );
});
