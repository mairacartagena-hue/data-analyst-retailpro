// Extractos de la tarjeta de crédito: cruce de lo que dice el banco con lo que proyecta la app.
//  · La cuota del mes (lo que la app proyecta pagar en la fecha de pago del extracto) contra el pago mínimo.
//  · La deuda de la app al día del corte contra la deuda total del extracto.

import type { Account, CardStatement, CardStatementItem, Transaction } from "@/lib/types";
import type { CardChargeLine, CardStatementPurchase } from "@/lib/capture/cardStatement";
import { accountStatement } from "./reconcile";
import { addDays } from "./periods";
import { VALUE_ONLY_MIN, VALUE_WINDOW_DAYS, sameMerchant } from "./statement";
import { billingCut, cutsBetween, graceShift, hasGrace, installmentPlan, installmentsOf, isCardAdvance, matchedWithItems, monthlyRate, payoffDates, projectCard, rateOf, statementItemsAfter } from "./installments";

/** Diferencias de hasta $1.000 se toman como iguales (redondeos e intereses de centavos). */
export const STATEMENT_TOLERANCE = 1000;

const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** Deuda de la tarjeta según la app al final del día `date` (positiva). */
export function appDebtAt(account: Account, txs: Transaction[], date: string): number {
  const st = accountStatement(account, txs, { month: date.slice(0, 7), start: date, end: date });
  return Math.max(0, -st.closing);
}

/** Lo que la app proyecta pagar en el mes de `due` (sin descontar pagos ya hechos: se compara con el extracto tal cual). */
export function projectedFor(account: Account, txs: Transaction[], items: CardStatementItem[], due: string): number {
  const card = {
    id: account.id, interest_rate_ea: account.interest_rate_ea ?? null, statement_day: account.statement_day,
    due_day: account.due_day, opening_at: account.opening_at, opening_balance: account.opening_balance,
  };
  return projectCard(card, txs, due, 1, items.filter((i) => i.account_id === account.id), { ignorePayments: true })[0]?.total ?? 0;
}

export interface StatementCheck {
  /** Cuota proyectada por la app para la fecha de pago del extracto (null sin fecha de pago). */
  projected: number | null;
  /** Proyectado − pago mínimo (null si falta alguno). */
  minimumDiff: number | null;
  /** Deuda de la app al corte. */
  appDebt: number;
  /** Deuda de la app − deuda del extracto (null sin deuda del extracto). */
  debtDiff: number | null;
}

export function checkStatement(account: Account, txs: Transaction[], items: CardStatementItem[], st: CardStatement): StatementCheck {
  const projected = st.due_date ? projectedFor(account, txs, items, st.due_date) : null;
  const appDebt = appDebtAt(account, txs, st.cut_date);
  return {
    projected,
    minimumDiff: projected !== null && st.minimum_payment !== null ? Math.round(projected - st.minimum_payment) : null,
    appDebt,
    debtDiff: st.total_debt !== null ? Math.round(appDebt - st.total_debt) : null,
  };
}

/** ¿La diferencia se puede dar por cuadrada? */
export function squares(diff: number | null): boolean {
  return diff !== null && Math.abs(diff) <= STATEMENT_TOLERANCE;
}

/**
 * Veredicto de una diferencia (app − extracto). Dentro de la tolerancia cuadra, pero si no es exacta se dice cuánto es el
 * redondeo para no esconderlo: `rounding` es el valor absoluto que se está dando por bueno (0 si cuadra exacto).
 */
export function diffVerdict(diff: number): { ok: boolean; rounding: number; direction: "MORE" | "LESS" | "NONE" } {
  const direction = diff > 0 ? "MORE" : diff < 0 ? "LESS" : "NONE";
  const ok = Math.abs(diff) <= STATEMENT_TOLERANCE;
  return { ok, rounding: ok ? Math.abs(diff) : 0, direction };
}

type PurchaseLike = { description: string; purchaseDate: string; amount: number };

