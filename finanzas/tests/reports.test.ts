import { describe, expect, it } from "vitest";
import { fixedVsVariable, matchesFilter, monthlyTrend, pendingInPeriod, periodTrend, spendingByCategory, spendingByPerson, tagStats, taxSummary, toCsv, withCreditCapital } from "@/lib/finance/reports";
import { expandInstallments } from "@/lib/finance/installments";
import { periodFor, shiftPeriod } from "@/lib/finance/periods";
import type { Category, Member, Transaction } from "@/lib/types";

const A = "a";
const B = "b";
const members: Member[] = [
  { id: "1", household_id: "h", user_id: A, slot: "A", display_name: "Maira", color: "#000000", avatar: null },
  { id: "2", household_id: "h", user_id: B, slot: "B", display_name: "Beto", color: "#000000", avatar: null },
];
const cat = (id: string, name: string, responsibility: Category["responsibility"]): Category => ({
  id, household_id: "h", name, icon: null, responsibility, owner_user_id: responsibility === "PRIVATE" ? A : null,
  is_household_obligation: false, is_shared_progress: false, rollover_enabled: false, archived: false, created_at: "",
});
const cats = [cat("merc", "Mercado", "MEMBER_A_100"), cat("ropa", "Ropa", "PRIVATE")];
const split = (amount: number, category_id: string | null, responsible_user_id = A) =>
  ({ id: Math.random().toString(36), transaction_id: "t", amount, category_id, responsible_user_id, origin: "NORMAL" as const, note: null });
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-10", amount: 0, description: null,
  merchant: null, account_id: "x", to_account_id: null, payer_user_id: A, counterparty_user_id: null, is_shared: false,
  source: "MANUAL", tags: [], created_by: A, created_at: "", splits: [], scope: "PERSONAL", creates_debt: true, ...p,
});
const oct = { start: "2026-10-01", end: "2026-10-31" };

const data = [
  tx({ amount: 200_000, splits: [split(165_000, "merc"), split(35_000, null, B)], tags: ["#bancolombia"], scope: "HOUSEHOLD" }),
  tx({ amount: 50_000, splits: [split(50_000, "ropa")], tags: ["#suscripcion", "#bbva"] }),
  tx({ amount: 30_000, splits: [split(30_000, "secreta", B)], payer_user_id: B, created_by: B, tags: ["#suscripcion"] }), // categoría privada de B
  tx({ kind: "INCOME", amount: 6_000_000, occurred_on: "2026-10-23" }),
  tx({ amount: 10_000, occurred_on: "2026-09-30", splits: [split(10_000, "merc")] }),
];

describe("informes", () => {
  it("gastos por categoría, con lo privado agrupado", () => {
    expect(spendingByCategory(data, cats, oct).map((c) => [c.name, c.total])).toEqual([
      ["Mercado", 165_000], ["Ropa", 50_000], ["Sin categoría", 35_000], ["Privado", 30_000],
    ]);
  });

  it("tendencia de meses", () => {
    expect(monthlyTrend(data, ["2026-09", "2026-10"])).toEqual([
      { month: "2026-09", income: 0, expense: 10_000 },
      { month: "2026-10", income: 6_000_000, expense: 280_000 },
    ]);
  });

  it("por persona: hogar y personal según el ámbito del movimiento", () => {
    expect(spendingByPerson(data, cats, oct, members)).toEqual([
      { userId: A, name: "Maira", household: 165_000, personal: 50_000 },
      { userId: B, name: "Beto", household: 35_000, personal: 30_000 },
    ]);
  });

  it("reembolsos restan, pagos de deuda suman y transferencias, ajustes y liquidaciones no cuentan", () => {
    const extra = [
      ...data,
      tx({ kind: "DEBT_PAYMENT", amount: 100_000, splits: [split(100_000, "merc")] }),
      tx({ kind: "REFUND", amount: 15_000, splits: [split(15_000, "merc")] }),
      tx({ kind: "TRANSFER", amount: 999_999, to_account_id: "y" }),
      tx({ kind: "ADJUSTMENT", amount: 777, direction: "OUT" }),
      tx({ kind: "SETTLEMENT", amount: 5_000, counterparty_user_id: B }),
    ];
    expect(spendingByCategory(extra, cats, oct)[0]).toMatchObject({ name: "Mercado", total: 165_000 + 100_000 - 15_000 });
    expect(monthlyTrend(extra, ["2026-10"])).toEqual([{ month: "2026-10", income: 6_000_000, expense: 280_000 + 100_000 - 15_000 }]);
  });

  it("subcategorías: se agrupan en su principal si se pide", () => {
    const tree = [...cats, { ...cat("viv", "Vivienda", "FIXED_AMOUNTS") }, { ...cat("hip", "Hipoteca", "MEMBER_A_100"), parent_id: "viv" }];
    const txs = [tx({ amount: 9, splits: [split(9, "hip")] })];
    expect(spendingByCategory(txs, tree, oct).map((c) => c.name)).toEqual(["Vivienda › Hipoteca"]);
    expect(spendingByCategory(txs, tree, oct, true).map((c) => [c.key, c.name])).toEqual([["viv", "Vivienda"]]);
  });
});

