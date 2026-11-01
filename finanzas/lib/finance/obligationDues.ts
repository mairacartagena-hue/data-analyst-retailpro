// Vencimientos de los presupuestos obligatorios del hogar: la cuota de cada crédito o tarjeta cuyo presupuesto es del
// hogar y obligatorio se le muestra a los dos, no solo a quien la paga. El monto es el del presupuesto en esa fecha y
// queda pagada cuando hay un pago a esa cuenta o un gasto en su categoría cerca del día de pago.

import type { Account, CategoryBudgetRow, CategoryLimit, ObligationDebt, Transaction } from "@/lib/types";
import { budgetVersionAt } from "./budget";
import { responsibleOf, toBudgetCategories } from "./derive";
import { statementsDueIn } from "./installments";
import type { Period } from "./periods";

const DAYS_BEFORE_DUE = 15;
const DAYS_AFTER_DUE = 7;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export interface ObligationDue {
  accountId: string;
  name: string;
  kind: ObligationDebt["kind"];
  categoryId: string;
  /** Quien paga la cuenta. */
  responsibleId: string;
  due: string;
  amount: number;
  paid: boolean;
}

/** Ya me sale en Vencimientos con su detalle (la pago yo, o es mi tarjeta con presupuesto). */
function alreadyMine(d: Pick<ObligationDebt, "kind" | "owner_user_id" | "responsible_user_id">, meId: string): boolean {
  if (responsibleOf(d) === meId) return true;
  return d.kind === "CREDIT_CARD" && d.owner_user_id === meId;
}

export function obligationDues(s: {
  meId: string;
  debts: ObligationDebt[];
  accounts: Account[];
  limits: CategoryLimit[];
  budgets: CategoryBudgetRow[];
  transactions: Transaction[];
}, period: Period): ObligationDue[] {
  const obligation = new Map(s.limits.filter((l) => l.scope === "HOUSEHOLD" && l.is_household_obligation).map((l) => [l.category_id, l]));
  // Los que entrega Supabase (incluye cuentas privadas) más los visibles, por si la función aún no existe
  const byId = new Map<string, ObligationDebt>();
  for (const d of s.debts) byId.set(d.id, d);
  for (const a of s.accounts) {
    if (byId.has(a.id) || a.archived || !a.due_day || !a.budget_category_id) continue;
    if (a.kind !== "CREDIT" && a.kind !== "LOAN" && a.kind !== "CREDIT_CARD") continue;
    byId.set(a.id, { id: a.id, owner_user_id: a.owner_user_id, responsible_user_id: a.responsible_user_id ?? null, name: a.name,
      kind: a.kind, statement_day: a.statement_day, due_day: a.due_day, budget_category_id: a.budget_category_id });
  }
  const out: ObligationDue[] = [];
  for (const d of byId.values()) {
    const limit = obligation.get(d.budget_category_id);
    if (!limit || alreadyMine(d, s.meId)) continue;
    const versions = toBudgetCategories([limit], s.budgets)[0].budgets;
    const cutDay = d.kind === "CREDIT_CARD" ? (d.statement_day ?? d.due_day) : d.due_day;
    for (const { due } of statementsDueIn(cutDay, d.due_day, period)) {
      const amount = budgetVersionAt(versions, due)?.amount ?? 0;
      if (amount <= 0) continue;
      const paid = s.transactions.some((t) => {
        if (t.status === "PENDING_REVIEW") return false;
        const diff = dayDiff(t.occurred_on, due);
        if (diff < -DAYS_BEFORE_DUE || diff > DAYS_AFTER_DUE) return false;
        if (t.kind === "TRANSFER" || t.kind === "SETTLEMENT") return t.to_account_id === d.id;
        return (t.kind === "EXPENSE" || t.kind === "DEBT_PAYMENT") && t.account_id !== d.id
          && t.splits.some((x) => x.category_id === d.budget_category_id);
      });
      out.push({ accountId: d.id, name: d.name, kind: d.kind, categoryId: d.budget_category_id, responsibleId: responsibleOf(d), due, amount, paid });
    }
  }
  return out;
}