/** ¿La compra del extracto ya está en la tarjeta como compra del extracto? (mismo comercio y valor, o mismo valor y fecha) */
export function knownItem(p: PurchaseLike, items: CardStatementItem[], accountId: string): CardStatementItem | undefined {
  return items.find((i) => i.account_id === accountId && Math.abs(i.amount - p.amount) <= 1
    && (i.description.trim().toLowerCase() === p.description.trim().toLowerCase() || daysApart(i.purchase_date, p.purchaseDate) <= 1));
}

/** ¿La compra del extracto ya está registrada en la app? (misma tarjeta, mismo valor ±$1 y fecha ±1 día) Esa ya proyecta sus cuotas. */
export function registeredTx(p: PurchaseLike, txs: Transaction[], accountId: string): Transaction | undefined {
  return txs.find((t) => t.account_id === accountId && t.kind === "EXPENSE" && Math.abs(t.amount - p.amount) <= 1 && daysApart(t.occurred_on, p.purchaseDate) <= 1);
}

// ───────────────────── Cuotas: extracto vs. app ─────────────────────

/** Compra a cuotas tal como la lee el extracto. `paidInstallments` es el número de la cuota que se factura en ese extracto. */
export type ExtractPurchase = Pick<CardStatementPurchase, "description" | "purchaseDate" | "amount" | "installments" | "paidInstallments" | "remainingBalance" | "monthlyCharge" | "balanceAtCut">;

export type InstallmentVerdict = "OK" | "DIFFERS" | "ONLY_EXTRACT" | "ONLY_APP";
/**
 * installments: total de cuotas · amount: valor de la compra (solo se compara en compras vinculadas a mano; las demás se emparejan
 * justamente por tener el mismo valor) · current: cuota que se factura en este extracto · charge: cargo del mes por esa compra
 * (cuota con intereses; algunos bancos imprimen solo el capital: ver `compareWith`) · balance: saldo diferido pendiente después de esa cuota.
 */
export type InstallmentField = "installments" | "amount" | "current" | "charge" | "balance";

/** El banco calcula el interés por días y la app por mes: el cargo del mes se perdona hasta este % (y nunca menos de $1.000). */
export const CHARGE_TOLERANCE_PCT = 0.03;
export const chargeTolerance = (extractCharge: number) => Math.max(STATEMENT_TOLERANCE, Math.round(extractCharge * CHARGE_TOLERANCE_PCT));

export interface InstallmentDiff {
  field: InstallmentField;
  /** Lo que tiene o espera la app. */
  app: number;
  /** Lo que dice el extracto. */
  extract: number;
}

export interface InstallmentCheck {
  verdict: InstallmentVerdict;
  /** Posición de la compra en la lista del extracto (para vincularla a mano). No hay en ONLY_APP. */
  index?: number;
  /** La persona la vinculó a mano con este movimiento de la app (el cruce automático no las unió). */
  linked?: boolean;
  /** Compra del extracto (no hay en ONLY_APP). */
  purchase?: ExtractPurchase;
  /** Con qué se comparó: la compra del extracto ya guardada en la tarjeta (ITEM) o el movimiento de la app (APP). */
  source?: "APP" | "ITEM";
  tx?: Transaction;
  item?: CardStatementItem;
  /** La compra se unió al movimiento por valor idéntico aunque las fechas difieren mucho: días de diferencia. */
  dateGap?: number;
  diffs: InstallmentDiff[];
}

/** Lo que la app espera de una compra a cuotas en el extracto: cuota que se factura, saldo diferido después de ella y cargo del mes. */
interface Expected {
  current: number | null;
  balance: number | null;
  charge: number | null;
  /** Saldo y cargo esperados si el extracto estuviera en la cuota `k` (para el periodo de gracia del banco). */
  at?: (k: number) => { balance: number | null; charge: number | null };
}

/**
 * Cuota que se factura en el extracto que corta `cut` y saldo diferido que queda después, según el movimiento de la app.
 * `grace`: la tarjeta da cuota 0 (ver `hasGrace`): una compra de 3 o más cuotas llega con 0 en su primer corte y la cuota 1 viene en el siguiente.
 * `listed` = cortes que lleva la compra en extractos (con gracia, el primero ya la lista aunque su cuota sea la 0).
 */
