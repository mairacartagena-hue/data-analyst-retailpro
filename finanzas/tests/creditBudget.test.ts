import { describe, expect, it } from "vitest";
import { cuotaDueFor, findCreditPayments } from "@/lib/finance/creditBudget";
import { nextCuota } from "@/lib/finance/credit";
import { creditBudgetMap, spendingRows } from "@/lib/finance/spaces";
import { safeToSpendDetail, type Snapshot } from "@/lib/finance/derive";
import { DEFAULT_PERIOD_SETTINGS, periodFor } from "@/lib/finance/periods";
import type { Account, CategoryLimit, Member, Transaction } from "@/lib/types";

const A = "may";
const me: Member = { id: "1", household_id: "h", user_id: A, slot: "A", display_name: "May", color: "#000000", avatar: null };
const acc = (id: string, kind: Account["kind"], p: Partial<Account> = {}): Account => ({
  id, household_id: "h", owner_user_id: A, name: id, kind, institution: null, last4: null, visibility: "PRIVATE",
  reveal_in_shared: false, opening_balance: 0, credit_limit: null, statement_day: null, due_day: null, archived: false, ...p,
});
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-23", amount: 0, description: null,
  merchant: null, account_id: "bancolombia", to_account_id: null, payer_user_id: A, counterparty_user_id: null, is_shared: false,
  source: "GMAIL", tags: [], created_by: A, created_at: "", splits: [], scope: "PERSONAL", creates_debt: true, ...p,
});

const lulo = acc("lulo", "CREDIT", {
  name: "Lulo Bank", institution: "Lulo Bank", last4: "6920", due_day: 1, interest_rate_ea: 24.87, term_months: 48,
  paid_installments: 17, paid_installments_on: "2026-10-26", monthly_costs: 34_122, budget_category_id: "cat-lulo",
});
const accounts = [acc("bancolombia", "DEPOSIT"), lulo];
const balances = { bancolombia: 1_000_000, lulo: -19_214_159 };
const base = { meId: A, accounts, balances, limits: [] as CategoryLimit[], budgets: [] };
const today = "2026-10-26";
const cuota = nextCuota(19_214_159, lulo, today);

describe("cuota de un crédito con presupuesto", () => {
  it("la cuota del 1 de noviembre se puede pagar desde 15 días antes hasta 7 después", () => {
    expect(cuotaDueFor("2026-10-23", 1)).toBe("2026-11-01");
    expect(cuotaDueFor("2026-11-06", 1)).toBe("2026-11-01");
    expect(cuotaDueFor("2026-10-10", 1)).toBeNull();
  });

  it("cruza el pago de Lulo de $838.058 (2 % menos que la cuota estimada)", () => {
    const pay = tx({ amount: 838_058, merchant: "Lulo Bank", splits: [] });
    const [m] = findCreditPayments({ ...base, transactions: [pay] }, today);
    expect(Math.abs(838_058 - cuota) / cuota).toBeLessThan(0.05);
    expect(m.transaction.id).toBe(pay.id);
    expect(m.credit.id).toBe("lulo");
    expect(m.due).toBe("2026-11-01");
    expect(m.charges).toBeGreaterThan(34_122); // intereses + seguros
    expect(m.charges).toBeLessThan(838_058);
  });

  it("no cruza si el monto se aleja más del 5 %, si el texto no menciona el crédito o si se registró a mano", () => {
    expect(findCreditPayments({ ...base, transactions: [tx({ amount: Math.round(cuota * 1.08), merchant: "Lulo Bank" })] }, today)).toEqual([]);
    expect(findCreditPayments({ ...base, transactions: [tx({ amount: cuota, merchant: "Éxito" })] }, today)).toEqual([]);
    expect(findCreditPayments({ ...base, transactions: [tx({ amount: cuota, merchant: "Lulo Bank", source: "MANUAL" })] }, today)).toEqual([]);
  });

  it("no cruza otra vez si esa cuota ya se pagó con una transferencia al crédito", () => {
    const paid = tx({ kind: "TRANSFER", to_account_id: "lulo", amount: cuota, occurred_on: "2026-10-20", source: "MANUAL" });
    expect(findCreditPayments({ ...base, transactions: [paid, tx({ amount: cuota, merchant: "Lulo Bank" })] }, today)).toEqual([]);
  });

  it("también reconoce el monto del presupuesto que puso la persona", () => {
    const limits: CategoryLimit[] = [{ id: "l", category_id: "cat-lulo", scope: "HOUSEHOLD", owner_user_id: null, responsibility: "MEMBER_A_100",
      is_household_obligation: false, rollover_enabled: false, shared_with_partner: false }];
    const budgets = [{ id: "b", category_id: "cat-lulo", limit_id: "l", valid_from: "2026-10-01", amount: 1_000_000, fixed_amount_a: null, fixed_amount_b: null }];
    const [m] = findCreditPayments({ ...base, limits, budgets, transactions: [tx({ amount: 1_010_000, merchant: "Pago Lulo" })] }, today);
    expect(m?.credit.id).toBe("lulo");
  });

  it("sin presupuesto en el crédito no se cruza nada", () => {
    const off = accounts.map((a) => (a.id === "lulo" ? { ...a, budget_category_id: null } : a));
    expect(findCreditPayments({ ...base, accounts: off, transactions: [tx({ amount: cuota, merchant: "Lulo Bank" })] }, today)).toEqual([]);
  });

  it("el presupuesto cuenta la cuota completa: lo transferido al crédito, sin contar otra vez los intereses cargados a él", () => {
    const map = creditBudgetMap(accounts);
    const rows = spendingRows([
      tx({ kind: "TRANSFER", to_account_id: "lulo", amount: 838_058 }),
      tx({ account_id: "lulo", amount: 430_000, scope: "HOUSEHOLD", splits: [{ id: "s", transaction_id: "t", amount: 430_000, category_id: "cat-lulo", responsible_user_id: A, origin: "NORMAL", note: null }] }),
    ], map);
    expect(rows).toEqual([{ categoryId: "cat-lulo", responsibleUserId: A, occurredOn: "2026-10-23", total: 838_058, scope: "HOUSEHOLD" }]);
  });

  it("el presupuesto del crédito no se resta otra vez como obligación del hogar en el Saldo Seguro", () => {
    const s: Snapshot = {
      me, partner: null, settings: DEFAULT_PERIOD_SETTINGS, accounts, balances, categories: [], transactions: [], ledger: [], spending: [], assets: [],
      limits: [{ id: "l", category_id: "cat-lulo", scope: "HOUSEHOLD", owner_user_id: null, responsibility: "MEMBER_A_100", is_household_obligation: true, rollover_enabled: false, shared_with_partner: false }],
      budgets: [{ id: "b", category_id: "cat-lulo", limit_id: "l", valid_from: "2026-10-01", amount: 900_000, fixed_amount_a: null, fixed_amount_b: null }],
    };
    expect(safeToSpendDetail(s, periodFor(DEFAULT_PERIOD_SETTINGS, today)).obligations).toEqual([]);
  });
});
