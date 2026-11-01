"use client";

// Cruce del extracto de la tarjeta con la app, al momento. Los valores (corte, fecha de pago, pago mínimo, pago total y
// deuda) se leen del PDF o se escriben a mano, se pueden corregir, y NO se guardan: solo sirven para comparar
//  · la cuota que la app proyecta para la fecha de pago contra el pago mínimo, y
//  · la deuda de la app al día del corte contra la deuda total del extracto.

import { useState } from "react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { Account, CardStatement } from "@/lib/types";
import { checkStatement, squares } from "@/lib/finance/cardStatements";
import { formatCop, parseCop } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

export interface StatementDraft {
  cut: string;
  due: string;
  minimum: string;
  total: string;
  debt: string;
}

export const emptyDraft: StatementDraft = { cut: "", due: "", minimum: "", total: "", debt: "" };

/** Valores del extracto para el cruce (null mientras falte la fecha de corte). */
export function statementOf(accountId: string, d: StatementDraft): CardStatement | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.cut)) return null;
  return {
    account_id: accountId, cut_date: d.cut, due_date: /^\d{4}-\d{2}-\d{2}$/.test(d.due) ? d.due : null,
    minimum_payment: parseCop(d.minimum), total_payment: parseCop(d.total), total_debt: parseCop(d.debt),
  };
}

/** Campos del extracto, editables. */
export function StatementFields({ value, onChange }: { value: StatementDraft; onChange: (v: StatementDraft) => void }) {
  const set = (k: keyof StatementDraft) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Fecha de corte"><Input type="date" value={value.cut} onChange={(e) => set("cut")(e.target.value)} /></Field>
      <Field label="Fecha de pago"><Input type="date" value={value.due} onChange={(e) => set("due")(e.target.value)} /></Field>
      <Field label="Pago mínimo"><AmountInput value={value.minimum} onChange={set("minimum")} /></Field>
      <Field label="Pago total"><AmountInput value={value.total} onChange={set("total")} /></Field>
      <div className="col-span-2"><Field label="Deuda total del extracto"><AmountInput value={value.debt} onChange={set("debt")} /></Field></div>
    </div>
  );
}

function Diff({ label, diff }: { label: string; diff: number | null }) {
  if (diff === null) return null;
  const ok = squares(diff);
  return (
    <p className={cn("rounded-lg px-2 py-1", ok ? "bg-olive-soft" : "bg-warning-soft")}>
      {label}: {ok ? "cuadra" : diff > 0 ? `la app tiene ${formatCop(diff)} más` : `la app tiene ${formatCop(-diff)} menos`}
    </p>
  );
}

/** Resultado del cruce con los valores que hay en el formulario (se recalcula al corregirlos). */
export function StatementCrossCheck({ account, draft }: { account: Account; draft: StatementDraft }) {
  const { transactions, cardItems } = useFinance();
  const st = statementOf(account.id, draft);
  if (!st) return <p className="text-xs text-muted">Escribe la fecha de corte para cruzar con la app.</p>;
  const c = checkStatement(account, transactions, cardItems, st);
  return (
    <div className="space-y-1.5 text-xs">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <dt className="text-muted">Pago mínimo</dt><dd className="num text-right">{st.minimum_payment !== null ? formatCop(st.minimum_payment) : "—"}</dd>
        <dt className="text-muted">Cuota según la app</dt><dd className="num text-right">{c.projected !== null ? formatCop(c.projected) : "falta la fecha de pago"}</dd>
        <dt className="text-muted">Deuda del extracto</dt><dd className="num text-right">{st.total_debt !== null ? formatCop(st.total_debt) : "—"}</dd>
        <dt className="text-muted">Deuda según la app al corte</dt><dd className="num text-right">{formatCop(c.appDebt)}</dd>
      </dl>
      <Diff label="Cuota del mes vs. pago mínimo" diff={c.minimumDiff} />
      <Diff label="Deuda vs. extracto" diff={c.debtDiff} />
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Día `day` del mes AAAA-MM (si el mes es más corto, el último día). */
function dayIn(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${pad2(Math.min(day, last))}`;
}

/** Corte de la tarjeta en el mes AAAA-MM y su fecha de pago (vacíos si la tarjeta no tiene esos días). */
export function cutAndDue(account: Pick<Account, "statement_day" | "due_day">, month: string): { cut: string; due: string } {
  const cut = account.statement_day ? dayIn(month, account.statement_day) : "";
  if (!cut || !account.due_day) return { cut, due: "" };
  let due = dayIn(month, account.due_day);
  if (due <= cut) {
    const [y, m] = month.split("-").map(Number);
    due = dayIn(m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`, account.due_day);
  }
  return { cut, due };
}

/** Mes AAAA-MM del último corte de la tarjeta que ya pasó (el de este mes si ya llegó; si no, el del mes anterior). */
export function lastCutMonth(account: Pick<Account, "statement_day" | "due_day">, today: string): string {
  const month = today.slice(0, 7);
  const { cut } = cutAndDue(account, month);
  if (!cut || cut <= today) return month;
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

/** Cruce escrito a mano (en el Cierre del mes o en la tarjeta): no se guarda nada. */
export function ManualCrossCheck({ account, month }: { account: Account; month: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<StatementDraft>(() => ({ ...emptyDraft, ...cutAndDue(account, month) }));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted">Cruce con el extracto</p>
      {open ? (
        <div className="space-y-2 rounded-2xl border border-border p-3">
          <StatementFields value={draft} onChange={setDraft} />
          <StatementCrossCheck account={account} draft={draft} />
          <p className="text-xs text-muted">No se guarda: es solo para comparar.</p>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted">Carga el PDF arriba, o escribe el pago mínimo y la deuda del extracto para compararlos con la cuota y la deuda de la app.</p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Escribir los valores a mano</Button>
        </>
      )}
    </div>
  );
}
