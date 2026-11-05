// Cierre del mes: estado de cuenta según la app (saldo inicial, entradas, salidas, saldo final)
// y estimado del 4x1000 (GMF). Replica la regla de account_balances(): un movimiento cuenta para el saldo
// solo si ocurrió desde el momento del saldo inicial de la cuenta (opening_at).

import type { Account, Reconciliation, ReconcilingItem, Transaction } from "@/lib/types";
export type { ReconcilingItem } from "@/lib/types";
import { addDays } from "./periods";
import { accountSign } from "./spaces";

export type GmfMode = "TAXED" | "EXEMPT_350" | "LOW_AMOUNT_65";

export const GMF_RATE = 0.004;
export const GMF_EXEMPT_UVT: Record<GmfMode, number> = { TAXED: 0, EXEMPT_350: 350, LOW_AMOUNT_65: 65 };

export interface MonthRange {
  month: string; // "YYYY-MM"
  start: string; // "YYYY-MM-01"
  end: string; // último día
}

export function monthRange(month: string): MonthRange {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { month, start, end: addDays(next, -1) };
}

/**
 * Periodo que cierra una cuenta en el mes. Las tarjetas con día de corte se concilian con el extracto: van del día
 * siguiente al corte del mes anterior hasta el corte de este mes, así las compras posteriores al corte (que el banco
 * factura en el próximo extracto) no descuadran el cierre. Las demás cuentas usan el mes calendario.
 */
