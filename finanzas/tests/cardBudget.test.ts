import { describe, expect, it } from "vitest";
import { cardBudgetVersions, cardPaymentPortions, legacySchedule } from "@/lib/finance/cardBudget";
import { cardDue, projectCard } from "@/lib/finance/installments";
import { occurrencesIn } from "@/lib/finance/commitments";
import { findCreditPayments } from "@/lib/finance/creditBudget";
import { nextCuota } from "@/lib/finance/credit";
import { spendingRows } from "@/lib/finance/spaces";
import { DEFAULT_PERIOD_SETTINGS } from "@/lib/finance/periods";
import type { Account, CardStatementItem, ScheduledPayment, Transaction } from "@/lib/types";

const A = "may";
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-23", amount: 0, description: null,
  merchant: null, account_id: "ahorros", to_account_id: null, payer_user_id: A, counterparty_user_id: null, is_shared: false,
  source: "MANUAL", tags: [], created_by: A, created_at: "", splits: [], scope: "PERSONAL", creates_debt: true, ...p,
});
const acc = (id: string, kind: Account["kind"], p: Partial<Account> = {}): Account => ({
  id, household_id: "h", owner_user_id: A, name: id, kind, institution: null, last4: null, visibility: "PRIVATE",
  reveal_in_shared: false, opening_balance: 0, credit_limit: null, statement_day: null, due_day: null, archived: false, ...p,
});

// Tarjeta registrada con el extracto del 20-oct (pago el 5-nov): saldo al corte $1.000.000 y un televisor diferido
// del que faltan 10 cuotas ($600.000). La deuda total es $1.600.000. Abierta el 21-oct (día siguiente al corte).
const item: CardStatementItem = { id: "tv", account_id: "visa", description: "Televisor", purchase_date: "2026-03-01", amount: 1_200_000,
  installments: 20, paid_installments: 10, remaining_balance: 600_000, rate_ea: 0 };
const visa = acc("visa", "CREDIT_CARD", { statement_day: 20, due_day: 5, opening_at: "2026-10-21T05:00:00.000Z", opening_balance: -1_600_000, budget_category_id: "cat-visa" });

