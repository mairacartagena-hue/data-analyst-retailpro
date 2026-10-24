// Informes y etiquetas. Todo se calcula con lo que la persona puede ver (respeta la privacidad).

import type { AccountLabel, Category, Member, Space, Transaction, TxKind } from "@/lib/types";
import { SPACE_LABEL, TX_KIND_LABEL } from "@/lib/types";
import { isWithin, type Period } from "./periods";
import { accountLabel, categoryLabel } from "./labels";
import { accountSign, categoryPath, consumptionSign, hasSplits, rootOf } from "./spaces";

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
  ctx: { categories: Category[]; labels: AccountLabel[]; memberById: (id: string | null | undefined) => Member | null },
): string {
  const header = ["Fecha", "Tipo", "Ámbito", "Descripción", "Comercio", "Monto", "Categoría", "Responsable", "Pagó", "Cuenta", "Estado"];
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
      rows.push([base.date, base.kind, base.space, base.desc, base.merchant, String(sign * p.amount), p.cat, p.resp, base.payer, base.account, base.status]);
    }
  }
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}
