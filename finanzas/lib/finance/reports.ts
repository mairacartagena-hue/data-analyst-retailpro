// Informes y etiquetas. Todo se calcula con lo que la persona puede ver (respeta la privacidad).

import type { AccountLabel, Category, Member, Space, Transaction, TxKind } from "@/lib/types";
import { SPACE_LABEL, TX_KIND_LABEL } from "@/lib/types";
import { isWithin, type Period } from "./periods";
import { accountLabel, categoryLabel } from "./labels";
import { accountSign, categoryPath, consumptionSign, hasSplits, rootOf } from "./spaces";
import { creditPayments } from "./creditPayments";

/** Espacio de un informe: solo el hogar, solo lo personal (lo que puedo ver) o todo. */
export type ReportSpace = "household" | "personal" | "all";

export function inReportSpace(t: Transaction, space: ReportSpace): boolean {
  if (space === "household") return t.scope === "HOUSEHOLD";
  if (space === "personal") return t.scope === "PERSONAL";
  return true;
}

export interface CategoryTotal {
  key: string;
  name: string;
  icon: string;
  total: number;
}

/**
 * Gastos del periodo por categoría (partes de cada gasto o pago de deuda; los reembolsos restan), de mayor a menor.
 * Con `byParent`, las subcategorías se suman a su categoría principal.
 */
export function spendingByCategory(txs: Transaction[], categories: Category[], period: Period, byParent = false): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const t of txs) {
    const sign = consumptionSign(t.kind);
    if (!sign || !isWithin(t.occurred_on, period)) continue;
    for (const s of t.splits) {
      const known = !!s.category_id && categories.some((c) => c.id === s.category_id);
      const id = known && byParent ? rootOf(categories, s.category_id!) : s.category_id;
      const label = categoryLabel(categories, id);
      const key = known ? id! : s.category_id ? "private" : "none";
      const cur = map.get(key) ?? { key, name: byParent || !known ? label.name : categoryPath(categories, id), icon: label.icon, total: 0 };
      cur.total += sign * s.amount;
      map.set(key, cur);
    }
  }
  return [...map.values()].filter((c) => c.total !== 0).sort((a, b) => b.total - a.total);
}

export interface MonthTotals {
  month: string; // YYYY-MM
  income: number;
  expense: number;
}

/**
 * Ingresos y gastos por mes calendario. Transferencias, liquidaciones y ajustes no cuentan;
 * un reembolso resta del gasto (no es un ingreso nuevo).
 */
export function monthlyTrend(txs: Transaction[], months: string[]): MonthTotals[] {
  const rows = new Map(months.map((m) => [m, { month: m, income: 0, expense: 0 }]));
  for (const t of txs) {
    const r = rows.get(t.occurred_on.slice(0, 7));
    if (!r) continue;
    if (t.kind === "INCOME") r.income += t.amount;
    const sign = consumptionSign(t.kind);
    if (sign) r.expense += sign * (t.splits.reduce((a, s) => a + s.amount, 0) || t.amount);
  }
  return months.map((m) => rows.get(m)!);
}

export interface PersonTotals {
  userId: string;
  name: string;
  household: number; // movimientos del hogar
  personal: number; // movimientos personales
}

/** Cuánto asumió cada persona en el periodo (por responsable de cada parte), separado en hogar y personal. */
export function spendingByPerson(txs: Transaction[], _categories: Category[], period: Period, members: Member[]): PersonTotals[] {
  const out = new Map(members.map((m) => [m.user_id, { userId: m.user_id, name: m.display_name, household: 0, personal: 0 }]));
  for (const t of txs) {
    const sign = consumptionSign(t.kind);
    if (!sign || !isWithin(t.occurred_on, period)) continue;
    for (const s of t.splits) {
      const row = out.get(s.responsible_user_id);
      if (!row) continue;
      if (t.scope === "HOUSEHOLD") row.household += sign * s.amount;
      else row.personal += sign * s.amount;
    }
  }
  return [...out.values()];
}

export interface TagStat {
  tag: string;
  count: number;
  total: number; // gastos con la etiqueta
  editable: number; // movimientos propios (los que se pueden renombrar o quitar)
}

