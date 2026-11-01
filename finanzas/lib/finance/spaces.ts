// Reglas comunes de los movimientos: cómo afecta cada tipo a la cuenta y al consumo,
// el ámbito (hogar / personal) y el árbol de categorías con subcategorías.

import type { Category, Space, Transaction, TxKind } from "@/lib/types";
import type { SpendingRow } from "./budget";

/** Efecto sobre la cuenta de origen: +1 entra plata, −1 sale. */
export function accountSign(t: Pick<Transaction, "kind" | "direction">): 1 | -1 {
  if (t.kind === "INCOME" || t.kind === "REFUND") return 1;
  if (t.kind === "ADJUSTMENT") return t.direction === "IN" ? 1 : -1;
  return -1;
}

/**
 * Cómo cuenta un movimiento en el consumo (presupuestos e informes de gastos):
 * gastos y pagos de deuda suman, un reembolso resta; transferencias, liquidaciones, ingresos y ajustes no cuentan.
 */
export function consumptionSign(kind: TxKind): 1 | -1 | 0 {
  if (kind === "EXPENSE" || kind === "DEBT_PAYMENT") return 1;
  if (kind === "REFUND") return -1;
  return 0;
}

/** Tipos que llevan desglose (categoría y responsable por parte). */
export function hasSplits(kind: TxKind): boolean {
  return kind === "EXPENSE" || kind === "DEBT_PAYMENT" || kind === "REFUND";
}


/** Ejecutado por categoría, día, responsable y ámbito a partir de los movimientos visibles. */
/**
 * Filas de lo ejecutado por categoría. `creditBudgets` (crédito → categoría de su presupuesto): lo que se transfiere
 * al crédito cuenta como pagado en su categoría (del hogar), y los intereses cargados al propio crédito no se
 * cuentan otra vez porque ya van dentro de esa transferencia.
 */
export function spendingRows(
  txs: Transaction[],
  creditBudgets: Map<string, string> = new Map(),
  /** Tarjetas con presupuesto: parte de cada pago que cubre la deuda anterior (ver `cardPaymentPortions`). */
  cardPortions: Map<string, { categoryId: string; amount: number }> = new Map(),
): SpendingRow[] {
  const out: SpendingRow[] = [];
  for (const t of txs) {
    const cardPart = t.kind === "TRANSFER" ? cardPortions.get(t.id) : undefined;
    if (cardPart) {
      out.push({ categoryId: cardPart.categoryId, responsibleUserId: t.payer_user_id, occurredOn: t.occurred_on, total: cardPart.amount, scope: "HOUSEHOLD" });
      continue;
    }
    const creditCat = t.kind === "TRANSFER" && t.to_account_id ? creditBudgets.get(t.to_account_id) : undefined;
    if (creditCat) {
      out.push({ categoryId: creditCat, responsibleUserId: t.payer_user_id, occurredOn: t.occurred_on, total: t.amount, scope: "HOUSEHOLD" });
      continue;
    }
    const sign = consumptionSign(t.kind);
    if (!sign) continue;
    if (t.account_id && creditBudgets.has(t.account_id)) continue;
    for (const s of t.splits) {
      if (!s.category_id) continue;
      out.push({ categoryId: s.category_id, responsibleUserId: s.responsible_user_id, occurredOn: t.occurred_on, total: sign * s.amount, scope: t.scope });
    }
  }
  return out;
}

/** Créditos con presupuesto: id del crédito → categoría de su presupuesto. */
export function creditBudgetMap(accounts: { id: string; kind: string; budget_category_id?: string | null; archived?: boolean }[]): Map<string, string> {
  return new Map(accounts
    .filter((a) => (a.kind === "CREDIT" || a.kind === "LOAN") && a.budget_category_id && !a.archived)
    .map((a) => [a.id, a.budget_category_id as string]));
}

// ---------------------------------------------------------------
// Categorías con subcategorías (un nivel)
// ---------------------------------------------------------------

export interface CategoryNode {
  category: Category;
  children: Category[];
}

const byName = (a: Category, b: Category) => a.name.localeCompare(b.name, "es");

/**
 * Árbol de categorías: principales con sus subcategorías, por nombre.
 * Una subcategoría cuya principal no se ve (privada de la pareja o archivada) se muestra como principal.
 */
export function categoryTree(categories: Category[]): CategoryNode[] {
  const ids = new Set(categories.map((c) => c.id));
  const roots = categories.filter((c) => !c.parent_id || !ids.has(c.parent_id)).sort(byName);
  return roots.map((r) => ({ category: r, children: categories.filter((c) => c.parent_id === r.id).sort(byName) }));
}

/** Lista plana en orden de árbol (principal y luego sus subcategorías). */
export function categoriesInTreeOrder(categories: Category[]): Category[] {
  return categoryTree(categories).flatMap((n) => [n.category, ...n.children]);
}

/** "Vivienda › Crédito hipotecario" para una subcategoría; el nombre solo para una principal. */
export function categoryPath(categories: Category[], id: string | null | undefined): string {
  const c = id ? categories.find((x) => x.id === id) : null;
  if (!c) return "";
  const parent = c.parent_id ? categories.find((x) => x.id === c.parent_id) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** La categoría y todas sus subcategorías. */
export function withDescendants(categories: Category[], ids: Iterable<string>): Set<string> {
  const out = new Set<string>(ids);
  for (const c of categories) if (c.parent_id && out.has(c.parent_id)) out.add(c.id);
  return out;
}

/** Categoría principal de una categoría (ella misma si no es subcategoría o si su principal no se ve). */
export function rootOf(categories: Category[], id: string): string {
  const c = categories.find((x) => x.id === id);
  if (c?.parent_id && categories.some((x) => x.id === c.parent_id)) return c.parent_id;
  return id;
}