function expectedForTx(t: Transaction, account: Account, cut: string | null, grace = false): Expected & { n: number; listed: number | null } {
  const n = installmentsOf(t);
  const sd = account.statement_day ?? null;
  if (!sd || !cut) return { n, current: null, balance: null, charge: null, listed: null };
  const listed = cutsBetween(sd, addDays(billingCut(sd, t.occurred_on), -1), cut);
  const current = Math.min(n, Math.max(0, listed - graceShift(grace, t)));
  // Cuota fija (capital + intereses) con la tasa de la compra o, si no, la de la tarjeta: el cargo del mes es la cuota y el saldo diferido
  // lo que queda de capital después de ella
  const rated = installmentPlan(t.amount, n, t.occurred_on, rateOf(t, account));
  const at = (k: number) => ({ balance: rated.slice(k).reduce((a, c) => a + c.capital, 0), charge: k >= 1 ? rated[k - 1]?.total ?? null : null });
  return { n, current, listed, ...at(current), at };
}

/** Lo mismo para una compra del extracto que ya está guardada en la tarjeta: cada corte desde su extracto factura una cuota. */
function expectedForItem(it: CardStatementItem, account: Account, cut: string | null): Expected {
  const sd = account.statement_day ?? null;
  const from = it.as_of ?? account.opening_at?.slice(0, 10) ?? null;
  if (!sd || !cut || !from) return { current: null, balance: null, charge: null };
  const cuts = cutsBetween(sd, from, cut);
  // El cargo de este corte es lo que suma la proyección con una cuota más que la anterior (capital + intereses)
  const upTo = (k: number) => { const s = statementItemsAfter([it], k, account.interest_rate_ea); return s.capitalDue + s.interest; };
  const charge = cuts >= 1 && it.paid_installments + cuts <= it.installments ? upTo(cuts) - upTo(cuts - 1) : null;
  return { current: Math.min(it.installments, it.paid_installments + cuts), balance: statementItemsAfter([it], cuts).later, charge: charge !== null && charge > 0 ? charge : null };
}

/**
 * El extracto de unos bancos (BBVA) imprime en "cargos del mes" solo el CAPITAL de la cuota: los intereses se cobran aparte y el saldo
 * diferido baja justo ese capital (saldo a corte − cargo = diferido). Se reconoce cuando eso se cumple y, además, el cargo queda por
 * debajo de lo que la app espera con intereses: sin intereses de por medio el cargo y la cuota son lo mismo y se compara de frente.
 */
function capitalOnlyCharge(p: ExtractPurchase, expectedCharge: number | null): boolean {
  if (p.monthlyCharge === undefined || expectedCharge === null) return false;
  if (p.monthlyCharge >= expectedCharge - chargeTolerance(p.monthlyCharge)) return false;
  if (p.balanceAtCut !== undefined) return Math.abs(p.balanceAtCut - p.remainingBalance - p.monthlyCharge) <= STATEMENT_TOLERANCE;
  // Sin el saldo a corte: una cuota con intereses nunca baja de valor/n (y el capital de las primeras cuotas siempre queda por debajo de eso)
  return p.monthlyCharge < p.amount / p.installments - 1;
}

/**
 * Diferencias de una compra del extracto con lo que espera la app. Si el total de cuotas no coincide solo se informa eso: lo demás es consecuencia.
 * Del banco se perdonan dos costumbres que no son errores de la app: el periodo de gracia (planes de 3 o más cuotas que en el primer corte
 * traen "00 DE nn" y empiezan a cobrar capital en el siguiente) y el cargo con solo el capital (`capitalOnlyCharge`), cuyo saldo sigue la
 * amortización del banco (interés por días) y no la de cuota fija de la app: ahí el saldo solo se marca si queda por debajo de lo que la app ya habría amortizado
 * (cuotas de más pagadas) o por encima del valor de la compra.
 */
