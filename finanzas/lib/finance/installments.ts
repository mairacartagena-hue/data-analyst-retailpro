// Compras a cuotas con tarjeta de crédito.
// - Presupuestos e informes: cada mes cuenta su cuota de capital (valor / cuotas), desde el mes de la compra.
// - Intereses (estimados): como cobran las tarjetas en Colombia, capital fijo por cuota e intereses sobre el
//   saldo que queda, con la tasa mensual equivalente a la efectiva anual de la tarjeta. A 1 cuota no hay intereses.
// - Saldo Seguro y aviso de pago: se aparta lo que toca pagar en el periodo, no toda la deuda.

import type { CardStatementItem, Transaction } from "@/lib/types";
import type { Period } from "./periods";

export const MAX_INSTALLMENTS = 48;

export function installmentsOf(t: Pick<Transaction, "kind" | "installments">): number {
  const n = Math.round(Number(t.installments ?? 1));
  return t.kind === "EXPENSE" && n > 1 ? Math.min(n, MAX_INSTALLMENTS) : 1;
}

/** Misma fecha k meses después (si el mes es más corto, el último día). */
export function addMonthsIso(iso: string, k: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Reparte un valor en n partes enteras; el sobrante de pesos va en la primera. */
export function splitEven(amount: number, n: number): number[] {
  const base = Math.floor(amount / n);
  const out = Array.from({ length: n }, () => base);
  out[0] += amount - base * n;
  return out;
}

/** Tasa mensual equivalente a una efectiva anual en %: 28 → 0,0208. */
export function monthlyRate(eaPercent: number | null | undefined): number {
  const ea = Number(eaPercent ?? 0);
  return ea > 0 ? Math.pow(1 + ea / 100, 1 / 12) - 1 : 0;
}

export interface Installment {
  no: number;
  date: string;
  capital: number;
  interest: number;
  total: number;
}

/** Plan de pagos de una compra: capital fijo e intereses sobre el saldo pendiente. */
export function installmentPlan(amount: number, n: number, date: string, eaPercent?: number | null): Installment[] {
  const caps = splitEven(amount, n);
  const rate = n > 1 ? monthlyRate(eaPercent) : 0;
  let balance = amount;
  return caps.map((capital, i) => {
    const interest = Math.round(balance * rate);
    balance -= capital;
    return { no: i + 1, date: addMonthsIso(date, i), capital, interest, total: capital + interest };
  });
}

/**
 * Para presupuestos e informes: cada compra a cuotas se vuelve una copia por cuota (fecha corrida un mes por
 * cuota y valores divididos). Los demás movimientos pasan igual.
 */
export function expandInstallments(txs: Transaction[]): Transaction[] {
  const out: Transaction[] = [];
  for (const t of txs) {
    const n = installmentsOf(t);
    if (n === 1) {
      out.push(t);
      continue;
    }
    const amounts = splitEven(t.amount, n);
    const splitParts = t.splits.map((s) => splitEven(s.amount, n));
    for (let k = 0; k < n; k++) {
      out.push({
        ...t,
        occurred_on: addMonthsIso(t.occurred_on, k),
        amount: amounts[k],
        installment_no: k + 1,
        installment_of: t,
        splits: t.splits.map((s, j) => ({ ...s, id: `${s.id}#${k + 1}`, amount: splitParts[j][k] })),
      });
    }
  }
  return out;
}

export interface CardDue {
  /** Deuda total de la tarjeta. */
  debt: number;
  /** Capital que no se paga en el periodo: cuotas que vencen después y compras de extractos siguientes. */
  laterCapital: number;
  /** Intereses estimados de las cuotas del periodo. */
  interest: number;
  /** Lo que toca pagar en el periodo: el extracto que vence en el periodo (o, sin fechas de corte y pago, la deuda sin las cuotas futuras) + intereses estimados. */
  due: number;
  /** Fecha de pago del extracto que vence en el periodo y su corte (solo si la tarjeta tiene día de corte y de pago). */
  dueDate?: string;
  cutDate?: string;
}

/** Lo que toca pagar de una tarjeta en el periodo, según sus compras a cuotas. */
/** Tasa de una compra: la que trae (del extracto) o, si no, la de la tarjeta. */
export function rateOf(t: { interest_rate_ea?: number | null }, card: { interest_rate_ea?: number | null }): number | null {
  return t.interest_rate_ea ?? card.interest_rate_ea ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Día `day` del mes (si el mes es más corto, el último día). */
const dayOfMonth = (y: number, m: number, day: number) => `${y}-${pad(m)}-${pad(Math.min(day, lastDayOf(y, m)))}`;

/**
 * Fechas de pago de la tarjeta que caen dentro del periodo y el corte del extracto que se paga ese día
 * (el último corte anterior a la fecha de pago). Ej.: corte el 20 y pago el 5 → el extracto del 20-sep se paga el 5-oct.
 */
export function statementsDueIn(statementDay: number, dueDay: number, period: Period): { due: string; cut: string }[] {
  const out: { due: string; cut: string }[] = [];
  let [y, m] = period.start.split("-").map(Number);
  const [ey, em] = period.end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const due = dayOfMonth(y, m, dueDay);
    if (due >= period.start && due <= period.end) {
      let cut = dayOfMonth(y, m, statementDay);
      if (cut >= due) cut = m === 1 ? dayOfMonth(y - 1, 12, statementDay) : dayOfMonth(y, m - 1, statementDay);
      out.push({ due, cut });
    }
    if (m === 12) { y++; m = 1; } else m++;
  }
  return out;
}

const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Compras del extracto que ya están registradas como movimiento (misma tarjeta, mismo valor con $1 de diferencia y
 * fecha con 1 día de diferencia). El extracto trae el saldo y las cuotas reales, así que manda sobre el movimiento:
 * el movimiento no se cuenta otra vez en cuotas futuras ni en la proyección.
 */
export function matchedWithItems(txs: Transaction[], items: CardStatementItem[]): Set<string> {
  const out = new Set<string>();
  for (const t of txs) {
    if (t.kind !== "EXPENSE") continue;
    if (items.some((i) => i.account_id === t.account_id && Math.abs(i.amount - t.amount) <= 1 && daysApart(i.purchase_date, t.occurred_on) <= 1)) out.add(t.id);
  }
  return out;
}

/** Cuántos cortes (día `statementDay`) hay después de `after` y hasta `upTo`, ambos AAAA-MM-DD. */
export function cutsBetween(statementDay: number, after: string, upTo: string): number {
  let n = 0;
  let [y, m] = after.split("-").map(Number);
  const [ey, em] = upTo.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const d = dayOfMonth(y, m, statementDay);
    if (d > after && d <= upTo) n++;
    if (m === 12) { y++; m = 1; } else m++;
  }
  return n;
}

