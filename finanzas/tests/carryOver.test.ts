import { describe, expect, it } from "vitest";
import { cycleRange, monthRange } from "@/lib/finance/reconcile";
import { carryOverStatus, classifyLine, coveredRange, reconcileStatement, type StatementLine } from "@/lib/finance/statement";
import type { Account, ReconcilingItem, Transaction } from "@/lib/types";

const card: Account = {
  id: "bbva", household_id: "h", owner_user_id: "u1", name: "BBVA", kind: "CREDIT_CARD", institution: "BBVA", last4: "0602",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -8_000_000, opening_at: "2026-10-01T05:00:00Z",
  credit_limit: null, statement_day: 20, due_day: 5, archived: false,
};
const tx = (id: string, amount: number, occurred_on: string): Transaction => ({
  id, kind: "EXPENSE", status: "CONFIRMED", occurred_on, amount, description: id, merchant: null, account_id: "bbva", to_account_id: null,
  payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL", creates_debt: true, source: "MANUAL", tags: [],
  created_by: "u1", created_at: `${occurred_on}T15:00:00Z`, installments: 1, splits: [],
} as Transaction);
const line = (id: string, date: string, amount: number, description = "COMPRA"): StatementLine =>
  ({ id, date, amount, description, balance: null, kind: classifyLine(description, amount) });
const partida = (t: Transaction): ReconcilingItem => ({ transaction_id: t.id, amount: -t.amount, description: t.description ?? "", occurred_on: t.occurred_on });

describe("ciclo de la tarjeta", () => {
  it("corte el 20: del 21 del mes anterior al 20 del mes", () => {
    expect(cycleRange(20, "2026-11")).toEqual({ month: "2026-11", start: "2026-10-21", end: "2026-11-20" });
    expect(cycleRange(20, "2026-01")).toEqual({ month: "2026-01", start: "2025-12-21", end: "2026-01-20" });
  });
  it("corte el 31: es el mes calendario, también en meses cortos", () => {
    expect(cycleRange(31, "2026-10")).toEqual(monthRange("2026-10"));
    expect(cycleRange(31, "2026-11")).toEqual(monthRange("2026-11"));
    expect(cycleRange(31, "2026-02")).toEqual(monthRange("2026-02"));
  });
  it("corte el 30 en febrero cierra el último día; el ciclo siguiente empieza el 1 de marzo", () => {
    expect(cycleRange(30, "2026-02")).toEqual({ month: "2026-02", start: "2026-01-31", end: "2026-02-28" });
    expect(cycleRange(30, "2026-03")).toEqual({ month: "2026-03", start: "2026-03-01", end: "2026-03-30" });
  });
  it("sin día de corte (cuentas) es el mes calendario", () => {
    expect(cycleRange(null, "2026-11")).toEqual(monthRange("2026-11"));
    expect(cycleRange(undefined, "2026-11")).toEqual(monthRange("2026-11"));
  });
});