function compareWith(p: ExtractPurchase, appInstallments: number, e: Expected, appAmount?: number, graceKnown = false): InstallmentDiff[] {
  if (appInstallments !== p.installments) return [{ field: "installments", app: appInstallments, extract: p.installments }];
  const diffs: InstallmentDiff[] = [];
  // Vinculada a mano con otro valor: el cargo y el saldo de la app salen de ese valor, así que serían consecuencia y no se comparan
  if (appAmount !== undefined && Math.abs(appAmount - p.amount) > 1) {
    diffs.push({ field: "amount", app: appAmount, extract: p.amount });
    if (e.current !== null && e.current !== p.paidInstallments) diffs.push({ field: "current", app: e.current, extract: p.paidInstallments });
    return diffs;
  }
  // Periodo de gracia: la app ya factura la 1 y el banco trae la 0 → se espera lo que corresponde a la cuota 0 (saldo completo, sin cargo).
  // Si la tarjeta ya se sabe con gracia, `e` ya la trae contada y no se perdona nada más (dos cortes con 0 sí es un error)
  const grace = !graceKnown && e.at !== undefined && p.installments >= 3 && p.paidInstallments === 0 && e.current === 1;
  const x: Expected = grace && e.at ? { current: 0, ...e.at(0) } : e;
  if (x.current !== null && x.current !== p.paidInstallments) diffs.push({ field: "current", app: x.current, extract: p.paidInstallments });
  // El cargo del mes solo se compara si es la misma cuota: con otra cuota la diferencia sería consecuencia, no un dato nuevo
  else if (x.charge !== null && p.monthlyCharge !== undefined && Math.abs(x.charge - p.monthlyCharge) > chargeTolerance(p.monthlyCharge) && !capitalOnlyCharge(p, x.charge)) diffs.push({ field: "charge", app: x.charge, extract: p.monthlyCharge });
  if (x.balance !== null) {
    const bad = capitalOnlyCharge(p, x.charge)
      ? p.remainingBalance < x.balance - STATEMENT_TOLERANCE || p.remainingBalance > p.amount + STATEMENT_TOLERANCE
      : Math.abs(x.balance - p.remainingBalance) > STATEMENT_TOLERANCE;
    if (bad) diffs.push({ field: "balance", app: x.balance, extract: p.remainingBalance });
  }
  return diffs;
}

/**
 * Cruza las compras a cuotas del extracto con la app, compra por compra:
 *  · Cuadra (OK) o difiere (DIFFERS) en el total de cuotas, la cuota que se factura, el cargo del mes (cuota con intereses,
 *    con tolerancia: ver `chargeTolerance`) y el saldo diferido pendiente.
 *    Si el total de cuotas no es el mismo, solo se informa eso: lo demás es consecuencia.
 *  · ONLY_EXTRACT: está en el extracto y no en la app ni en las compras guardadas de la tarjeta.
 *  · ONLY_APP: la app tiene una compra a cuotas que ya debería venir en este extracto (y todavía no es su última cuota) y no viene.
 * Una compra del extracto se compara primero con la compra ya guardada de la tarjeta y, si no hay, con el movimiento de la app.
 * `cutDate` es el corte del extracto; sin él (o sin día de corte en la tarjeta) solo se compara el total de cuotas.
 * `links`: vínculos hechos a mano (posición de la compra en `purchases` → id del movimiento de la app), para cuando el valor o la
 * fecha no coinciden y el cruce automático no las unió. Un vínculo manda sobre el cruce automático.
 * Las compras que quedan sin pareja se unen por VALOR idéntico aunque la fecha difiera hasta `VALUE_WINDOW_DAYS` días (`dateGap`);
 * `apart` (`posición|id del movimiento`) son las parejas por valor que la persona separó.
 */