export function closeRange(account: Pick<Account, "kind" | "statement_day">, month: string): MonthRange {
  const cal = monthRange(month);
  const day = account.kind === "CREDIT_CARD" ? account.statement_day : null;
  if (!day) return cal;
  const cutIn = (m: string) => {
    const last = Number(monthRange(m).end.slice(8));
    return `${m}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  return { month, start: addDays(cutIn(shiftMonth(month, -1)), 1), end: cutIn(month) };
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Momento efectivo: la hora real si existe; si no, el final del día (hora de Bogotá). */
export function effectiveAt(t: Pick<Transaction, "occurred_at" | "occurred_on">): number {
  return t.occurred_at ? Date.parse(t.occurred_at) : Date.parse(`${t.occurred_on}T23:59:59-05:00`);
}

/** Efecto de un movimiento sobre el saldo de una cuenta (+ entra, − sale, 0 no la toca). */
export function effectOn(accountId: string, t: Transaction): number {
  let e = 0;
  if (t.account_id === accountId) e += accountSign(t) * t.amount;
  if (t.to_account_id === accountId) e += t.amount;
  return e;
}

export interface AccountStatement {
  opening: number; // saldo al empezar el mes (o al abrir la cuenta en la app)
  inflow: number;
  outflow: number;
  closing: number;
  items: Transaction[];
  gmfBase: number; // salidas sujetas a 4x1000
  gmfRecorded: number; // 4x1000 ya registrado en el mes
  pending: number; // movimientos por revisar en el mes
}

export function accountStatement(account: Account, txs: Transaction[], range: MonthRange): AccountStatement {
  // El saldo inicial de la cuenta es un punto conocido (opening_balance en opening_at).
  // Saldo en cualquier momento T = saldo inicial + movimientos entre opening_at y T (restando los que van hacia atrás).
  const openingAt = account.opening_at ? Date.parse(account.opening_at) : 0;
  const monthStart = Date.parse(`${range.start}T00:00:00-05:00`);
  const monthEnd = Date.parse(`${range.end}T23:59:59.999-05:00`);
  let opening = account.opening_balance;
  let inflow = 0;
  let outflow = 0;
  let gmfBase = 0;
  let gmfRecorded = 0;
  let pending = 0;
  const items: Transaction[] = [];

  for (const t of txs) {
    const e = effectOn(account.id, t);
    if (e === 0) continue;
    const at = effectiveAt(t);
    // Saldo al empezar el mes: sumar lo que pasó entre el saldo inicial y el mes, o quitar lo que pasó entre el mes y el saldo inicial
    if (at < monthStart && at >= openingAt) opening += e;
    if (at >= monthStart && at < openingAt) opening -= e;
    if (at < monthStart || at > monthEnd) continue;
    items.push(t);
    if (t.status === "PENDING_REVIEW") pending++;
    if (e > 0) inflow += e;
    else {
      outflow += -e;
      if (t.tags.includes("#gmf")) gmfRecorded += -e;
      else gmfBase += -e;
    }
  }
  items.sort((a, b) => effectiveAt(b) - effectiveAt(a));
  return { opening, inflow, outflow, closing: opening + inflow - outflow, items, gmfBase, gmfRecorded, pending };
}

/** 4x1000 estimado del mes: 0,4 % de lo que sale por encima del tope exento. */
export function gmfEstimate(outflow: number, mode: GmfMode, uvt: number): number {
  const cap = GMF_EXEMPT_UVT[mode] * uvt;
  return Math.round(Math.max(0, outflow - cap) * GMF_RATE);
}

/** Mes que conviene cerrar hoy: el anterior durante los primeros 5 días; si no, el actual. */
export function suggestedCloseMonth(today: string): string {
  const day = Number(today.slice(8, 10));
  const month = today.slice(0, 7);
  return day <= 5 ? shiftMonth(month, -1) : month;
}

/** ¿Mostrar el recordatorio de cierre? Últimos 3 días del mes o primeros 5 del siguiente. */
export function inCloseWindow(today: string): boolean {
  const day = Number(today.slice(8, 10));
  const end = monthRange(today.slice(0, 7)).end;
  return day <= 5 || today >= addDays(end, -2);
}

/** Saldo de la cuenta en un momento dado, con los datos de hoy. `at` cambia el momento efectivo de un movimiento. */
export function balanceAt(account: Account, txs: Transaction[], atMs: number, at: (t: Transaction) => number = effectiveAt): number {
  const openingAt = account.opening_at ? Date.parse(account.opening_at) : 0;
  let b = account.opening_balance;
  for (const t of txs) {
    const e = effectOn(account.id, t);
    if (e === 0) continue;
    const when = at(t);
    if (when >= openingAt && when <= atMs) b += e;
    else if (when < openingAt && when > atMs) b -= e;
  }
  return b;
}

type RecLike = Pick<Reconciliation, "month" | "status" | "statement_balance" | "updated_at"> & {
  cut_date?: string | null;
  reconciled_at?: string | null;
  reconciling_items?: ReconcilingItem[] | null;
};

const bogotaDay = (ms: number) => new Date(ms - 5 * 3_600_000).toISOString().slice(0, 10);

/** Momento hasta el que vale una conciliación: el corte (o el final del mes), o el momento de conciliar si fue antes. */
function recCutoffMs(rec: RecLike): number {
  const end = rec.cut_date ?? monthRange(rec.month.slice(0, 7)).end;
  return Math.min(Date.parse(rec.reconciled_at ?? rec.updated_at), Date.parse(`${end}T23:59:59.999-05:00`));
}

/** Día hasta el que está conciliada la cuenta (su conciliación más reciente), o null si no tiene. */
export function reconciledThrough(accountId: string, recs: (RecLike & { account_id: string })[]): string | null {
  const rec = recs.filter((r) => r.account_id === accountId && r.status === "RECONCILED").sort((x, y) => y.month.localeCompare(x.month))[0];
  return rec ? bogotaDay(recCutoffMs(rec)) : null;
}

export interface ReconciliationDrift {
  /** Saldo de la app hoy al corte de la conciliación menos el saldo conciliado (+ la app subió, − bajó). */
  drift: number;
  /** Saldo de la app hoy a ese corte. */
  now: number;
  /** Saldo conciliado. */
  reconciled: number;
  /** Fecha de corte (YYYY-MM-DD). */
  cutoff: string;
  /** Movimientos de antes del corte creados o editados después de conciliar (o de la última revisión). */
  changed: Transaction[];
  /** Partidas conciliatorias ya aceptadas (suma de su efecto). */
  accepted: number;
}

/**
 * ¿Se movió una cuenta ya conciliada? Compara el saldo conciliado con el saldo de la app hoy a la misma fecha de corte
 * (el último día del mes; si se concilió antes de que terminara el mes, el día en que se concilió). Si alguien
 * registró, editó o borró movimientos de antes del corte, o cambió el saldo inicial, la diferencia deja de ser 0.
 */
export function reconciliationDrift(account: Account, txs: Transaction[], rec: RecLike): ReconciliationDrift | null {
  if (rec.status !== "RECONCILED") return null;
  // La conciliación vale hasta el corte; las partidas conciliatorias aceptadas explican la diferencia con la app
  const cutoffMs = recCutoffMs(rec);
  const cutoff = bogotaDay(cutoffMs);
  // Los movimientos sin hora del mismo día del corte cuentan dentro del corte
  const at = (t: Transaction) => (!t.occurred_at && t.occurred_on === cutoff ? cutoffMs : effectiveAt(t));
  const now = balanceAt(account, txs, cutoffMs, at);
  const accepted = (rec.reconciling_items ?? []).reduce((a, i) => a + i.amount, 0);
  const drift = Math.round(now - rec.statement_balance - accepted);
  if (drift === 0) return null;
  // Cambios desde la última revisión (conciliar o aceptar partidas)
  const reviewedMs = Date.parse(rec.updated_at);
  const changed = txs.filter((t) => effectOn(account.id, t) !== 0 && at(t) <= cutoffMs
    && Math.max(Date.parse(t.created_at), t.updated_at ? Date.parse(t.updated_at) : 0) > reviewedMs);
  return { drift, now, reconciled: rec.statement_balance, cutoff, changed, accepted };
}

/**
 * Acepta como partidas conciliatorias lo que movió una cuenta conciliada: los movimientos que cambiaron (con su efecto
 * actual, reemplazando la partida anterior del mismo movimiento) y, si queda algo, una partida por la diferencia
 * (movimiento borrado o cambio del saldo inicial). Con ellas la conciliación vuelve a cuadrar.
 */
export function acceptDrift(account: Account, txs: Transaction[], rec: RecLike): ReconcilingItem[] {
  const prev = rec.reconciling_items ?? [];
  const d = reconciliationDrift(account, txs, rec);
  if (!d) return prev;
  const ids = new Set(d.changed.map((t) => t.id));
  const kept = prev.filter((i) => !i.transaction_id || !ids.has(i.transaction_id));
  const fresh: ReconcilingItem[] = d.changed.map((t) => ({
    transaction_id: t.id, amount: effectOn(account.id, t), description: t.merchant || t.description || "Movimiento", occurred_on: t.occurred_on,
  }));
  const sum = (l: ReconcilingItem[]) => l.reduce((a, i) => a + i.amount, 0);
  const rest = Math.round(d.now - rec.statement_balance - sum(kept) - sum(fresh));
  return rest === 0 ? [...kept, ...fresh]
    : [...kept, ...fresh, { transaction_id: null, amount: rest, description: "Diferencia por un movimiento borrado o editado, o por el saldo inicial", occurred_on: null }];
}

/** Cuentas propias conciliadas que se movieron después (la conciliación más reciente de cada una). */
export function driftedAccounts(accounts: Account[], txs: Transaction[], recs: Reconciliation[]): { account: Account; rec: Reconciliation; d: ReconciliationDrift }[] {
  const out: { account: Account; rec: Reconciliation; d: ReconciliationDrift }[] = [];
  for (const a of accounts) {
    const rec = recs.filter((r) => r.account_id === a.id && r.status === "RECONCILED").sort((x, y) => y.month.localeCompare(x.month))[0];
    if (!rec) continue;
    const d = reconciliationDrift(a, txs, rec);
    if (d) out.push({ account: a, rec, d });
  }
  return out;
}
