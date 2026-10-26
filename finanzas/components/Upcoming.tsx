"use client";

import { useMemo } from "react";
import { CalendarClock, Check, CreditCard, Home, Lock } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import type { ScheduledPayment } from "@/lib/types";
import { dueDatesBetween, occurrencesIn, type Occurrence } from "@/lib/finance/commitments";
import { formatCop } from "@/lib/finance/money";
import { formatDay, todayBogota, type Period } from "@/lib/finance/periods";
import { accountLabel } from "@/lib/finance/labels";
import { cardDue } from "@/lib/finance/installments";
import { cn } from "@/lib/utils";

export interface CardDue {
  accountId: string;
  due: string;
  /** Lo que toca pagar en el periodo (sin las cuotas que vencen después). */
  amount: number;
  debt: number;
  interest: number;
}

/** Vencimientos visibles del periodo (hogar + mis personales) y fechas de pago de mis tarjetas con deuda. */
export function useUpcoming(period: Period) {
  const { commitments, transactions, accounts, balances, me, cardItems } = useFinance();
  return useMemo(() => {
    const today = todayBogota();
    const occ = occurrencesIn(commitments, transactions, period, today);
    const cards: CardDue[] = [];
    for (const a of accounts) {
      if (a.owner_user_id !== me.user_id || a.archived || a.kind !== "CREDIT_CARD" || !a.due_day) continue;
      const d = cardDue(a, balances[a.id] ?? 0, transactions, period, cardItems);
      if (d.due <= 0) continue;
      const fake = { frequency: "MONTHLY", day_of_month: a.due_day, start_date: period.start, end_date: null, due_date: null } as ScheduledPayment;
      for (const due of dueDatesBetween(fake, period.start, period.end)) cards.push({ accountId: a.id, due, amount: d.due, debt: d.debt, interest: d.interest });
    }
    return { occurrences: occ, cards, today };
  }, [commitments, transactions, accounts, balances, me.user_id, period, cardItems]);
}

function whenLabel(due: string, today: string, paid: boolean): { text: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (paid) return { text: "Pagado", tone: "ok" };
  if (due < today) return { text: `Vencido ${formatDay(due)}`, tone: "danger" };
  if (due === today) return { text: "Vence hoy", tone: "warn" };
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { text: days <= 3 ? `En ${days} día${days === 1 ? "" : "s"}` : formatDay(due), tone: days <= 3 ? "warn" : "muted" };
}

/** Lista de próximos vencimientos con botón para registrar el pago. */
export function UpcomingList({
  occurrences, cards, today, onEdit, limit,
}: {
  occurrences: Occurrence[];
  cards: CardDue[];
  today: string;
  onEdit?: (p: ScheduledPayment) => void;
  limit?: number;
}) {
  const { labels, memberById } = useFinance();
  const { openPayment } = useShell();
  type Row = { key: string; due: string; node: React.ReactNode };
  const rows: Row[] = [];

  for (const o of occurrences) {
    const w = whenLabel(o.due, today, !!o.paid);
    const p = o.payment;
    const resp = memberById(p.responsible_user_id);
    rows.push({
      key: `${p.id}-${o.due}`,
      due: o.due,
      node: (
        <div className="flex items-center gap-3 px-3.5 py-3">
          <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onEdit?.(p)} disabled={!onEdit}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
              {o.paid ? <Check size={17} className="text-olive" /> : <CalendarClock size={17} className="text-muted" />}
            </span>
            <span className="min-w-0">
              <span className={cn("block truncate font-medium", o.paid && "text-muted line-through")}>{p.name}</span>
              <span className="flex items-center gap-1 text-xs text-muted">
                {p.scope === "HOUSEHOLD" ? <Home size={11} /> : <Lock size={11} />}
                <span className={cn(w.tone === "danger" && "font-semibold text-danger", w.tone === "warn" && "font-semibold text-warning", w.tone === "ok" && "text-olive")}>{w.text}</span>
                {resp && <> · a cargo de {resp.display_name}</>}
              </span>
            </span>
          </button>
          <span className="num shrink-0 text-sm font-semibold">{formatCop(o.paid?.amount ?? p.amount)}</span>
          {!o.paid && (
            <button className="shrink-0 rounded-full bg-olive-soft px-3 py-1.5 text-sm font-semibold"
              onClick={() => openPayment({
                kind: p.kind, categoryId: p.category_id ?? undefined, amount: p.amount, description: p.name, scope: p.scope,
                responsibleId: p.responsible_user_id ?? undefined, scheduledPaymentId: p.id, scheduledFor: o.due, date: today,
              })}>
              Pagar
            </button>
          )}
        </div>
      ),
    });
  }
  for (const c of cards) {
    const w = whenLabel(c.due, today, false);
    rows.push({
      key: `card-${c.accountId}-${c.due}`,
      due: c.due,
      node: (
        <div className="flex items-center gap-3 px-3.5 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2"><CreditCard size={17} className="text-muted" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">Pago {accountLabel(labels, c.accountId)}</span>
            <span className="flex items-center gap-1 truncate text-xs text-muted">
              <Lock size={11} className="shrink-0" />
              <span className={cn("truncate", w.tone === "danger" && "font-semibold text-danger", w.tone === "warn" && "font-semibold text-warning")}>{w.text}{c.amount < c.debt ? ` · de ${formatCop(c.debt)} de deuda` : " · deuda actual"}{c.interest > 0 ? ` · incluye ≈${formatCop(c.interest)} de intereses` : ""}</span>
            </span>
          </span>
          <span className="num shrink-0 text-sm font-semibold">{formatCop(c.amount)}</span>
          <button className="shrink-0 rounded-full bg-olive-soft px-3 py-1.5 text-sm font-semibold"
            onClick={() => openPayment({ kind: "TRANSFER", toAccountId: c.accountId, amount: c.amount, description: "Pago de tarjeta", date: today })}>
            Pagar
          </button>
        </div>
      ),
    });
  }
  rows.sort((a, b) => a.due.localeCompare(b.due));
  const shown = limit ? rows.filter((_, i) => i < limit) : rows;
  if (shown.length === 0) return null;
  return <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">{shown.map((r) => <div key={r.key}>{r.node}</div>)}</div>;
}