export function checkInstallments(account: Account, txs: Transaction[], items: CardStatementItem[], purchases: ExtractPurchase[], cutDate: string | null, links: Record<number, string> = {}, apart: readonly string[] = []): InstallmentCheck[] {
  const sd = account.statement_day ?? null;
  const cut = cutDate && /^\d{4}-\d{2}-\d{2}$/.test(cutDate) ? cutDate : null;
  const mine = txs.filter((t) => t.account_id === account.id);
  const myItems = items.filter((i) => i.account_id === account.id);
  // Tarjeta con cuota 0: las compras de 3 o más cuotas llegan con 0 en su primer extracto
  const grace = hasGrace(account.id, myItems);
  const used = new Set<string>();
  const out: InstallmentCheck[] = [];
  // Movimientos que la persona vinculó a mano: ninguna otra compra se los lleva sola
  const reserved = new Set(Object.values(links));
  // Parejas que la persona separó ("esta no es"): clave `posición|movimiento`
  const separated = new Set(apart);
  const isPurchaseTx = (t: Transaction) => t.kind === "EXPENSE" || isCardAdvance(t);

  const slots: InstallmentCheck[] = [];
  const pending: number[] = [];
  const pair = (p: ExtractPurchase, index: number, tx: Transaction, how: { linked?: boolean; dateGap?: number }): InstallmentCheck => {
    used.add(tx.id);
    const e = expectedForTx(tx, account, cut, grace);
    const diffs = compareWith(p, e.n, e, how.linked ? tx.amount : undefined, graceShift(grace, tx) > 0);
    return { verdict: diffs.length ? "DIFFERS" : "OK", index, ...(how.linked ? { linked: true } : {}), ...(how.dateGap !== undefined ? { dateGap: how.dateGap } : {}), purchase: p, source: "APP", tx, diffs };
  };

  // 1) Mismo valor y fecha (hasta 1 día): la pareja de siempre
  purchases.forEach((p, index) => {
    const linkedTx = links[index] ? mine.find((t) => t.id === links[index]) : undefined;
    const item = linkedTx ? undefined : knownItem(p, myItems, account.id);
    if (item) {
      const diffs = compareWith(p, item.installments, expectedForItem(item, account, cut));
      slots[index] = { verdict: diffs.length ? "DIFFERS" : "OK", index, purchase: p, source: "ITEM", item, diffs };
      for (const t of mine) if (Math.abs(t.amount - item.amount) <= 1 && daysApart(t.occurred_on, item.purchase_date) <= 1) used.add(t.id);
      return;
    }
    const tx = linkedTx ?? mine
      .filter((t) => !reserved.has(t.id) && isPurchaseTx(t) && Math.abs(t.amount - p.amount) <= 1 && daysApart(t.occurred_on, p.purchaseDate) <= 1)
      .sort((a, b) => daysApart(a.occurred_on, p.purchaseDate) - daysApart(b.occurred_on, p.purchaseDate) || Math.abs(a.amount - p.amount) - Math.abs(b.amount - p.amount))[0];
    if (!tx) { pending.push(index); return; }
    slots[index] = pair(p, index, tx, { linked: !!linkedTx });
  });

  // 2) Por valor: lo que sigue sin pareja y vale exactamente lo mismo se une aunque la fecha difiera mucho (la app la dejó en
  // un mes y el banco la facturó en el siguiente). Los más cercanos en fecha primero, uno a uno, sin tocar movimientos ya usados.
  const candidates: { index: number; tx: Transaction; gap: number; diff: number }[] = [];
  for (const index of pending) {
    const p = purchases[index];
    for (const t of mine) {
      if (used.has(t.id) || reserved.has(t.id) || !isPurchaseTx(t) || separated.has(`${index}|${t.id}`)) continue;
      const diff = Math.abs(t.amount - p.amount);
      const gap = daysApart(t.occurred_on, p.purchaseDate);
      if (diff > 1 || gap > VALUE_WINDOW_DAYS) continue;
      if (p.amount < VALUE_ONLY_MIN && !sameMerchant(p.description, `${t.description ?? ""} ${t.merchant ?? ""}`)) continue;
      candidates.push({ index, tx: t, gap, diff });
    }
  }
  candidates.sort((a, b) => a.gap - b.gap || a.diff - b.diff || a.index - b.index);
  for (const c of candidates) {
    if (slots[c.index] || used.has(c.tx.id)) continue;
    slots[c.index] = pair(purchases[c.index], c.index, c.tx, { dateGap: c.gap });
  }
  for (const index of pending) slots[index] ??= { verdict: "ONLY_EXTRACT", index, purchase: purchases[index], diffs: [] };
  for (const c of slots) if (c) out.push(c);

  // En la app y no en el extracto: compras a cuotas hechas antes del corte, ya facturadas y con cuotas por pagar todavía
  if (sd && cut) {
    const open = account.opening_at?.slice(0, 10) ?? null;
    const payoffs = payoffDates(txs);
    const inExtract = matchedWithItems(mine, myItems);
    for (const t of mine) {
      if (used.has(t.id) || inExtract.has(t.id) || t.status === "PENDING_REVIEW") continue;
      if (!(t.kind === "EXPENSE" || isCardAdvance(t)) || installmentsOf(t) <= 1) continue;
      if ((open && t.occurred_on <= open) || t.occurred_on > cut) continue;
      const paidOff = payoffs.get(t.id);
      if (paidOff && paidOff <= cut) continue;
      const e = expectedForTx(t, account, cut, grace);
      // Aún no se factura, o ya es su última cuota (el extracto solo lista las que tienen saldo pendiente).
      // Con cuota 0 el extracto ya la lista desde el primer corte aunque todavía no cobre.
      if (e.current === null || (e.listed ?? 0) < 1 || e.current >= e.n) continue;
      out.push({ verdict: "ONLY_APP", source: "APP", tx: t, diffs: [] });
    }
  }

  const rank: Record<InstallmentVerdict, number> = { DIFFERS: 0, ONLY_APP: 1, ONLY_EXTRACT: 2, OK: 3 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict]);
}