/**
 * Compras a cuotas del extracto (no son movimientos). Su saldo pendiente todavía no se factura: cada corte que pasa
 * factura una cuota (el saldo en partes iguales, con interés sobre lo que queda). `cuts` = cuántos cortes se
 * facturan antes del pago que se está calculando. Devuelve el capital que sigue sin facturar y los intereses de esos cortes.
 */
export function statementItemsAfter(items: CardStatementItem[], cuts: number, fallbackRate?: number | null): { later: number; interest: number; capitalDue: number } {
  let later = 0;
  let interest = 0;
  let capitalDue = 0;
  for (const it of items) {
    const left = it.installments - it.paid_installments;
    if (left <= 0 || it.remaining_balance <= 0) continue;
    const r = monthlyRate(it.rate_ea ?? fallbackRate);
    const part = Math.round(it.remaining_balance / left);
    let bal = it.remaining_balance;
    for (let k = 0; k < Math.min(cuts, left) && bal > 0; k++) {
      const capital = k === left - 1 ? bal : Math.min(bal, part);
      interest += Math.round(bal * r);
      bal -= capital;
      capitalDue += capital;
    }
    later += bal;
  }
  return { later, interest, capitalDue };
}

export function cardDue(
  card: { id: string; interest_rate_ea?: number | null; statement_day?: number | null; due_day?: number | null; opening_at?: string },
  balance: number,
  txs: Transaction[],
  period: Period,
  statementItems: CardStatementItem[] = [],
): CardDue {
  const debt = Math.max(0, -balance);
  let laterCapital = 0;
  let interest = 0;
  const laterOf = new Map<string, number>(); // capital de cuotas que vencen después del periodo, por compra
  const inExtract = matchedWithItems(txs.filter((t) => t.account_id === card.id), statementItems.filter((i) => i.account_id === card.id));
  for (const t of txs) {
    if (t.account_id !== card.id || inExtract.has(t.id)) continue;
    const n = installmentsOf(t);
    if (n === 1) continue;
    let later = 0;
    for (const c of installmentPlan(t.amount, n, t.occurred_on, rateOf(t, card))) {
      if (c.date > period.end) later += c.capital;
      else if (c.date >= period.start) interest += c.interest;
    }
    laterCapital += later;
    laterOf.set(t.id, later);
  }

  // Sin día de corte y de pago no se sabe qué extracto vence: se aparta la deuda menos las cuotas futuras
  const items = statementItems.filter((i) => i.account_id === card.id);
  if (!card.statement_day || !card.due_day) {
    // Las compras a cuotas del extracto todavía no se facturan: su saldo no se paga ahora
    const later = laterCapital + statementItemsAfter(items, 0).later;
    const capitalNow = Math.max(0, debt - later);
    return { debt, laterCapital: Math.min(later, debt), interest: debt > 0 ? interest : 0, due: capitalNow + (debt > 0 ? interest : 0) };
  }

  // Con ellos solo se aparta el extracto que vence en el periodo. La deuda actual se compone de las compras más
  // recientes (lo que se pagó cubre primero lo más viejo); las posteriores al corte van en extractos siguientes.
  const statements = statementsDueIn(card.statement_day, card.due_day, period);
  const lastCut = statements.reduce((acc, x) => (x.cut > acc ? x.cut : acc), "");
  const charges = txs
    .filter((t) => t.account_id === card.id && t.kind === "EXPENSE" && t.status !== "PENDING_REVIEW")
    .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0));
  let remaining = debt;
  let billed = 0;
  let billedLater = 0;
  for (const t of charges) {
    if (remaining <= 0) break;
    const take = Math.min(t.amount, remaining);
    remaining -= take;
    if (lastCut && t.occurred_on <= lastCut) {
      billed += take;
      // lo pagado de una compra a cuotas cubre sus primeras cuotas: lo que sigue debiéndose son las últimas
      billedLater += Math.min(laterOf.get(t.id) ?? 0, take);
    }
  }
  if (lastCut) billed += remaining; // deuda anterior a todo lo registrado: ya estaba facturada
  // Compras a cuotas del extracto: lo que sigue sin facturar no se paga en este extracto
  // (cada corte después de la apertura de la tarjeta factura una cuota).
  const cuts = lastCut && card.opening_at ? cutsBetween(card.statement_day, card.opening_at.slice(0, 10), lastCut) : 0;
  const fromItems = statementItemsAfter(items, cuts, card.interest_rate_ea);
  const capitalDue = Math.max(0, Math.round(billed - billedLater - (lastCut ? fromItems.later : 0)));
  interest += lastCut ? fromItems.interest : 0;
  const first = statements[0];
  return {
    debt,
    laterCapital: Math.max(0, debt - capitalDue),
    interest: debt > 0 ? interest : 0,
    due: capitalDue + (debt > 0 ? interest : 0),
    dueDate: first?.due,
    cutDate: lastCut || undefined,
  };
}

