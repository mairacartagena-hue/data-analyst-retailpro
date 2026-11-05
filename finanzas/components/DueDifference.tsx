"use client";

// Pago de un vencimiento de crédito o tarjeta con un valor distinto a la cuota: la app muestra la diferencia y
// pregunta qué pasó (abono parcial o cuota menor; abono a capital o cuota mayor). Ver lib/finance/dueSettlements.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import type { DueSettlement, DueSettlementMode } from "@/lib/types";
import { dueOptions } from "@/lib/finance/dueSettlements";
import { formatCop } from "@/lib/finance/money";
import { formatDay } from "@/lib/finance/periods";

export function DueDifference({ expected, paid, due, busy, onChoose, onBack }: {
  expected: number;
  paid: number;
  due: string;
  busy?: boolean;
  onChoose: (mode: DueSettlementMode) => void;
  onBack: () => void;
}) {
  const diff = paid - expected;
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm">
        Pagas <strong className="num">{formatCop(paid)}</strong> y la cuota del {formatDay(due)} es{" "}
        <strong className="num">{formatCop(expected)}</strong>: {diff < 0 ? "faltan" : "sobran"}{" "}
        <strong className="num">{formatCop(Math.abs(diff))}</strong>. ¿Qué pasó?
      </p>
      {dueOptions(expected, paid).map((o) => (
        <button key={o.mode} type="button" disabled={busy} onClick={() => onChoose(o.mode)}
          className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-left disabled:opacity-60">
          <span className="block font-semibold">{o.title}</span>
          <span className="block text-xs text-muted">{o.detail}</span>
        </button>
      ))}
      <Button variant="ghost" className="w-full" disabled={busy} onClick={onBack}>Volver a cambiar el valor</Button>
    </div>
  );
}

/** Guarda (o suma a) cómo se resolvió el vencimiento: un registro por cuenta y fecha de pago. */
export async function saveDueSettlement(
  supabase: SupabaseClient,
  existing: DueSettlement | undefined,
  p: { householdId: string; accountId: string; due: string; mode: DueSettlementMode; expected: number; paid: number; payerId: string },
) {
  return supabase.from("due_settlements").upsert({
    household_id: p.householdId, account_id: p.accountId, due_date: p.due, mode: p.mode, payer_user_id: p.payerId,
    // Un segundo pago (después de un abono parcial) suma a lo pagado; la cuota es la del vencimiento
    expected: existing?.expected ?? p.expected,
    paid: (existing?.paid ?? 0) + p.paid,
  }, { onConflict: "account_id,due_date" });
}