/**
 * Movimientos de la app que pueden ser una compra del extracto que no se emparejó sola: gastos de esta tarjeta que todavía no
 * están emparejados, hasta un mes antes o después, y los de valor y fecha más parecidos primero.
 * `taken`: movimientos que ya tienen su pareja (para no ofrecerlos).
 */
export function purchaseLinkCandidates(account: Account, txs: Transaction[], p: Pick<ExtractPurchase, "purchaseDate" | "amount">, taken: ReadonlySet<string>, limit = 8): Transaction[] {
  return txs
    .filter((t) => t.account_id === account.id && (t.kind === "EXPENSE" || isCardAdvance(t)) && !taken.has(t.id) && daysApart(t.occurred_on, p.purchaseDate) <= 31)
    .sort((a, b) => Math.abs(a.amount - p.amount) - Math.abs(b.amount - p.amount) || daysApart(a.occurred_on, p.purchaseDate) - daysApart(b.occurred_on, p.purchaseDate))
    .slice(0, limit);
}

/** Lo mismo al revés: compras del extracto sin pareja que puede ser este movimiento de la app (de `checks`, las "solo en el extracto"). */
export function onlyExtractCandidates(checks: InstallmentCheck[], tx: Pick<Transaction, "amount" | "occurred_on">, limit = 8): InstallmentCheck[] {
  return checks
    .filter((c) => c.verdict === "ONLY_EXTRACT" && c.purchase !== undefined && c.index !== undefined)
    .sort((a, b) => Math.abs(a.purchase!.amount - tx.amount) - Math.abs(b.purchase!.amount - tx.amount)
      || daysApart(a.purchase!.purchaseDate, tx.occurred_on) - daysApart(b.purchase!.purchaseDate, tx.occurred_on))
    .slice(0, limit);
}

/** Poner en un movimiento de la app el total de cuotas que dice el extracto. */
export interface InstallmentFix {
  tx: Transaction;
  /** Cuotas que tiene hoy en la app. */
  from: number;
  /** Cuotas que dice el extracto. */
  to: number;
}

/**
 * ¿Se puede corregir el total de cuotas de esta compra con lo que dice el extracto? Solo si el desacuerdo es el número de cuotas,
 * la compra es de la app (no una compra guardada del extracto), la registró esta persona y es un gasto o un avance de esta tarjeta.
 */
export function installmentFix(c: InstallmentCheck, account: Account, userId: string): InstallmentFix | null {
  const d = c.diffs.find((x) => x.field === "installments");
  const tx = c.tx;
  if (c.verdict !== "DIFFERS" || c.source !== "APP" || !d || !tx) return null;
  if (!Number.isInteger(d.extract) || d.extract < 1 || d.extract > 48 || d.extract === d.app) return null;
  if (tx.created_by !== userId || tx.status !== "CONFIRMED" || tx.account_id !== account.id) return null;
  if (tx.kind !== "EXPENSE" && tx.kind !== "TRANSFER") return null;
  return { tx, from: d.app, to: d.extract };
}