export function tagStats(txs: Transaction[], me: string): TagStat[] {
  const map = new Map<string, TagStat>();
  for (const t of txs) {
    for (const tag of t.tags) {
      const s = map.get(tag) ?? { tag, count: 0, total: 0, editable: 0 };
      s.count++;
      if (t.kind === "EXPENSE") s.total += t.amount;
      if (t.created_by === me || t.payer_user_id === me) s.editable++;
      map.set(tag, s);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export interface TxFilter {
  tag?: string;
  categoryId?: string;
  /** La categoría elegida con sus subcategorías (si se da, reemplaza a categoryId). */
  categoryIds?: Set<string>;
  accountId?: string;
  kind?: TxKind;
  scope?: Space;
  payerId?: string;
  responsibleId?: string;
  status?: Transaction["status"];
}

export function matchesFilter(t: Transaction, f: TxFilter): boolean {
  if (f.tag && !t.tags.includes(f.tag)) return false;
  const cats = f.categoryIds ?? (f.categoryId ? new Set([f.categoryId]) : null);
  if (cats && !t.splits.some((s) => s.category_id && cats.has(s.category_id)) && !(t.income_category_id && cats.has(t.income_category_id))) return false;
  if (f.accountId && t.account_id !== f.accountId && t.to_account_id !== f.accountId) return false;
  if (f.kind && t.kind !== f.kind) return false;
  if (f.scope && t.scope !== f.scope) return false;
  if (f.payerId && t.payer_user_id !== f.payerId) return false;
  if (f.responsibleId && !t.splits.some((s) => s.responsible_user_id === f.responsibleId)) return false;
  if (f.status && t.status !== f.status) return false;
  return true;
}

function cell(v: string | number): string {
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV para Excel en español: separador “;” y marca UTF-8 al inicio para que las tildes se vean bien.
 * Un gasto dividido genera una fila por cada parte.
 */
export function toCsv(
  txs: Transaction[],
  ctx: { categories: Category[]; labels: AccountLabel[]; memberById: (id: string | null | undefined) => Member | null; /** Nombres de las etiquetas de un movimiento (si se da, se agrega la columna). */ tagsOf?: (txId: string) => string[] },
): string {
  const header = ["Fecha", "Tipo", "Ámbito", "Descripción", "Comercio", "Monto", "Cuota", "Categoría", "Responsable", "Pagó", "Cuenta", "Estado", ...(ctx.tagsOf ? ["Etiquetas"] : [])];
  const rows: string[][] = [header];
  const sorted = [...txs].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
  for (const t of sorted) {
    const base = {
      date: t.occurred_on,
      kind: TX_KIND_LABEL[t.kind],
      space: SPACE_LABEL[t.scope] ?? "",
      desc: t.description ?? "",
      merchant: t.merchant ?? "",
      payer: ctx.memberById(t.payer_user_id)?.display_name ?? "",
      account: t.kind === "TRANSFER" ? `${accountLabel(ctx.labels, t.account_id)} → ${accountLabel(ctx.labels, t.to_account_id)}` : accountLabel(ctx.labels, t.account_id),
      status: t.status === "PENDING_REVIEW" ? "Por revisar" : "Confirmado",
      tags: ctx.tagsOf ? ctx.tagsOf((t.installment_of ?? t).id).join(", ") : null,
      // Compra a cuotas: cada fila es la cuota del periodo (como en los gráficos)
      cuota: t.installment_no ? `${t.installment_no} de ${t.installment_of?.installments ?? t.installments}` : "",
    };
    const sign = t.kind === "TRANSFER" || t.kind === "SETTLEMENT" ? -1 : accountSign(t);
    const catName = (id: string | null) => (id && ctx.categories.some((c) => c.id === id) ? categoryPath(ctx.categories, id) : categoryLabel(ctx.categories, id).name);
    const parts = hasSplits(t.kind) && t.splits.length > 0
      ? t.splits.map((s) => ({ amount: s.amount, cat: catName(s.category_id), resp: ctx.memberById(s.responsible_user_id)?.display_name ?? "" }))
      : [{
          amount: t.amount,
          cat: t.kind === "INCOME" && t.income_category_id ? categoryLabel(ctx.categories, t.income_category_id).name : "",
          resp: base.payer,
        }];
    for (const p of parts) {
      rows.push([base.date, base.kind, base.space, base.desc, base.merchant, String(sign * p.amount), base.cuota, p.cat, p.resp, base.payer, base.account, base.status, ...(base.tags !== null ? [base.tags] : [])]);
    }
  }
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}

// ——— Etapa 4 de informes ———

export interface PeriodTotals {
  period: Period;
  income: number;
  expense: number;
}

/**
 * Ingresos y gastos por periodo (los del hogar: mensual con día de corte o quincenal), igual que “Gastos del
 * periodo”: transferencias, liquidaciones y ajustes no cuentan; un reembolso resta del gasto.
 */
export function periodTrend(txs: Transaction[], periods: Period[]): PeriodTotals[] {
  const rows = periods.map((period) => ({ period, income: 0, expense: 0 }));
  for (const t of txs) {
    const r = rows.find((x) => isWithin(t.occurred_on, x.period));
    if (!r) continue;
    if (t.kind === "INCOME") r.income += t.amount;
    const sign = consumptionSign(t.kind);
    if (sign) r.expense += sign * (t.splits.reduce((a, s) => a + s.amount, 0) || t.amount);
  }
  return rows;
}

/** Lo que aún está “Por revisar” dentro de los gastos del periodo (se suma, pero puede cambiar al revisarlo). */
export function pendingInPeriod(txs: Transaction[], period: Period): { count: number; amount: number } {
  let count = 0;
  let amount = 0;
  for (const t of txs) {
    if (t.status !== "PENDING_REVIEW" || !isWithin(t.occurred_on, period)) continue;
    const sign = consumptionSign(t.kind);
    if (!sign) continue;
    count++;
    amount += sign * (t.splits.reduce((a, s) => a + s.amount, 0) || t.amount);
  }
  return { count, amount };
}

export interface TaxSummary {
  year: number;
  income: number;
  incomeByCategory: { name: string; total: number }[];
  /** 4x1000 registrado (marca #gmf). La mitad es deducible con el certificado del banco. */
  gmf: number;
  /** Por crédito: intereses y seguros pagados en el año y abono a capital. */
  credits: { id: string; name: string; charges: number; capital: number; payments: number }[];
}

/**
 * Resumen para la declaración de renta de una persona: sus ingresos, el 4x1000 de sus cuentas y lo pagado en sus
 * créditos durante el año. Es una guía: los valores oficiales salen de los certificados de los bancos.
 */
export function taxSummary(
  txs: Transaction[],
  ctx: { userId: string; year: number; categories: Category[]; accounts: { id: string; name: string; kind: string; owner_user_id: string; responsible_user_id?: string | null }[] },
): TaxSummary {
  const inYear = (d: string) => d.startsWith(`${ctx.year}-`);
  const mine = new Set(ctx.accounts.filter((a) => a.owner_user_id === ctx.userId).map((a) => a.id));
  const income = new Map<string, number>();
  let gmf = 0;
  for (const t of txs) {
    if (!inYear(t.occurred_on) || t.status === "PENDING_REVIEW") continue;
    if (t.kind === "INCOME" && t.payer_user_id === ctx.userId) {
      const name = t.income_category_id ? categoryLabel(ctx.categories, t.income_category_id).name : "Sin categoría";
      income.set(name, (income.get(name) ?? 0) + t.amount);
    }
    if (t.kind === "EXPENSE" && t.tags.includes("#gmf") && t.account_id && mine.has(t.account_id)) gmf += t.amount;
  }
  const credits = ctx.accounts
    .filter((a) => a.kind === "CREDIT" && (a.responsible_user_id ?? a.owner_user_id) === ctx.userId)
    .map((a) => {
      const paid = creditPayments(a, txs, `${ctx.year}-01-01`).filter((p) => inYear(p.date));
      return { id: a.id, name: a.name, charges: paid.reduce((s, p) => s + p.charges, 0), capital: paid.reduce((s, p) => s + p.capital, 0), payments: paid.length };
    })
    .filter((c) => c.payments > 0);
  const incomeByCategory = [...income.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  return { year: ctx.year, income: incomeByCategory.reduce((s, r) => s + r.total, 0), incomeByCategory, gmf, credits };
}

export interface FixedVariable {
  /** Pagos enlazados a un vencimiento programado. */
  scheduled: number;
  /** Cobros de suscripciones (marca #suscripcion o categoría “Suscripciones”). */
  subscriptions: number;
  /** Intereses y seguros de los créditos (gastos cargados al crédito). */
  creditCharges: number;
  /** El resto de los gastos. */
  variable: number;
  /** Abonos a capital de los créditos (no son gasto, pero salen cada mes). */
  creditCapital: number;
}

/** Gastos fijos (vencimientos, suscripciones, intereses de créditos) frente a variables en el periodo. */
export function fixedVsVariable(txs: Transaction[], period: Period, ctx: { categories: Category[]; creditIds: Set<string> }): FixedVariable {
  const subsCats = new Set(ctx.categories.filter((c) => /suscrip/i.test(c.name)).map((c) => c.id));
  const out: FixedVariable = { scheduled: 0, subscriptions: 0, creditCharges: 0, variable: 0, creditCapital: 0 };
  for (const t of txs) {
    if (!isWithin(t.occurred_on, period)) continue;
    if (t.kind === "TRANSFER" && t.to_account_id && ctx.creditIds.has(t.to_account_id)) {
      out.creditCapital += t.amount;
      continue;
    }
    const sign = consumptionSign(t.kind);
    if (!sign) continue;
    const amount = sign * (t.splits.reduce((a, s) => a + s.amount, 0) || t.amount);
    if (t.scheduled_payment_id) out.scheduled += amount;
    else if (t.tags.includes("#suscripcion") || t.splits.some((s) => s.category_id && subsCats.has(s.category_id))) out.subscriptions += amount;
    else if (t.account_id && ctx.creditIds.has(t.account_id)) out.creditCharges += amount;
    else out.variable += amount;
  }
  return out;
}