describe("partidas del mes anterior en el extracto siguiente", () => {
  // Compras de octubre posteriores al corte del 20: el banco las cobra en el extracto que corta el 20-nov
  const a = tx("airbnb", 161_600, "2026-10-31");
  const b = tx("derroche", 138_000, "2026-10-29");
  const c = tx("d1", 9_300, "2026-10-24");
  const items = [a, b, c].map(partida);
  const txs = [a, b, c, tx("nov", 50_000, "2026-11-04")];
  const lines = [
    line("L1", "2026-10-31", -161_600, "AIRBNB"),
    line("L2", "2026-10-29", -138_000, "EL DERROCHE"),
    line("L4", "2026-11-04", -50_000, "COMPRA NOV"),
  ];

  it("con el mes calendario las compras de octubre del extracto de noviembre no se comparan (el hueco)", () => {
    const rec = reconcileStatement(card, txs, lines, monthRange("2026-11"));
    expect(rec.outOfRange).toBe(2);
    expect(rec.matched).toHaveLength(1);
  });

  it("con el ciclo se comparan: dos aparecen y una no", () => {
    const range = cycleRange(20, "2026-11");
    const rec = reconcileStatement(card, txs, lines, range);
    expect(rec.outOfRange).toBe(0);
    expect(rec.matched).toHaveLength(3);
    const carry = carryOverStatus(items, txs, rec, range);
    expect(carry.map((x) => [x.item.transaction_id, x.status])).toEqual([["airbnb", "FOUND"], ["derroche", "FOUND"], ["d1", "NOT_FOUND"]]);
    expect(carry[0].line?.id).toBe("L1");
  });

  it("sin extracto cargado no se puede saber", () => {
    expect(carryOverStatus(items, txs, null, cycleRange(20, "2026-11")).map((x) => x.status)).toEqual(["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  });

  it("un extracto sin líneas en esas fechas no marca nada como faltante", () => {
    const range = cycleRange(20, "2026-11");
    const rec = reconcileStatement(card, txs, [line("X", "2026-03-01", -1_000)], range);
    expect(carryOverStatus(items, txs, rec, range).map((x) => x.status)).toEqual(["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  });

  it("un movimiento borrado después de aceptarlo como partida se avisa; la partida sin movimiento queda sin saber", () => {
    const range = cycleRange(20, "2026-11");
    const without = txs.filter((t) => t.id !== "d1");
    const rec = reconcileStatement(card, without, lines, range);
    const extra: ReconcilingItem = { transaction_id: null, amount: -5_000, description: "Diferencia", occurred_on: null };
    const carry = carryOverStatus([...items, extra], without, rec, range);
    expect(carry.map((x) => x.status)).toEqual(["FOUND", "FOUND", "GONE", "UNKNOWN"]);
  });

  it("una partida de antes del rango que se compara no se declara faltante", () => {
    const old = tx("viejo", 20_000, "2026-09-15");
    const range = cycleRange(20, "2026-11");
    const rec = reconcileStatement(card, [...txs, old], lines, range);
    expect(carryOverStatus([partida(old)], [...txs, old], rec, range)[0].status).toBe("UNKNOWN");
  });
});

describe("fechas que cubre el archivo", () => {
  const cycle = cycleRange(20, "2026-11"); // 21-oct a 20-nov
  const at = (date: string): StatementLine => line(`x${date}`, date, -1_000);

  it("un extracto del ciclo se compara completo", () => {
    expect(coveredRange(cycle, [at("2026-10-21"), at("2026-11-20")], null)).toEqual(cycle);
  });
  it("un archivo por mes calendario solo se compara en lo que se cruza con el ciclo", () => {
    expect(coveredRange(cycle, [at("2026-11-01"), at("2026-11-30")], null)).toEqual({ ...cycle, start: "2026-11-01" });
  });
  it("el periodo que declara el archivo manda sobre las fechas de sus líneas", () => {
    const r = coveredRange(cycle, [at("2026-10-25"), at("2026-11-15")], { start: "2026-10-21", end: "2026-11-20" });
    expect(r).toEqual(cycle);
  });
  it("sin líneas o sin cruce queda el rango pedido", () => {
    expect(coveredRange(cycle, [], null)).toEqual(cycle);
    expect(coveredRange(cycle, [at("2026-03-01")], null)).toEqual(cycle);
  });
  it("con un archivo del mes calendario, las partidas de octubre no se declaran faltantes", () => {
    const a = tx("airbnb", 161_600, "2026-10-31");
    const lines = [line("N1", "2026-11-04", -50_000, "COMPRA NOV"), line("N2", "2026-11-28", -70_000, "COMPRA TARDE")];
    const txs = [a, tx("nov", 50_000, "2026-11-04")];
    const range = coveredRange(cycle, lines, null);
    const rec = reconcileStatement(card, txs, lines, range);
    expect(rec.outOfRange).toBe(1);
    expect(rec.extra).toHaveLength(0);
    expect(carryOverStatus([partida(a)], txs, rec, range)[0].status).toBe("UNKNOWN");
  });
});