// ───────────────────── Cobro del mes por compra (extractos sin plan de cuotas: Addi) ─────────────────────

export interface ChargeCheck {
  line: CardChargeLine;
  /** La compra de la app con la que se cruzó (misma fecha ±1 día). */
  tx?: Transaction;
  /** O la compra guardada en el proyectado de la tarjeta (compras de antes de la app: su fecha es la del registro, no la real). */
  item?: CardStatementItem;
  /** Cuota que la app espera facturar en este corte y de cuántas. */
  installment: number | null;
  of: number | null;
  /** Cuota del mes (capital + intereses) según la app, y según el extracto. */
  appCharge: number | null;
  extractCharge: number;
  /** UPDATED: la compra del proyectado ya se actualizó con este extracto (o uno posterior). */
  verdict: "OK" | "DIFFERS" | "ONLY_EXTRACT" | "NO_CHARGE" | "UPDATED";
  /** Cortes que la compra del proyectado lleva sin aplicar hasta este extracto (1 = el de este extracto). */
  cuts?: number;
  /** Lo que se guarda en la compra del proyectado para dejarla como la dice este extracto (solo si le falta justo este corte). */
  update?: ChargeUpdate;
}

/** Estado de una compra del proyectado después de aplicarle el cobro de un extracto: una cuota más y el capital abonado menos de saldo. */
export interface ChargeUpdate {
  id: string;
  paid: number;
  remaining: number;
  asOf: string;
}

/**
 * El extracto de Addi no trae el valor de cada compra ni su número de cuotas, solo lo que cobra este mes de cada una. Se cruza cada
 * cobro primero con la compra de la app del mismo día (±1; si hay varias, la del mismo comercio y luego la de cuota más parecida) y,
 * si no hay, con las compras guardadas en el proyectado de la tarjeta: esas son de antes de la app y su fecha es la del registro, así
 * que se buscan por comercio o por el valor de la cuota que la app espera de ellas. Se compara la cuota (capital + intereses, sin
 * fianza) que la app espera para este corte con la del extracto, con la tolerancia de siempre.
 *  · NO_CHARGE: la compra está en la app pero, según la app, no le toca cuota en este corte (otro número de cuotas u otra fecha).
 */