describe("etiquetas", () => {
  it("conteo, total y cuántos son editables", () => {
    const s = tagStats(data, A);
    expect(s[0]).toEqual({ tag: "#suscripcion", count: 2, total: 80_000, editable: 1 });
  });

  it("filtro por etiqueta, categoría y cuenta", () => {
    expect(data.filter((t) => matchesFilter(t, { tag: "#suscripcion" }))).toHaveLength(2);
    expect(data.filter((t) => matchesFilter(t, { categoryId: "merc" }))).toHaveLength(2);
    expect(data.filter((t) => matchesFilter(t, { tag: "#bbva", categoryId: "merc" }))).toHaveLength(0);
    expect(data.filter((t) => matchesFilter(t, { scope: "HOUSEHOLD" }))).toHaveLength(1);
    expect(data.filter((t) => matchesFilter(t, { kind: "INCOME" }))).toHaveLength(1);
    expect(data.filter((t) => matchesFilter(t, { responsibleId: B }))).toHaveLength(2);
    expect(data.filter((t) => matchesFilter(t, { payerId: B }))).toHaveLength(1);
    expect(data.filter((t) => matchesFilter(t, { categoryIds: new Set(["merc", "ropa"]) }))).toHaveLength(3);
  });
});

describe("CSV", () => {
  it("separador punto y coma, una fila por parte y gastos en negativo", () => {
    const csv = toCsv(data.slice(0, 1), { categories: cats, labels: [], memberById: (id) => members.find((m) => m.user_id === id) ?? null });
    const lines = csv.replace("﻿", "").split("\r\n");
    expect(lines[0]).toBe("Fecha;Tipo;Ámbito;Descripción;Comercio;Monto;Cuota;Categoría;Responsable;Pagó;Cuenta;Estado");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(";-165000;;Mercado;Maira;Maira;");
    expect(lines[2]).toContain(";-35000;;Sin categoría;Beto;Maira;");
  });

  it("una compra a cuotas sale con la cuota del periodo, como en los gráficos", () => {
    const tv = tx({ amount: 1_200_000, installments: 12, splits: [split(1_200_000, "merc")], occurred_on: "2026-09-15" });
    const inOct = expandInstallments([tv]).filter((t) => t.occurred_on >= oct.start && t.occurred_on <= oct.end);
    const lines = toCsv(inOct, { categories: cats, labels: [], memberById: () => null }).replace("\uFEFF", "").split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(";-100000;2 de 12;Mercado;");
  });
});

