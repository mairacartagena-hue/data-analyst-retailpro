"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarClock, Check, CreditCard, Home, Lock } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import type { ScheduledPayment } from "@/lib/types";
import { dueDatesBetween, occurrencesIn, type Occurrence } from "@/lib/finance/commitments";
import { formatCop } from "@/lib/finance/money";
import { formatDay, todayBogota, type Period } from "@/lib/finance/periods";
import { accountLabel } from "@/lib/finance/labels";
import { cardDue, statementsDueIn } from "@/lib/finance/installments";
import { creditReserve, nextCuota } from "@/lib/finance/credit";
import { responsibleOf } from "@/lib/finance/derive";
import { creditBudgetMap } from "@/lib/finance/spaces";
import { cardBudgetMap, legacySchedule } from "@/lib/finance/cardBudget";
import { obligationDues, type ObligationDue } from "@/lib/finance/obligationDues";
import { cn } from "@/lib/utils";

export interface CardDue {
  accountId: string;
  due: string;
  /** Lo que toca pagar en el periodo (sin las cuotas que vencen después). */
  amount: number;
  debt: number;
  interest: number;
  /** Cuota de un crédito (no tarjeta): se paga desde la hoja del crédito. */
  credit?: boolean;
  /** Ya se pagó: la cuota del crédito (abono después del corte anterior) o el extracto de la tarjeta. */
  paid?: boolean;
  /** Tarjeta con presupuesto: cuota de la deuda que ya traía que vence ese día (va en su presupuesto). */
  cuota?: number;
}

/**
 * Vencimientos visibles del periodo (hogar + mis personales) y fechas de pago de mis tarjetas con deuda: las que tengo a
 * cargo y las mías con presupuesto (su cuota está en Presupuestos aunque la pague mi pareja).
 */
