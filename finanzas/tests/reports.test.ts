import { describe, expect, it } from "vitest";
import { matchesFilter, monthlyTrend, spendingByCategory, spendingByPerson, tagStats, toCsv } from "@/lib/finance/reports";
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
    expect(lines[0]).toBe("Fecha;Tipo;Ámbito;Descripción;Comercio;Monto;Categoría;Responsable;Pagó;Cuenta;Estado");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(";-165000;Mercado;Maira;Maira;");
    expect(lines[2]).toContain(";-35000;Sin categoría;Beto;Maira;");
  });
});
