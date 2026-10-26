// Validación de lo que devuelve Gemini en la captura rápida.

import type { CaptureOption, CaptureResult } from "./phrase";

export interface CaptureContext {
  today: string;
  accounts: CaptureOption[];
  categories: CaptureOption[];
  incomeCategories: CaptureOption[];
}

/** Solo se aceptan ids de las listas enviadas y valores con forma válida. */
export function sanitizeCapture(raw: Record<string, unknown>, ctx: CaptureContext): CaptureResult {
  const r: CaptureResult = {};
  if (raw.kind === "EXPENSE" || raw.kind === "INCOME" || raw.kind === "TRANSFER") r.kind = raw.kind;
  if (typeof raw.amount === "number" && raw.amount > 0 && raw.amount < 10_000_000_000) r.amount = Math.round(raw.amount);
  if (typeof raw.description === "string" && raw.description.trim()) r.description = raw.description.trim().slice(0, 120);
  if (typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) && !Number.isNaN(Date.parse(raw.date)) && raw.date <= ctx.today) r.date = raw.date;
  const has = (list: CaptureOption[], v: unknown) => typeof v === "string" && list.some((o) => o.id === v);
  const cats = r.kind === "INCOME" ? ctx.incomeCategories : ctx.categories;
  if (has(cats, raw.category_id)) r.categoryId = raw.category_id as string;
  if (has(ctx.accounts, raw.account_id)) r.accountId = raw.account_id as string;
  if (r.kind === "TRANSFER" && has(ctx.accounts, raw.to_account_id) && raw.to_account_id !== raw.account_id) r.toAccountId = raw.to_account_id as string;
  return r;
}