export function useUpcoming(period: Period) {
  const { commitments, transactions, accounts, balances, me, cardItems, obligationDebts, limits, budgets } = useFinance();
  return useMemo(() => {
    const today = todayBogota();
    const occ = occurrencesIn(commitments, transactions, period, today, new Map([...creditBudgetMap(accounts), ...cardBudgetMap(accounts)]));
    const cards: CardDue[] = [];
    for (const a of accounts) {
      if (a.archived || a.kind !== "CREDIT_CARD" || !a.due_day) continue;
      if (responsibleOf(a) !== me.user_id && !(a.budget_category_id && a.owner_user_id === me.user_id)) continue;
      const d = cardDue(a, balances[a.id] ?? 0, transactions, period, cardItems);
      // Pagado: ya no queda nada del extracto y hubo un pago a la tarjeta después de su corte
      const paidAmount = d.cutDate
        ? transactions.filter((t) => t.to_account_id === a.id && (t.kind === "TRANSFER" || t.kind === "SETTLEMENT") && t.status !== "PENDING_REVIEW" && t.occurred_on > d.cutDate!)
          .reduce((sum, t) => sum + t.amount, 0)
        : 0;
      if (d.due <= 0 && paidAmount <= 0) continue;
      const fake = { frequency: "MONTHLY", day_of_month: a.due_day, start_date: period.start, end_date: null, due_date: null } as ScheduledPayment;
      const plan = a.budget_category_id ? legacySchedule({ ...a, opening_balance: Number(a.opening_balance) }, cardItems) : [];
      for (const due of dueDatesBetween(fake, period.start, period.end)) {
        const cuota = plan.filter((c) => c.due === due).reduce((sum, c) => sum + c.amount, 0);
        cards.push({ accountId: a.id, due, amount: d.due > 0 ? d.due : paidAmount, debt: d.debt, interest: d.due > 0 ? d.interest : 0, paid: d.due <= 0, cuota: cuota || undefined });
      }
    }
    // Cuotas de créditos con día de pago: vencen en el periodo y quedan pagadas con el abono después del corte anterior
    for (const a of accounts) {
      if (responsibleOf(a) !== me.user_id || a.archived || (a.kind !== "CREDIT" && a.kind !== "LOAN") || !a.due_day) continue;
      const owed = Math.max(0, -(balances[a.id] ?? 0));
      const cuota = nextCuota(owed, a, today);
      if (cuota <= 0) continue;
      for (const { due } of statementsDueIn(a.due_day, a.due_day, period)) {
        // Lo que falta reservar de la cuota de ese día de pago: 0 = ya se pagó
        const paid = creditReserve(a, balances[a.id] ?? 0, transactions, { ...period, start: due, end: due }, today) === 0;
        cards.push({ accountId: a.id, due, amount: cuota, debt: owed, interest: 0, credit: true, paid });
      }
    }
    // Cuotas de presupuestos obligatorios del hogar que paga la pareja: también se ven aquí
    const obligations = obligationDues({ meId: me.user_id, debts: obligationDebts, accounts, limits, budgets, transactions }, period);
    return { occurrences: occ, cards, obligations, today };
  }, [commitments, transactions, accounts, balances, me.user_id, period, cardItems, obligationDebts, limits, budgets]);
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
  occurrences, cards, obligations = [], today, onEdit, limit,
}: {
  occurrences: Occurrence[];
  cards: CardDue[];
  obligations?: ObligationDue[];
  today: string;
  onEdit?: (p: ScheduledPayment) => void;
  limit?: number;
}) {
  const { labels, memberById, me, partner } = useFinance();
  const bySlot = (slot: "A" | "B") => [me, partner].find((m) => m?.slot === slot)?.user_id;
  const { openPayment } = useShell();
  const router = useRouter();
  type Row = { key: string; due: string; node: React.ReactNode };
  const rows: Row[] = [];

  for (const o of occurrences) {
    const w = whenLabel(o.due, today, !!o.paid);
    const p = o.payment;
    const resp = memberById(p.responsible_user_id);
    const shared = p.share_a != null && p.share_b != null;
    const shares = shared ? [{ userId: bySlot("A"), amount: Number(p.share_a) }, { userId: bySlot("B"), amount: Number(p.share_b) }]
      .filter((x): x is { userId: string; amount: number } => !!x.userId) : undefined;
    rows.push({
      key: `${p.id}-${o.due}`,
      due: o.due,
      node: (
        <DueRow
          icon={<CalendarClock size={17} className="text-muted" />}
          title={p.name}
          household={p.scope === "HOUSEHOLD"}
          when={w}
          detail={`${o.paid ? ` · vencía el ${formatDay(o.due)}` : ""}${shared ? " · compartido" : resp ? ` · a cargo de ${resp.display_name}` : ""}`}
          amount={o.paid?.amount ?? p.amount}
          paid={!!o.paid}
          onOpen={onEdit ? () => onEdit(p) : undefined}
          onPay={() => openPayment({
            kind: p.kind, categoryId: p.category_id ?? undefined, amount: p.amount, description: p.name, scope: p.scope,
            responsibleId: p.responsible_user_id ?? undefined, scheduledPaymentId: p.id, scheduledFor: o.due, date: today, shares,
          })}
        />
      ),
    });
  }
  for (const c of cards) {
    const w = whenLabel(c.due, today, !!c.paid);
    if (c.credit) {
      rows.push({
        key: `credit-${c.accountId}-${c.due}`,
        due: c.due,
        node: (
          <DueRow
            icon={<Building2 size={17} className="text-muted" />}
            title={`Cuota ${accountLabel(labels, c.accountId)}`}
            when={w}
            detail={c.paid ? ` · vencía el ${formatDay(c.due)}` : " · cuota estimada"}
            amount={c.amount}
            paid={!!c.paid}
            onPay={() => router.push(`/cuentas?vista=creditos&cuenta=${c.accountId}&cuota=1`)}
          />
        ),
      });
      continue;
    }
    rows.push({
      key: `card-${c.accountId}-${c.due}`,
      due: c.due,
      node: (
        <DueRow
          icon={<CreditCard size={17} className="text-muted" />}
          title={`Pago ${accountLabel(labels, c.accountId)}`}
          when={w}
          detail={c.paid ? ` · vencía el ${formatDay(c.due)}` : `${c.cuota ? ` · cuota del presupuesto ${formatCop(c.cuota)}` : ""}${c.amount < c.debt ? ` · de ${formatCop(c.debt)} de deuda` : " · deuda actual"}${c.interest > 0 ? ` · incluye ≈${formatCop(c.interest)} de intereses` : ""}`}
          amount={c.amount}
          paid={!!c.paid}
          onPay={() => openPayment({ kind: "TRANSFER", toAccountId: c.accountId, amount: c.amount, description: "Pago de tarjeta", date: today })}
        />
      ),
    });
  }
  for (const o of obligations) {
    const w = whenLabel(o.due, today, o.paid);
    const resp = memberById(o.responsibleId);
    rows.push({
      key: `obligation-${o.accountId}-${o.due}`,
      due: o.due,
      node: (
        <DueRow
          icon={o.kind === "CREDIT_CARD" ? <CreditCard size={17} className="text-muted" /> : <Building2 size={17} className="text-muted" />}
          title={`Cuota ${o.name}`}
          household
          when={w}
          detail={`${o.paid ? ` · vencía el ${formatDay(o.due)}` : ""} · obligatorio del hogar${resp ? ` · a cargo de ${resp.display_name}` : ""}`}
          amount={o.amount}
          paid={o.paid}
          onPay={() => openPayment({ categoryId: o.categoryId, amount: o.amount, description: `Cuota ${o.name}`, scope: "HOUSEHOLD", responsibleId: o.responsibleId, date: today })}
        />
      ),
    });
  }
  rows.sort((a, b) => a.due.localeCompare(b.due));
  const shown = limit ? rows.filter((_, i) => i < limit) : rows;
  if (shown.length === 0) return null;
  return <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">{shown.map((r) => <div key={r.key}>{r.node}</div>)}</div>;
}

/**
 * Una fila de Vencimientos: todas con el mismo formato (ícono, nombre en una línea, detalle en una línea,
 * monto y, si falta pagar, el botón Pagar debajo del monto para que el nombre no quede tan cortado).
 */
function DueRow({ icon, title, household = false, when, detail, amount, paid, onOpen, onPay }: {
  icon: React.ReactNode;
  title: string;
  household?: boolean;
  when: ReturnType<typeof whenLabel>;
  detail: string;
  amount: number;
  paid: boolean;
  onOpen?: () => void;
  onPay: () => void;
}) {
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
        {paid ? <Check size={17} className="text-olive" /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-medium", paid && "text-muted line-through")}>{title}</span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted">
          {household ? <Home size={11} className="shrink-0" /> : <Lock size={11} className="shrink-0" />}
          <span className="truncate">
            <span className={cn(when.tone === "danger" && "font-semibold text-danger", when.tone === "warn" && "font-semibold text-warning", when.tone === "ok" && "text-olive")}>{when.text}</span>
            {detail}
          </span>
        </span>
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      {onOpen
        ? <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onOpen}>{body}</button>
        : <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>}
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className={cn("num text-sm font-semibold", paid && "text-muted")}>{formatCop(amount)}</span>
        {!paid && (
          <button className="rounded-full bg-olive-soft px-3 py-1 text-xs font-semibold" onClick={onPay}>Pagar</button>
        )}
      </span>
    </div>
  );
}
