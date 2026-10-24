// Cierre del mes: estado de cuenta según la app (saldo inicial, entradas, salidas, saldo final)
// y estimado del 4x1000 (GMF). Replica la regla de account_balances(): un movimiento cuenta para el saldo
// solo si ocurrió desde el momento del saldo inicial de la cuenta (opening_at).

import type { Account, Transaction } from "@/lib/types";
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