export interface MonthProjection {
  /** Mes AAAA-MM. */
  month: string;
  capital: number;
  interest: number;
  total: number;
  /** Compras que tienen cuota ese mes. */
  purchases: number;
}

/**
 * Cuotas que faltan por pagar, mes a mes, de las compras a cuotas registradas en la tarjeta.
 * Empieza en el mes de `from` y sigue `months` meses. Solo cuenta las cuotas que aún no vencen.
 */
export function projectCard(
  card: { id: string; interest_rate_ea?: number | null },
  txs: Transaction[],
  from: string,
  months: number,
  statementItems: CardStatementItem[] = [],
): MonthProjection[] {
  const start = from.slice(0, 7);
  const out = Array.from({ length: months }, (_, i) => {
    const [y, m] = start.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return { month: d.toISOString().slice(0, 7), capital: 0, interest: 0, total: 0, purchases: 0 };
  });
  const index = new Map(out.map((r, i) => [r.month, i]));
  const inExtract = matchedWithItems(txs.filter((t) => t.account_id === card.id), statementItems.filter((i) => i.account_id === card.id));
  for (const t of txs) {
    if (t.account_id !== card.id || inExtract.has(t.id)) continue;
    const n = installmentsOf(t);
    if (n === 1) continue;
    const seen = new Set<string>();
    for (const c of installmentPlan(t.amount, n, t.occurred_on, rateOf(t, card))) {
      const i = index.get(c.date.slice(0, 7));
      if (i === undefined || c.date < from.slice(0, 7) + "-01") continue;
      out[i].capital += c.capital;
      out[i].interest += c.interest;
      out[i].total += c.total;
      if (!seen.has(out[i].month)) {
        seen.add(out[i].month);
        out[i].purchases++;
      }
    }
  }
  // Compras del extracto (no son movimientos): el saldo que falta se reparte en partes iguales
  // por cuota restante, con interés sobre el saldo. Empiezan el mes siguiente al de `from`.
  for (const it of statementItems) {
    const left = it.installments - it.paid_installments;
    if (left <= 0 || it.remaining_balance <= 0) continue;
    const r = monthlyRate(it.rate_ea ?? card.interest_rate_ea);
    let bal = it.remaining_balance;
    const seen = new Set<string>();
    for (let k = 0; k < left && bal > 0; k++) {
      const i = k + 1;
      if (i >= out.length) break;
      const capital = k === left - 1 ? bal : Math.min(bal, Math.round(it.remaining_balance / left));
      const interest = Math.round(bal * r);
      bal -= capital;
      out[i].capital += capital;
      out[i].interest += interest;
      out[i].total += capital + interest;
      if (!seen.has(out[i].month)) {
        seen.add(out[i].month);
        out[i].purchases++;
      }
    }
  }
  return out;
}