describe("informes de la etapa 4", () => {
  const settings = { cycle: "MONTHLY" as const, monthlyStartDay: 22, biweeklyFirstDay: 1, biweeklySecondDay: 16 };

  it("tendencia por los periodos del hogar (no por mes calendario)", () => {
    const p = periodFor(settings, "2026-10-25");
    const prev = shiftPeriod(settings, p, -1);
    const rows = periodTrend([
      tx({ amount: 100, splits: [split(100, "merc")], occurred_on: "2026-10-21" }), // periodo anterior (22-sep a 21-oct)
      tx({ amount: 50, splits: [split(50, "merc")], occurred_on: "2026-10-22" }),
      tx({ kind: "INCOME", amount: 900, occurred_on: "2026-10-25" }),
    ], [prev, p]);
    expect(rows.map((r) => [r.period.start, r.income, r.expense])).toEqual([["2026-09-22", 0, 100], ["2026-10-22", 900, 50]]);
  });

  it("cuánto está por revisar dentro de los gastos", () => {
    expect(pendingInPeriod([
      tx({ amount: 58_000, status: "PENDING_REVIEW", splits: [split(58_000, null)] }),
      tx({ amount: 10_000, splits: [split(10_000, "merc")] }),
      tx({ kind: "TRANSFER", amount: 5, status: "PENDING_REVIEW" }),
    ], oct)).toEqual({ count: 1, amount: 58_000 });
  });

  it("resumen para la renta: ingresos, 4x1000 de mis cuentas e intereses de mis créditos", () => {
    const accounts = [
      { id: "ah", name: "Ahorros", kind: "DEPOSIT", owner_user_id: A },
      { id: "hip", name: "Hipoteca", kind: "CREDIT", owner_user_id: A, monthly_costs: 68_000 },
      { id: "otra", name: "De Beto", kind: "DEPOSIT", owner_user_id: B },
    ];
    const r = taxSummary([
      tx({ kind: "INCOME", amount: 6_000_000, occurred_on: "2026-01-30" }),
      tx({ kind: "INCOME", amount: 1_000, occurred_on: "2025-12-30" }),
      tx({ amount: 15_600, tags: ["#gmf"], account_id: "ah" }),
      tx({ amount: 9_000, tags: ["#gmf"], account_id: "otra", payer_user_id: B }),
      tx({ kind: "TRANSFER", amount: 1_950_000, account_id: "ah", to_account_id: "hip", occurred_on: "2026-10-05" }),
      tx({ amount: 1_020_000, account_id: "hip", occurred_on: "2026-10-05" }),
    ], { userId: A, year: 2026, categories: cats, accounts });
    expect(r.income).toBe(6_000_000);
    expect(r.gmf).toBe(15_600);
    // Intereses sin el seguro mensual del crédito
    expect(r.credits).toEqual([{ id: "hip", name: "Hipoteca", interest: 952_000, insurance: 68_000, charges: 1_020_000, capital: 930_000, payments: 1 }]);
  });

  it("gastos fijos frente a variables", () => {
    const r = fixedVsVariable([
      tx({ amount: 420_000, scheduled_payment_id: "adm", splits: [split(420_000, "merc")] }),
      tx({ amount: 44_900, tags: ["#suscripcion"], splits: [split(44_900, "ropa")] }),
      tx({ amount: 70_000, tags: ["#suscripcion"], movement_type: "TRANSFER_OUT", splits: [split(70_000, "ropa")] }), // a un familiar: no es suscripción
      tx({ amount: 1_020_000, account_id: "hip", splits: [split(1_020_000, "merc")] }),
      tx({ amount: 80_000, splits: [split(80_000, "merc")] }),
      tx({ kind: "TRANSFER", amount: 930_000, to_account_id: "hip" }),
    ], oct, { categories: cats, creditIds: new Set(["hip"]) });
    expect(r).toEqual({ scheduled: 420_000, subscriptions: 44_900, creditCharges: 1_020_000, variable: 150_000 });
  });

  it("la cuota de un crédito cuenta completa: capital más intereses y seguros, en la categoría de la cuota", () => {
    const accounts = [{ id: "hip", name: "Hipoteca", kind: "CREDIT", budget_category_id: "merc" }];
    const txs = withCreditCapital([
      // Cargado al crédito: transferencia por el total y gasto de intereses en el crédito
      tx({ kind: "TRANSFER", amount: 1_953_000, account_id: "ah", to_account_id: "hip", scope: "HOUSEHOLD", occurred_on: "2026-10-23" }),
      tx({ amount: 1_020_417, account_id: "hip", scope: "HOUSEHOLD", occurred_on: "2026-10-23", splits: [split(600_000, "merc"), split(420_417, "merc", B)] }),
    ], accounts);
    expect(spendingByCategory(txs, cats, oct)).toEqual([{ key: "merc", name: "Mercado", icon: expect.any(String), total: 1_953_000 }]);
    expect(spendingByPerson(txs, cats, oct, members).map((p) => p.household)).toEqual([600_000 + 548_354, 420_417 + 384_229]);
    expect(fixedVsVariable(txs, oct, { categories: cats, creditIds: new Set(["hip"]) }).creditCharges).toBe(1_953_000);
    // Sin gasto de intereses: todo es capital, en la categoría del presupuesto del crédito
    const solo = withCreditCapital([tx({ kind: "TRANSFER", amount: 500_000, account_id: "ah", to_account_id: "hip" })], accounts);
    expect(spendingByCategory(solo, cats, oct).map((c) => [c.key, c.total])).toEqual([["merc", 500_000]]);
  });
});