describe("tarjeta registrada con el saldo al corte y compras a cuotas", () => {
  it("el saldo al corte vence el 5-nov y cada cuota del televisor en los pagos siguientes", () => {
    const plan = legacySchedule(visa, [item]);
    expect(plan[0]).toEqual({ cut: "2026-10-20", due: "2026-11-05", amount: 1_000_000, statement: true });
    expect(plan[1]).toEqual({ cut: "2026-11-20", due: "2026-12-05", amount: 60_000 });
    expect(plan).toHaveLength(11);
    expect(plan.reduce((a, c) => a + c.amount, 0)).toBe(1_600_000);
  });

  it("la proyección incluye el saldo al corte en noviembre y las cuotas desde diciembre", () => {
    const rows = projectCard(visa, [], "2026-10-31", 3, [item]);
    expect(rows.map((r) => [r.month, r.total])).toEqual([["2026-10", 0], ["2026-11", 1_000_000], ["2026-12", 60_000]]);
    // después de pagar el extracto, ya no aparece
    const paid = tx({ kind: "TRANSFER", to_account_id: "visa", amount: 1_000_000, occurred_on: "2026-11-03" });
    expect(projectCard(visa, [paid], "2026-10-31", 3, [item])[1].total).toBe(0);
  });

  it("en noviembre toca pagar solo el saldo al corte (no el saldo diferido)", () => {
    const d = cardDue(visa, -1_600_000, [], { start: "2026-11-01", end: "2026-11-30" }, [item]);
    expect(d.due).toBe(1_000_000);
    expect(d.dueDate).toBe("2026-11-05");
  });

  it("el presupuesto de la tarjeta va mes a mes con lo que vence y queda en 0 al terminar", () => {
    const v = cardBudgetVersions(visa, [item], DEFAULT_PERIOD_SETTINGS, "2026-10-31");
    expect(v[0]).toEqual({ valid_from: "2026-10-01", amount: 0 });
    expect(v[1]).toEqual({ valid_from: "2026-11-01", amount: 1_000_000 });
    expect(v[2]).toEqual({ valid_from: "2026-12-01", amount: 60_000 });
    expect(v.at(-1)).toEqual({ valid_from: "2027-10-01", amount: 0 });
  });

  it("del pago a la tarjeta solo cuenta en su presupuesto lo que cubre la deuda anterior", () => {
    const nov = tx({ kind: "TRANSFER", to_account_id: "visa", amount: 1_000_000, occurred_on: "2026-11-03" });
    const dec = tx({ kind: "TRANSFER", to_account_id: "visa", amount: 360_000, occurred_on: "2026-12-04" }); // 60.000 + compras nuevas
    const parts = cardPaymentPortions([visa], [nov, dec], [item]);
    expect(parts.get(nov.id)?.amount).toBe(1_000_000);
    expect(parts.get(dec.id)?.amount).toBe(60_000);
    const rows = spendingRows([nov, dec], new Map(), parts);
    expect(rows.map((r) => [r.categoryId, r.total, r.scope])).toEqual([["cat-visa", 1_000_000, "HOUSEHOLD"], ["cat-visa", 60_000, "HOUSEHOLD"]]);
  });

  it("un pago menor deja el resto para el siguiente pago", () => {
    const a = tx({ kind: "TRANSFER", to_account_id: "visa", amount: 400_000, occurred_on: "2026-11-03" });
    const b = tx({ kind: "TRANSFER", to_account_id: "visa", amount: 900_000, occurred_on: "2026-11-25" });
    const parts = cardPaymentPortions([visa], [a, b], [item]);
    expect(parts.get(a.id)?.amount).toBe(400_000);
    expect(parts.get(b.id)?.amount).toBe(660_000); // 600.000 del extracto + la cuota del corte del 20-nov
  });

  it("sin presupuesto en la tarjeta, el pago no cuenta en ningún presupuesto", () => {
    const pay = tx({ kind: "TRANSFER", to_account_id: "visa", amount: 1_000_000, occurred_on: "2026-11-03" });
    expect(cardPaymentPortions([{ ...visa, budget_category_id: null }], [pay], [item]).size).toBe(0);
  });
});

describe("cruce del pago de una deuda con el vencimiento", () => {
  const sp: ScheduledPayment = {
    id: "sp", household_id: "h", owner_user_id: A, name: "Hipoteca", kind: "DEBT_PAYMENT", scope: "HOUSEHOLD", amount: 1_500_000,
    frequency: "MONTHLY", day_of_month: 5, due_date: null, start_date: "2026-01-01", end_date: null, category_id: "cat-hip",
    responsible_user_id: null, active: true,
  } as ScheduledPayment;

  it("una transferencia al crédito con presupuesto de esa categoría paga el vencimiento", () => {
    const t = tx({ kind: "TRANSFER", to_account_id: "hipoteca", amount: 1_500_000, occurred_on: "2026-11-04" });
    const [o] = occurrencesIn([sp], [t], { start: "2026-11-01", end: "2026-11-30" }, "2026-11-10", new Map([["hipoteca", "cat-hip"]]));
    expect(o.paid?.id).toBe(t.id);
    const [none] = occurrencesIn([sp], [t], { start: "2026-11-01", end: "2026-11-30" }, "2026-11-10");
    expect(none.paid).toBeNull();
  });
});

