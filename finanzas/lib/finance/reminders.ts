// Recordatorios para las notificaciones: la app los calcula con los datos del celular y los deja programados
// (push_schedule). La tarea diaria de Vercel envía los del día. Los movimientos por revisar los suma la base de datos.

import type { Account, CardStatementItem, ScheduledPayment, Transaction } from "@/lib/types";
import type { Reconciliation } from "@/lib/types";
import { occurrencesIn } from "./commitments";
import { cardDue, statementsDueIn } from "./installments";
import { creditReserve, isCreditKind, nextCuota } from "./credit";
import { formatCop } from "./money";
import { addDays, monthName } from "./periods";

export interface Reminder {
  key: string;
  send_on: string;
  title: string;
  body: string;
  url: string;
}

export interface ReminderInput {
  me: string;
  today: string;
  accounts: Account[];
  balances: Record<string, number>;
  transactions: Transaction[];
  commitments: ScheduledPayment[];
  cardItems: CardStatementItem[];
  reconciliations: Pick<Reconciliation, "account_id" | "month" | "status">[];
}

/** Días hacia adelante que se programan. Se recalculan cada vez que se abre la app. */
export const REMINDER_DAYS = 35;

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function nextMonthStart(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function dayIn(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month.slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function buildReminders(s: ReminderInput): Reminder[] {
  const out: Reminder[] = [];
  const { today, me } = s;
  const end = addDays(today, REMINDER_DAYS);
  const window = { start: today, end };
  const push = (r: Reminder) => {
    if (r.send_on >= today && r.send_on <= end) out.push(r);
  };
  const mine = s.accounts.filter((a) => a.owner_user_id === me && !a.archived);

  // 1. Vencimientos (compromisos) sin pagar de los que soy responsable: el día antes y el mismo día
  const occ = occurrencesIn(s.commitments, s.transactions, { start: today, end: addDays(end, 1) }, today);
  for (const o of occ) {
    if (o.paid) continue;
    if ((o.payment.responsible_user_id ?? o.payment.owner_user_id) !== me) continue;
    const name = o.payment.name;
    const body = `${formatCop(o.payment.amount)} · toca para registrar el pago`;
    push({ key: `pago:${o.payment.id}:${o.due}:-1`, send_on: addDays(o.due, -1), title: `Mañana vence ${name}`, body, url: "/presupuestos" });
    push({ key: `pago:${o.payment.id}:${o.due}:0`, send_on: o.due, title: `Hoy vence ${name}`, body, url: "/presupuestos" });
  }

  for (const a of mine) {
    const balance = s.balances[a.id] ?? 0;
    const owed = Math.max(0, -balance);

    // 2. Pago de la tarjeta: el día antes y el mismo día
    if (a.kind === "CREDIT_CARD" && a.due_day && owed > 0) {
      for (const { due } of statementsDueIn(a.statement_day ?? a.due_day, a.due_day, window)) {
        const amount = cardDue(a, balance, s.transactions, { start: due, end: due }, s.cardItems).due;
        if (amount <= 0) continue;
        const body = `Paga ${formatCop(amount)} para no generar intereses de mora.`;
        push({ key: `tarjeta:${a.id}:${due}:-1`, send_on: addDays(due, -1), title: `Mañana vence el pago de ${a.name}`, body, url: "/cuentas" });
        push({ key: `tarjeta:${a.id}:${due}:0`, send_on: due, title: `Hoy vence el pago de ${a.name}`, body, url: "/cuentas" });
      }
    }

    // 3. Cuota del crédito (el día antes) y confirmar el saldo con el extracto (el día después del pago)
    if (a.kind === "CREDIT" && owed > 0) {
      if (a.due_day) {
        const cuota = nextCuota(owed, a.interest_rate_ea, a.term_months, a.opening_at, a.monthly_costs ?? 0, today);
        for (const { due } of statementsDueIn(a.statement_day ?? a.due_day, a.due_day, window)) {
          if (creditReserve(a, balance, s.transactions, { start: due, end: due }, today) <= 0) continue; // ya abonada
          push({ key: `credito:${a.id}:${due}`, send_on: addDays(due, -1), title: `Mañana se paga la cuota de ${a.name}`, body: `Cuota estimada ${formatCop(cuota)}.`, url: "/cuentas?vista=creditos" });
        }
      }
      for (const month of [monthStart(today), nextMonthStart(today)]) {
        if (s.reconciliations.some((r) => r.account_id === a.id && r.month === month && r.status === "RECONCILED")) continue;
        if (a.opening_at && a.opening_at.slice(0, 10) >= month) continue;
        const day = dayIn(month, (a.due_day ?? 0) + 1);
        push({ key: `credito-saldo:${a.id}:${month}`, send_on: day < today ? today : day,
          title: `¿El saldo de ${a.name} es ${formatCop(owed)}?`, body: "Confírmalo o corrígelo con el extracto.", url: "/" });
      }
    }
  }

  // 4. Cierre del mes: el primer día del mes siguiente, si faltan cuentas o créditos por conciliar
  const month = monthStart(today);
  const missing = mine.filter((a) => !s.reconciliations.some((r) => r.account_id === a.id && r.month === month && r.status === "RECONCILED"));
  if (missing.length > 0) {
    const credits = missing.filter((a) => isCreditKind(a.kind)).length;
    const accounts = missing.length - credits;
    const parts = [accounts ? `${accounts} cuenta${accounts === 1 ? "" : "s"}` : "", credits ? `${credits} crédito${credits === 1 ? "" : "s"}` : ""].filter(Boolean);
    push({ key: `cierre:${month.slice(0, 7)}`, send_on: nextMonthStart(today),
      title: `Haz el cierre de ${monthName(Number(month.slice(5, 7)) - 1, true)}`, body: `Falta conciliar ${parts.join(" y ")}.`, url: `/cierre?mes=${month.slice(0, 7)}` });
  }

  return out.sort((x, y) => (x.send_on < y.send_on ? -1 : x.send_on > y.send_on ? 1 : x.key.localeCompare(y.key)));
}
