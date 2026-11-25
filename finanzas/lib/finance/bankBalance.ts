// Cruce a tres puntas al cerrar una cuenta: la app contra el EXTRACTO (a su fecha de corte) y la app contra lo que la persona
// VE hoy en la app del banco (otra fecha, casi siempre posterior). Mirar los dos por separado dice de dónde viene lo que no cuadra:
// si ya estaba en el corte o apareció después. Funciones puras: todo se calcula con los movimientos de la app.

import type { Account, Transaction } from "@/lib/types";
import { balanceAt, effectOn } from "./reconcile";
import { STATEMENT_TOLERANCE } from "./cardStatements";

/**
 * - OK: la app cuadra con el extracto y con la app del banco.
 * - FIXED_SINCE: no cuadraba al corte pero hoy sí: lo que faltaba o sobraba se arregló después (o está en otra fecha).
 * - NEW_SINCE: cuadraba al corte y hoy no: la diferencia viene de movimientos posteriores al corte.
 * - SAME_GAP: no cuadra y es la misma diferencia en las dos fechas: ya estaba en el corte (falta o sobra algo de antes).
 * - BOTH_GAPS: no cuadra en ninguna y la diferencia cambió: hay algo de antes del corte y algo posterior.
 */
export type ThreeWayDiagnosis = "OK" | "FIXED_SINCE" | "NEW_SINCE" | "SAME_GAP" | "BOTH_GAPS";

export interface ThreeWayCheck {
  extractDate: string;
  bankDate: string;
  /** Lo que dice la app a cada fecha (en deudas, la deuda en positivo). */
  appAtExtract: number;
  appAtBank: number;
  /** app − extracto y app − app del banco (en deudas, + = la app debe más). */
  extractDiff: number;
  bankDiff: number;
  /** Lo que se movió desde el corte según el banco y según la app, y su diferencia (= bankDiff − extractDiff). */
  bankSince: number;
  appSince: number;
  sinceDiff: number;
  /** Movimientos de la cuenta posteriores al corte y hasta la fecha de la app del banco. */
  sinceTxs: Transaction[];
  diagnosis: ThreeWayDiagnosis;
  /** Misma fecha en las dos fuentes y valores distintos: el extracto y la app del banco no coinciden entre sí. */
  sourcesDisagree: boolean;
}

const endOfDay = (day: string) => Date.parse(`${day}T23:59:59.999-05:00`);

export interface ThreeWayInput {
  account: Account;
  txs: Transaction[];
  /** Deudas (tarjetas, créditos): los valores van como deuda positiva. */
  isDebt: boolean;
  /** Valor del extracto y su fecha (corte de la tarjeta; fin de mes en cuentas). */
  extractValue: number;
  extractDate: string;
  /** Valor que se ve en la app del banco y el día en que se miró. */
  bankValue: number;
  bankDate: string;
  tolerance?: number;
}

/** null si la app del banco se miró antes del corte (no hay "desde el corte" que comparar). */
export function threeWayCheck(i: ThreeWayInput): ThreeWayCheck | null {
  if (i.bankDate < i.extractDate) return null;
  const tol = i.tolerance ?? STATEMENT_TOLERANCE;
  const view = (signed: number) => Math.round(i.isDebt ? -signed : signed);
  const appAtExtract = view(balanceAt(i.account, i.txs, endOfDay(i.extractDate)));
  const appAtBank = view(balanceAt(i.account, i.txs, endOfDay(i.bankDate)));
  const extractDiff = appAtExtract - i.extractValue;
  const bankDiff = appAtBank - i.bankValue;
  const okE = Math.abs(extractDiff) <= tol;
  const okB = Math.abs(bankDiff) <= tol;
  const diagnosis: ThreeWayDiagnosis = okE && okB ? "OK" : !okE && okB ? "FIXED_SINCE" : okE && !okB ? "NEW_SINCE"
    : Math.abs(bankDiff - extractDiff) <= tol ? "SAME_GAP" : "BOTH_GAPS";
  const sinceTxs = i.txs
    .filter((t) => effectOn(i.account.id, t) !== 0 && t.occurred_on > i.extractDate && t.occurred_on <= i.bankDate)
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at));
  return {
    extractDate: i.extractDate, bankDate: i.bankDate, appAtExtract, appAtBank, extractDiff, bankDiff,
    bankSince: i.bankValue - i.extractValue, appSince: appAtBank - appAtExtract, sinceDiff: bankDiff - extractDiff, sinceTxs, diagnosis,
    sourcesDisagree: i.bankDate === i.extractDate && Math.abs(i.bankValue - i.extractValue) > tol,
  };
}