describe("pago de la cuota registrado a mano en la categoría del crédito", () => {
  const credit = acc("hipoteca", "CREDIT", { due_day: 5, interest_rate_ea: 12, term_months: 240, paid_installments: 30,
    paid_installments_on: "2026-10-01", budget_category_id: "cat-hip" });
  const s = { meId: A, accounts: [acc("ahorros", "DEPOSIT"), credit], balances: { ahorros: 5_000_000, hipoteca: -100_000_000 }, limits: [], budgets: [] };
  const cuota = nextCuota(100_000_000, credit, "2026-11-04");

  it("se cruza aunque el texto no mencione el crédito y difiera hasta 25 %", () => {
    const t = tx({ kind: "DEBT_PAYMENT", amount: Math.round(cuota * 1.2), occurred_on: "2026-11-04", description: "cuota",
      splits: [{ id: "s", transaction_id: "x", amount: Math.round(cuota * 1.2), category_id: "cat-hip", responsible_user_id: A, origin: "NORMAL", note: null }] });
    const [m] = findCreditPayments({ ...s, transactions: [t] }, "2026-11-04");
    expect(m?.transaction.id).toBe(t.id);
  });

  it("un gasto a mano de otra categoría no se toca", () => {
    const t = tx({ amount: cuota, occurred_on: "2026-11-04", merchant: "hipoteca",
      splits: [{ id: "s", transaction_id: "x", amount: cuota, category_id: "otra", responsible_user_id: A, origin: "NORMAL", note: null }] });
    expect(findCreditPayments({ ...s, transactions: [t] }, "2026-11-04")).toEqual([]);
  });
});

describe("presupuesto de la tarjeta con centavos del extracto", () => {
  it("los montos quedan en pesos enteros", async () => {
    const { cardBudgetVersions, legacySchedule } = await import("@/lib/finance/cardBudget");
    const card = { id: "bbva", statement_day: 20, due_day: 5, opening_at: "2026-10-21T05:00:00+00:00", opening_balance: -8_153_194 };
    const items = [{ id: "a", account_id: "bbva", description: "AGOSTO", purchase_date: "2026-08-25", amount: 7_000_000, installments: 36,
      paid_installments: 1, remaining_balance: 5_927_985.68, rate_ea: null }];
    for (const c of legacySchedule(card, items)) expect(Number.isInteger(c.amount)).toBe(true);
    const v = cardBudgetVersions(card, items, DEFAULT_PERIOD_SETTINGS, "2026-11-01");
    expect(v.length).toBeGreaterThan(0);
    for (const x of v) expect(Number.isInteger(x.amount)).toBe(true);
  });
});

describe("pago de la tarjeta con presupuesto: se cruza con la tarjeta", () => {
  const ahorros = acc("ahorros", "DEPOSIT");
  const s = { meId: A, accounts: [ahorros, visa], balances: { ahorros: 5_000_000, visa: -1_600_000 }, limits: [], budgets: [], cardItems: [item] };
  const split = (amount: number, category_id: string) => [{ id: "s", transaction_id: "x", amount, category_id, responsible_user_id: A, origin: "NORMAL" as const, note: null }];

  it("un pago registrado en la categoría de la tarjeta, entre la cuota y el extracto, se convierte en pago a la tarjeta", () => {
    const t = tx({ amount: 1_000_000, occurred_on: "2026-11-04", splits: split(1_000_000, "cat-visa") });
    const [m] = findCreditPayments({ ...s, transactions: [t] }, "2026-11-04");
    expect(m?.credit.id).toBe("visa");
    expect(m?.charges).toBe(0);
    expect(m?.due).toBe("2026-11-05");
  });

  it("un aviso del banco que menciona la tarjeta con el valor del extracto se cruza", () => {
    const t = tx({ source: "EMAIL", amount: 1_000_000, occurred_on: "2026-11-03", merchant: "Pago visa" });
    expect(findCreditPayments({ ...s, transactions: [t] }, "2026-11-04")[0]?.credit.id).toBe("visa");
  });

  it("la tarjeta de la que soy responsable (aunque sea de mi pareja) también se cruza", () => {
    const mine = { ...visa, owner_user_id: "pareja", responsible_user_id: A };
    const t = tx({ amount: 1_000_000, occurred_on: "2026-11-04", splits: split(1_000_000, "cat-visa") });
    expect(findCreditPayments({ ...s, accounts: [ahorros, mine], transactions: [t] }, "2026-11-04")).toHaveLength(1);
  });

  it("un gasto de otra categoría no se toca", () => {
    const t = tx({ amount: 1_000_000, occurred_on: "2026-11-04", splits: split(1_000_000, "mercado") });
    expect(findCreditPayments({ ...s, transactions: [t] }, "2026-11-04")).toEqual([]);
  });
});
