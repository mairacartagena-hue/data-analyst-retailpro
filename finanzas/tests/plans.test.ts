import { describe, expect, it } from "vitest";
import { dueDatesBetween, occurrencesIn, committedTotal } from "@/lib/finance/commitments";
import { planAppliesTo, planMetrics } from "@/lib/finance/plans";
import { goalProgress, pendingSavingsFor } from "@/lib/finance/goals";
import type { BudgetPlan, Category, SavingsGoal, ScheduledPayment, Transaction } from "@/lib/types";

const A = "may";
const B = "brei";
const oct = { start: "2026-10-01", end: "2026-10-31" };
const cat = (id: string, p: Partial<Category> = {}): Category => ({
  id, household_id: "h", name: id, icon: null, responsibility: "FIXED_AMOUNTS", owner_user_id: null,
  is_household_obligation: false, is_shared_progress: true, rollover_enabled: false, archived: false, created_at: "", ...p,
});
const categories = [cat("alimentacion"), cat("mercado", { parent_id: "alimentacion" }), cat("restaurantes", { parent_id: "alimentacion" }), cat("ropa", { responsibility: "PRIVATE", owner_user_id: A })];
const split = (amount: number, category_id: string, responsible_user_id = A) =>
  ({ id: Math.random().toString(36), transaction_id: "t", amount, category_id, responsible_user_id, origin: "NORMAL" as const, note: null });
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-05", amount: 0, description: null,
  merchant: null, account_id: "x", to_account_id: null, payer_user_id: A, counterparty_user_id: null, is_shared: false,
  source: "MANUAL", tags: [], created_by: A, created_at: "", splits: [], scope: "HOUSEHOLD", creates_debt: true, ...p,
});
const sp = (p: Partial<ScheduledPayment>): ScheduledPayment => ({
  id: "sp", scope: "HOUSEHOLD", owner_user_id: A, name: "Mercado del mes", kind: "EXPENSE", amount: 300_000, category_id: "mercado",
  responsible_user_id: null, frequency: "MONTHLY", due_date: null, day_of_month: 31, start_date: "2026-01-01", end_date: null, active: true, ...p,
});
const plan = (p: Partial<BudgetPlan>): BudgetPlan => ({
  id: "p", scope: "HOUSEHOLD", owner_user_id: A, name: "Comida", icon: null, periodicity: "PERIOD", amount: 1_000_000,
  start_date: "2026-01-01", end_date: null, alert_pct: 85, status: "ACTIVE", shared_with_partner: false, ...p,
});

