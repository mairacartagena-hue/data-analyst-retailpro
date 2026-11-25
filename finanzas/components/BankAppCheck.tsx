"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { Field, Input } from "@/components/ui/input";
import type { Account } from "@/lib/types";
import { threeWayCheck, type ThreeWayCheck } from "@/lib/finance/bankBalance";
import { STATEMENT_TOLERANCE } from "@/lib/finance/cardStatements";
import { formatCop, parseCop } from "@/lib/finance/money";
import { formatDay, todayBogota } from "@/lib/finance/periods";
import { effectOn } from "@/lib/finance/reconcile";
import { cn } from "@/lib/utils";

/**
 * Lo que la persona ve HOY en la app del banco, contra el extracto (que trae otra fecha). Con los dos valores se ve si la
 * diferencia ya estaba en el corte del extracto o apareció después. No cambia el cierre: es una pista para encontrar el error.
 */
export function BankAppCheck({ account, isDebt, extractValue, extractDate, value, onValue, date, onDate, onSave, busy }: {
  account: Account;
  isDebt: boolean;
  /** Lo que escribió la persona del extracto (null si todavía no). */
  extractValue: number | null;
  /** Fecha a la que está el extracto: el corte de la tarjeta o el fin de mes. */
  extractDate: string;
  value: string;
  onValue: (v: string) => void;
  date: string;
  onDate: (v: string) => void;
  /** Guardar lo escrito en el cierre ya hecho; solo si hay algo distinto de lo guardado. */
  onSave?: () => void;
  busy?: boolean;
}) {
  const { transactions } = useFinance();
  const bankValue = parseCop(value);
  const check = useMemo(
    () => (extractValue === null || bankValue === null ? null : threeWayCheck({ account, txs: transactions, isDebt, extractValue, extractDate, bankValue, bankDate: date })),
    [account, transactions, isDebt, extractValue, extractDate, bankValue, date],
  );
  const noun = isDebt ? "deuda" : "saldo";
  const gap = (d: number) => (Math.abs(d) <= STATEMENT_TOLERANCE ? "cuadra" : `la app ${isDebt ? "debe" : "tiene"} ${formatCop(Math.abs(d))} ${d > 0 ? "más" : "menos"}`);

  return (
    <Collapsible title="Lo que ves hoy en la app del banco" summary={check ? SUMMARY[check.diagnosis] : undefined} defaultOpen={bankValue !== null}>
      <p className="text-xs text-muted">
        El extracto trae el {noun} a su fecha; la app del banco, el de hoy. Con los dos veo si lo que no cuadra ya estaba en el extracto (al {formatDay(extractDate)}) o apareció después.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label={isDebt ? "Deuda en la app del banco" : "Saldo en la app del banco"}><AmountInput value={value} onChange={onValue} /></Field>
        <Field label="Lo miraste el"><Input type="date" value={date} max={todayBogota()} onChange={(e) => e.target.value && onDate(e.target.value)} /></Field>
      </div>
      {extractValue === null && bankValue !== null && <p className="text-xs text-muted">Escribe también el {noun} del extracto, arriba, para compararlos.</p>}
      {extractValue !== null && bankValue !== null && check === null && (
        <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs">Lo miraste antes de la fecha del extracto ({formatDay(extractDate)}): usa una fecha igual o posterior.</p>
      )}
      {check && <Result check={check} account={account} isDebt={isDebt} gap={gap} extractValue={extractValue ?? 0} bankValue={bankValue ?? 0} />}
      {onSave && <Button variant="outline" size="sm" className="w-full" disabled={busy} onClick={onSave}>Guardar lo que veo en el banco</Button>}
    </Collapsible>
  );
}

const SUMMARY: Record<ThreeWayCheck["diagnosis"], string> = {
  OK: "cuadra", FIXED_SINCE: "revisar", NEW_SINCE: "revisar", SAME_GAP: "revisar", BOTH_GAPS: "revisar",
};

function Result({ check: c, account, isDebt, gap, extractValue, bankValue }: {
  check: ThreeWayCheck; account: Account; isDebt: boolean; gap: (d: number) => string; extractValue: number; bankValue: number;
}) {
  const ok = c.diagnosis === "OK" && !c.sourcesDisagree;
  const message: Record<ThreeWayCheck["diagnosis"], string> = {
    OK: `La app cuadra con el extracto y con lo que ves hoy en el banco.`,
    NEW_SINCE: `Al corte cuadraba. La diferencia de hoy (${gap(c.bankDiff)}) viene de lo que pasó después del corte: revisa los movimientos de abajo, o si el banco todavía no los procesó.`,
    SAME_GAP: `La diferencia (${gap(c.extractDiff)}) ya estaba en el corte y sigue igual: falta o sobra un movimiento de antes. Búscalo en “Revisar los movimientos”.`,
    FIXED_SINCE: `Al corte no cuadraba (${gap(c.extractDiff)}) pero hoy sí: lo que faltaba se registró después, o hay un movimiento con otra fecha. Revisa los de fechas cercanas al corte.`,
    BOTH_GAPS: `Hay una diferencia de antes del corte (${gap(c.extractDiff)}) y otra de después (${gap(c.sinceDiff)}). Son dos errores distintos: arréglalos por separado.`,
  };
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted" />
        <dd className="text-right text-muted">{isDebt ? "Deuda" : "Saldo"} real</dd>
        <dd className="text-right text-muted">En la app</dd>
        <dt>Extracto · {formatDay(c.extractDate)}</dt><dd className="num text-right">{formatCop(extractValue)}</dd><dd className="num text-right">{formatCop(c.appAtExtract)}</dd>
        <dt>App del banco · {formatDay(c.bankDate)}</dt><dd className="num text-right">{formatCop(bankValue)}</dd><dd className="num text-right">{formatCop(c.appAtBank)}</dd>
      </dl>
      <p className="text-xs text-muted">
        Desde el corte el banco movió {formatCop(Math.abs(c.bankSince))} {isDebt ? (c.bankSince >= 0 ? "más de deuda" : "menos de deuda") : (c.bankSince >= 0 ? "a favor" : "en contra")} y la app {formatCop(Math.abs(c.appSince))}.
      </p>
      {c.sourcesDisagree ? (
        <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" />
          El extracto y la app del banco son del mismo día y dicen valores distintos ({formatCop(extractValue)} y {formatCop(bankValue)}): revisa cuál escribiste mal.
        </p>
      ) : (
        <p className={cn("flex items-start gap-2 rounded-xl px-3 py-2", ok ? "bg-olive-soft" : "bg-warning-soft")}>
          {ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          {message[c.diagnosis]}
        </p>
      )}
      {c.sinceTxs.length > 0 && c.diagnosis !== "OK" && (
        <>
          <p className="text-xs font-medium">Movimientos de la app desde el corte ({c.sinceTxs.length})</p>
          <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-surface">
            {c.sinceTxs.slice(-12).map((t) => {
              const e = effectOn(account.id, t);
              return (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{formatDay(t.occurred_on)} · {t.merchant || t.description || "Movimiento"}</span>
                  <span className="num shrink-0">{(isDebt ? -e : e) > 0 ? "+" : "−"}{formatCop(Math.abs(e))}</span>
                </li>
              );
            })}
          </ul>
          {c.sinceTxs.length > 12 && <p className="text-xs text-muted">Se muestran los 12 más recientes.</p>}
        </>
      )}
    </div>
  );
}
