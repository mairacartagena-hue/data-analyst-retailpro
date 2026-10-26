// Informes y etiquetas. Todo se calcula con lo que la persona puede ver (respeta la privacidad).

import type { AccountLabel, Category, Member, Transaction } from "@/lib/types";
import { isWithin, type Period } from "./periods";
import { accountLabel, categoryLabel } from "./labels";

export interface CategoryTotal {
  key: string;
  name: string;
  icon: string;
  total: number;
}

/** Gastos del periodo por categoría (partes de cada gasto), de mayor a menor. */
export function spendingByCategory(txs: Transaction[], categories: Category[], period: Period): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const t of txs) {
    if (t.kind !== "EXPENSE" || t.third_party_id || !isWithin(t.occurred_on, period)) continue;
    for (const s of t.splits) {
      const label = categoryLabel(categories, s.category_id);
      const key = s.category_id && categories.some((c) => c.id === s.category_id) ? s.category_id : s.category_id ? "private" : "none";
      const cur = map.get(key) ?? { key, name: label.name, icon: label.icon, total: 0 };
      cur.total += s.amount;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export interface MonthTotals {
  month: string; // YYYY-MM
  income: number;
  expense: number;
}

/** Ingresos y gastos por mes calendario. Las transferencias y liquidaciones no cuentan. */
export function monthlyTrend(txs: Transaction[], months: string[]): MonthTotals[] {
  const rows = new Map(months.map((m) => [m, { month: m, income: 0, expense: 0 }]));
  for (const t of txs) {
    const r = rows.get(t.occurred_on.slice(0, 7));
    if (!r || t.third_party_id) continue;
    if (t.kind === "INCOME") r.income += t.amount;
    if (t.kind === "EXPENSE") r.expense += t.splits.reduce((a, s) => a + s.amount, 0) || t.amount;
  }
  return months.map((m) => rows.get(m)!);
}

export interface PersonTotals {
  userId: string;
  name: string;
  household: number; // categorías del hogar (no privadas)
  personal: number; // categorías personales o sin categoría
}

/** Cuánto asumió cada persona en el periodo (por responsable de cada parte), separado en hogar y personal. */
export function spendingByPerson(txs: Transaction[], categories: Category[], period: Period, members: Member[]): PersonTotals[] {
  const out = new Map(members.map((m) => [m.user_id, { userId: m.user_id, name: m.display_name, household: 0, personal: 0 }]));
  for (const t of txs) {
    if (t.kind !== "EXPENSE" || t.third_party_id || !isWithin(t.occurred_on, period)) continue;
    for (const s of t.splits) {
      const row = out.get(s.responsible_user_id);
      if (!row) continue;
      const cat = s.category_id ? categories.find((c) => c.id === s.category_id) : null;
      if (cat && cat.responsibility !== "PRIVATE") row.household += s.amount;
      else row.personal += s.amount;
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
  accountId?: string;
}

export function matchesFilter(t: Transaction, f: TxFilter): boolean {
  if (f.tag && !t.tags.includes(f.tag)) return false;
  if (f.categoryId && !t.splits.some((s) => s.category_id === f.categoryId) && t.income_category_id !== f.categoryId) return false;
  if (f.accountId && t.account_id !== f.accountId && t.to_account_id !== f.accountId) return false;
  return true;
}

const KIND_LABEL: Record<Transaction["kind"], string> = {
  EXPENSE: "Gasto",
  INCOME: "Ingreso",
  TRANSFER: "Transferencia",
  SETTLEMENT: "Liquidación",
};

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
  ctx: {
    categories: Category[];
    labels: AccountLabel[];
    memberById: (id: string | null | undefined) => Member | null;
    thirdPartyName?: (id: string) => string;
  },
): string {
  const header = ["Fecha", "Tipo", "Descripción", "Comercio", "Monto", "Categoría", "Responsable", "Pagó", "Cuenta", "Estado"];
  const rows: string[][] = [header];
  const sorted = [...txs].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
  for (const t of sorted) {
    const base = {
      date: t.occurred_on,
      kind: KIND_LABEL[t.kind],
      desc: t.description ?? "",
      merchant: t.merchant ?? "",
      payer: ctx.memberById(t.payer_user_id)?.display_name ?? "",
      account: t.kind === "TRANSFER" ? `${accountLabel(ctx.labels, t.account_id)} → ${accountLabel(ctx.labels, t.to_account_id)}` : accountLabel(ctx.labels, t.account_id),
      status: t.status === "PENDING_REVIEW" ? "Por revisar" : "Confirmado",
    };
    const tpName = t.third_party_id ? `Plata de ${ctx.thirdPartyName?.(t.third_party_id) ?? "un tercero"}` : null;
    const parts = tpName
      ? [{ amount: t.amount, cat: tpName, resp: base.payer }]
      : t.kind === "EXPENSE" && t.splits.length > 0
      ? t.splits.map((s) => ({ amount: s.amount, cat: categoryLabel(ctx.categories, s.category_id).name, resp: ctx.memberById(s.responsible_user_id)?.display_name ?? "" }))
      : [{
          amount: t.amount,
          cat: t.kind === "INCOME" && t.income_category_id ? categoryLabel(ctx.categories, t.income_category_id).name : "",
          resp: base.payer,
        }];
    for (const p of parts) {
      rows.push([base.date, base.kind, base.desc, base.merchant, String(t.kind === "INCOME" ? p.amount : -p.amount), p.cat, p.resp, base.payer, base.account, base.status]);
    }
  }
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}