export function checkMonthlyCharges(account: Account, txs: Transaction[], items: CardStatementItem[], lines: CardChargeLine[], cutDate: string | null): ChargeCheck[] {
  const cut = cutDate && /^\d{4}-\d{2}-\d{2}$/.test(cutDate) ? cutDate : null;
  const mine = txs.filter((t) => t.account_id === account.id && (t.kind === "EXPENSE" || isCardAdvance(t)) && t.status !== "PENDING_REVIEW");
  const myItems = items.filter((i) => i.account_id === account.id);
  const used = new Set<string>();
  const rank: Record<ChargeCheck["verdict"], number> = { DIFFERS: 0, ONLY_EXTRACT: 1, NO_CHARGE: 2, OK: 3, UPDATED: 4 };
  const verdictOf = (appCharge: number | null, extractCharge: number): Exclude<ChargeCheck["verdict"], "UPDATED"> =>
    appCharge === null ? "NO_CHARGE" : Math.abs(appCharge - extractCharge) <= chargeTolerance(extractCharge) ? "OK" : "DIFFERS";
  const out: (ChargeCheck | null)[] = lines.map(() => null);
  const sd = account.statement_day ?? null;

  // 1) Compra de la app del mismo día (±1)
  lines.forEach((line, index) => {
    const extractCharge = Math.round(line.capital + line.interest);
    const options = mine.filter((t) => !used.has(t.id) && daysApart(t.occurred_on, line.purchaseDate) <= 1).map((t) => {
      const e = expectedForTx(t, account, cut);
      const dist = e.charge === null ? Number.MAX_SAFE_INTEGER : Math.abs(e.charge - extractCharge);
      return { t, e, dist, merchant: sameMerchant(line.description, `${t.merchant ?? ""} ${t.description ?? ""}`) };
    });
    options.sort((a, b) => Number(b.merchant) - Number(a.merchant) || a.dist - b.dist);
    const best = options[0];
    if (!best) return;
    used.add(best.t.id);
    const appCharge = best.e.charge === null ? null : Math.round(best.e.charge);
    out[index] = { line, tx: best.t, installment: best.e.current, of: best.e.n, appCharge, extractCharge, verdict: verdictOf(appCharge, extractCharge) };
  });

  // 2) Lo que sigue sin pareja, con el proyectado de la tarjeta: son compras de antes de la app (fecha = la del registro), así que se
  // unen por comercio o por una cuota parecida (hasta 10 %: la cuota de la app puede salir distinta por el número de cuotas que faltan,
  // y eso se informa como diferencia, no como "no encontrada"). Las más parecidas primero, una a una.
  const pairs: { index: number; item: CardStatementItem; charge: number | null; current: number | null; dist: number; merchant: boolean; upToDate: boolean; cuts: number }[] = [];
  lines.forEach((line, index) => {
    if (out[index]) return;
    const extractCharge = Math.round(line.capital + line.interest);
    for (const item of myItems) {
      // Ya actualizada con este extracto (o uno posterior): su saldo es el de después de la cuota. Se reconoce porque el interés de
      // esta cuota es el del saldo de antes (saldo de ahora + capital abonado); sin tasa, porque el capital es el de una cuota pareja.
      const upToDate = !!(cut && item.as_of && item.as_of >= cut);
      const from = item.as_of ?? account.opening_at?.slice(0, 10) ?? null;
      const cuts = sd && cut && from ? cutsBetween(sd, from, cut) : 0;
      let charge: number | null = null;
      let current: number | null = null;
      let dist: number;
      if (upToDate) {
        const rate = item.rate_ea ?? account.interest_rate_ea ?? null;
        dist = rate && rate > 0
          ? Math.abs((item.remaining_balance + line.capital) * monthlyRate(rate) - line.interest)
          : Math.abs(item.amount / item.installments - line.capital);
        current = item.paid_installments;
      } else {
        const e = expectedForItem(item, account, cut);
        charge = e.charge === null ? null : Math.round(e.charge);
        current = e.current;
        dist = e.charge === null ? Number.MAX_SAFE_INTEGER : Math.abs(e.charge - extractCharge);
      }
      const merchant = sameMerchant(line.description, item.description);
      const near = upToDate ? dist <= chargeTolerance(extractCharge) : dist <= Math.max(STATEMENT_TOLERANCE, extractCharge * 0.1);
      if (merchant || near) pairs.push({ index, item, charge, current, dist, merchant, upToDate, cuts });
    }
  });
  pairs.sort((a, b) => Number(b.merchant) - Number(a.merchant) || a.dist - b.dist || a.index - b.index);
  const usedItems = new Set<string>();
  for (const c of pairs) {
    if (out[c.index] || usedItems.has(c.item.id)) continue;
    usedItems.add(c.item.id);
    const line = lines[c.index];
    const extractCharge = Math.round(line.capital + line.interest);
    if (c.upToDate) {
      out[c.index] = { line, item: c.item, installment: c.current, of: c.item.installments, appCharge: null, extractCharge, verdict: "UPDATED" };
      continue;
    }
    // Se puede actualizar solo si a la compra le falta justo este corte: con más, faltan los extractos de los meses de antes
    const update: ChargeUpdate | undefined = cut && c.cuts === 1
      ? { id: c.item.id, paid: Math.min(c.item.installments, c.item.paid_installments + 1), remaining: Math.max(0, Math.round(c.item.remaining_balance - line.capital)), asOf: cut }
      : undefined;
    out[c.index] = { line, item: c.item, installment: c.current, of: c.item.installments, appCharge: c.charge, extractCharge, verdict: verdictOf(c.charge, extractCharge), cuts: c.cuts, ...(update ? { update } : {}) };
  }

  return lines.map((line, index): ChargeCheck => out[index]
    ?? { line, installment: null, of: null, appCharge: null, extractCharge: Math.round(line.capital + line.interest), verdict: "ONLY_EXTRACT" })
    .sort((a, b) => rank[a.verdict] - rank[b.verdict]);
}