describe("compromisos", () => {
  it("vencimientos mensuales con el día ajustado al fin de mes", () => {
    expect(dueDatesBetween(sp({}), "2026-01-15", "2026-03-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(dueDatesBetween(sp({ frequency: "ONCE", due_date: "2026-10-20", day_of_month: null }), "2026-10-01", "2026-10-31")).toEqual(["2026-10-20"]);
    expect(dueDatesBetween(sp({ end_date: "2026-02-01" }), "2026-01-01", "2026-12-31")).toEqual(["2026-01-31"]);
  });

  it("un vencimiento pagado deja de estar comprometido", () => {
    const payments = [sp({}), sp({ id: "sp2", day_of_month: 3, amount: 50_000 })];
    const paid = tx({ amount: 50_000, scheduled_payment_id: "sp2", scheduled_for: "2026-10-03", splits: [split(50_000, "mercado")] });
    const occ = occurrencesIn(payments, [paid], oct, "2026-10-10");
    expect(occ.map((o) => [o.due, !!o.paid, o.overdue])).toEqual([["2026-10-03", true, false], ["2026-10-31", false, false]]);
    expect(committedTotal(occ)).toBe(300_000);
  });

  it("un pago registrado por Movimientos en la categoría del vencimiento lo marca pagado solo", () => {
    const arriendo = sp({ id: "arr", name: "Arriendo", amount: 1_500_000, category_id: "vivienda", day_of_month: 5 });
    const pago = tx({ amount: 1_500_000, occurred_on: "2026-10-03", splits: [split(1_500_000, "vivienda")] });
    const occ = occurrencesIn([arriendo], [pago], oct, "2026-10-10");
    expect(occ[0].paid?.id).toBe(pago.id);
    expect(occ[0].overdue).toBe(false);
    expect(committedTotal(occ)).toBe(0);
  });

  it("no cruza si el monto, la categoría, el espacio o la fecha no se parecen", () => {
    const arriendo = sp({ id: "arr", amount: 1_500_000, category_id: "vivienda", day_of_month: 5 });
    const casos = [
      tx({ amount: 900_000, occurred_on: "2026-10-03", splits: [split(900_000, "vivienda")] }),
      tx({ amount: 1_500_000, occurred_on: "2026-10-03", splits: [split(1_500_000, "mercado")] }),
      tx({ amount: 1_500_000, occurred_on: "2026-10-03", scope: "PERSONAL", splits: [split(1_500_000, "vivienda")] }),
      tx({ amount: 1_500_000, occurred_on: "2026-09-10", splits: [split(1_500_000, "vivienda")] }),
    ];
    for (const t of casos) expect(occurrencesIn([arriendo], [t], oct, "2026-10-10")[0].paid).toBeNull();
  });

  it("un pago cerca del siguiente vencimiento paga ese, y un compartido se completa con la parte de cada uno", () => {
    const mensual = sp({ id: "m", amount: 100_000, category_id: "vivienda", day_of_month: 5 });
    const pago = tx({ amount: 100_000, occurred_on: "2026-10-28", splits: [split(100_000, "vivienda")] });
    const occ = occurrencesIn([mensual], [pago], { start: "2026-10-01", end: "2026-11-30" }, "2026-11-10");
    expect(occ.map((o) => !!o.paid)).toEqual([false, true]); // 28-oct: paga el del 5-nov, no el del 5-oct

    const compartido = sp({ id: "c", amount: 200_000, share_a: 120_000, share_b: 80_000, category_id: "vivienda", day_of_month: 5 });
    const mia = tx({ amount: 120_000, occurred_on: "2026-10-04", splits: [split(120_000, "vivienda")] });
    const suya = tx({ amount: 80_000, occurred_on: "2026-10-05", payer_user_id: B, created_by: B, splits: [split(80_000, "vivienda", B)] });
    expect(occurrencesIn([compartido], [mia], oct, "2026-10-10")[0].paid).toBeNull();
    expect(occurrencesIn([compartido], [mia, suya], oct, "2026-10-10")[0].paid?.id).toBe(mia.id);
  });
});

describe("presupuestos con nombre", () => {
  const txs = [
    tx({ amount: 200_000, splits: [split(200_000, "mercado")] }),
    tx({ amount: 100_000, splits: [split(60_000, "restaurantes"), split(40_000, "alimentacion")] }),
    tx({ amount: 70_000, scope: "PERSONAL", splits: [split(70_000, "restaurantes")] }), // personal: no entra al del hogar
    tx({ kind: "REFUND", amount: 10_000, splits: [split(10_000, "mercado")] }),
    tx({ amount: 999, occurred_on: "2026-09-30", splits: [split(999, "mercado")] }),
  ];

  it("gastado, comprometido, disponible y proyección; cada parte una sola vez", () => {
    const occ = occurrencesIn([sp({})], txs, oct, "2026-10-10");
    const planCats = [{ plan_id: "p", category_id: "alimentacion", amount: null }, { plan_id: "p", category_id: "mercado", amount: 250_000 }];
    const m = planMetrics(plan({}), planCats, categories, txs, occ, oct, "2026-10-10");
    expect(m.spent).toBe(200_000 + 100_000 - 10_000);
    expect(m.committed).toBe(300_000);
    expect(m.available).toBe(1_000_000 - 290_000);
    // ritmo variable: 290.000 en 10 días → 21 días restantes
    expect(m.projection).toBe(290_000 + 300_000 + Math.round((290_000 / 10) * 21));
    expect(m.projectedOver).toBe(true);
    expect(m.level).toBe("warning");
    expect(m.byCategory).toEqual([
      { categoryId: "alimentacion", limit: null, spent: 290_000 },
      { categoryId: "mercado", limit: 250_000, spent: 190_000 },
    ]);
  });

  it("presupuesto personal: solo partes personales de su dueño", () => {
    const personal = plan({ scope: "PERSONAL", amount: 100_000 });
    const m = planMetrics(personal, [{ plan_id: "p", category_id: "restaurantes", amount: null }], categories, txs, [], oct, "2026-10-31");
    expect(m.spent).toBe(70_000);
    expect(m.projection).toBe(70_000);
    expect(m.level).toBe("ok");
  });

  it("estado y fechas", () => {
    expect(planAppliesTo(plan({ status: "CLOSED" }), oct)).toBe(false);
    expect(planAppliesTo(plan({ start_date: "2026-11-01" }), oct)).toBe(false);
    expect(planAppliesTo(plan({ end_date: "2026-10-01" }), oct)).toBe(true);
    const paused = planMetrics(plan({ status: "PAUSED", amount: 1 }), [{ plan_id: "p", category_id: "mercado", amount: null }], categories, txs, [], oct, "2026-10-10");
    expect(paused.level).toBe("ok");
    const range = planMetrics(plan({ periodicity: "RANGE", start_date: "2026-09-01", end_date: "2026-10-31" }), [{ plan_id: "p", category_id: "mercado", amount: null }], categories, txs, [], oct, "2026-11-05");
    expect(range.spent).toBe(200_000 - 10_000 + 999);
  });
});

describe("metas de ahorro", () => {
  const goal: SavingsGoal = {
    id: "g", scope: "HOUSEHOLD", owner_user_id: A, name: "Viaje", icon: null, target_amount: 1_200_000, target_date: "2027-04-15",
    planned_amount: 200_000, account_id: null, status: "ACTIVE", created_at: "",
  };
  const contributions = [
    { id: "1", goal_id: "g", user_id: A, amount: 150_000, occurred_on: "2026-10-02", note: null, created_at: "" },
    { id: "2", goal_id: "g", user_id: B, amount: 300_000, occurred_on: "2026-09-02", note: null, created_at: "" },
    { id: "3", goal_id: "g", user_id: A, amount: -50_000, occurred_on: "2026-09-20", note: null, created_at: "" },
  ];

  it("avance y aporte mensual necesario", () => {
    const p = goalProgress(goal, contributions, "2026-10-10");
    expect(p.saved).toBe(400_000);
    expect(p.remaining).toBe(800_000);
    expect(p.neededPerMonth).toBe(Math.ceil(800_000 / 6));
  });

  it("ahorro programado pendiente para el Saldo Seguro", () => {
    expect(pendingSavingsFor(A, [goal], contributions, oct)).toBe(50_000);
    expect(pendingSavingsFor(B, [goal], contributions, oct)).toBe(0);
    expect(pendingSavingsFor(A, [{ ...goal, status: "DONE" }], contributions, oct)).toBe(0);
  });
});
