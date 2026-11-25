import { describe, expect, it } from "vitest";
import { firstReadWithLines, sanitizeCardLines, type CardLinesData } from "@/lib/capture/cardStatement";
import { TOTALS_TOLERANCE, checkPrintedTotals, parsedFromCardLines } from "@/lib/finance/cardLines";
import { cycleRange } from "@/lib/finance/reconcile";
import { coveredRange, reconcileStatement } from "@/lib/finance/statement";
import type { Account, Transaction } from "@/lib/types";

const TODAY = "2026-11-24";
const card: Account = {
  id: "bbva", household_id: "h", owner_user_id: "u1", name: "BBVA", kind: "CREDIT_CARD", institution: "BBVA", last4: "0602",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -8_000_000, opening_at: "2026-10-01T05:00:00Z",
  credit_limit: null, statement_day: 20, due_day: 5, archived: false,
};
const tx = (id: string, amount: number, occurred_on: string, kind: "EXPENSE" | "INCOME" = "EXPENSE"): Transaction => ({
  id, kind, status: "CONFIRMED", occurred_on, amount, description: id, merchant: null, account_id: "bbva", to_account_id: null,
  payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL", creates_debt: true, source: "MANUAL", tags: [],
  created_by: "u1", created_at: `${occurred_on}T15:00:00Z`, installments: 1, splits: [],
} as Transaction);

const raw = (over: Record<string, unknown> = {}) => ({
  institution: " BBVA ", card_number: "**** **** **** 0602", period_start: "2026-10-21", period_end: "2026-11-20",
  printed_totals: { purchases: 500_000, payments: 300_000, interest: 45_000, fees: 20_000 },
  lines: [
    { date: "2026-10-25", description: "EXITO  CHAPINERO", amount: 150_000, kind: "PURCHASE", is_credit: false, installment_no: null },
    { date: "2026-11-02", description: "PAGO PSE", amount: 300_000, kind: "PAYMENT", is_credit: true, installment_no: null },
    { date: "2026-11-05", description: "TV SAMSUNG", amount: 350_000, kind: "PURCHASE", is_credit: false, installment_no: 3 },
    { date: "2026-11-20", description: "INTERESES CORRIENTES", amount: 45_000, kind: "INTEREST", is_credit: false, installment_no: null },
    { date: "2026-11-20", description: "CUOTA DE MANEJO", amount: 20_000, kind: "FEE", is_credit: false, installment_no: null },
  ],
  ...over,
});

describe("sanitizeCardLines", () => {
  it("lee cabecera, periodo, totales y movimientos", () => {
    const d = sanitizeCardLines(raw(), TODAY);
    expect(d.institution).toBe("BBVA");
    expect(d.last4).toBe("0602");
    expect([d.periodStart, d.periodEnd]).toEqual(["2026-10-21", "2026-11-20"]);
    expect(d.totals).toEqual({ purchases: 500_000, payments: 300_000, interest: 45_000, fees: 20_000 });
    expect(d.lines).toHaveLength(5);
    expect(d.lines[0]).toMatchObject({ description: "EXITO CHAPINERO", amount: 150_000, kind: "PURCHASE", credit: false });
    expect(d.lines[2].installmentNo).toBe(3);
    expect(d.lines[0].installmentNo).toBeUndefined();
    expect(d.dropped).toBe(0);
  });

  it("un pago siempre es abono; un valor negativo también", () => {
    const d = sanitizeCardLines(raw({ lines: [
      { date: "2026-11-02", description: "PAGO", amount: 100_000, kind: "PAYMENT", is_credit: false },
      { date: "2026-11-03", description: "DEVOLUCION", amount: -80_000, kind: "PURCHASE", is_credit: false },
      { date: "2026-11-04", description: "REVERSION", amount: 5_000, kind: "FEE", is_credit: true },
    ] }), TODAY);
    expect(d.lines.map((l) => [l.amount, l.credit])).toEqual([[100_000, true], [80_000, true], [5_000, true]]);
  });

  it("descarta lo ilegible y lo cuenta", () => {
    const d = sanitizeCardLines(raw({ lines: [
      { date: "2026-11-02", description: "OK", amount: 10_000, kind: "PURCHASE" },
      { date: "02/11", description: "sin año", amount: 10_000, kind: "PURCHASE" },
      { date: "2026-11-03", description: "sin valor", amount: 0, kind: "PURCHASE" },
      { date: "2026-11-03", description: "texto", amount: "10.000", kind: "PURCHASE" },
      { date: "2019-11-03", description: "año imposible", amount: 10_000, kind: "PURCHASE" },
    ] }), TODAY);
    expect(d.lines).toHaveLength(1);
    expect(d.dropped).toBe(4);
  });

  it("tipo desconocido pasa a OTHER; cuota fuera de 1–48 se ignora", () => {
    const d = sanitizeCardLines(raw({ lines: [{ date: "2026-11-02", description: "X", amount: 1_000, kind: "AVANCE", installment_no: 99 }] }), TODAY);
    expect(d.lines[0].kind).toBe("OTHER");
    expect(d.lines[0].installmentNo).toBeUndefined();
  });

  it("un total impreso de 0 es válido; sin periodo coherente se omite", () => {
    const d = sanitizeCardLines(raw({ printed_totals: { interest: 0, fees: null }, period_start: "2026-11-20", period_end: "2026-10-21" }), TODAY);
    expect(d.totals).toEqual({ interest: 0 });
    expect(d.periodStart).toBeUndefined();
  });

  it("respuesta vacía o rara no revienta", () => {
    expect(sanitizeCardLines({}, TODAY)).toEqual({ totals: {}, lines: [], dropped: 0 });
    expect(sanitizeCardLines({ lines: "nada", printed_totals: 5 }, TODAY).lines).toEqual([]);
  });

  it("topa a 400 movimientos y cuenta el resto como descartado", () => {
    const many = Array.from({ length: 450 }, (_, i) => ({ date: "2026-11-02", description: `C${i}`, amount: 1_000 + i, kind: "PURCHASE" }));
    const d = sanitizeCardLines(raw({ lines: many }), TODAY);
    expect(d.lines).toHaveLength(400);
    expect(d.dropped).toBe(50);
  });
});

describe("parsedFromCardLines", () => {
  const data = sanitizeCardLines(raw(), TODAY);
  const out = parsedFromCardLines(data);

  it("signos: compras y cobros salen (−), pagos entran (+)", () => {
    const by = Object.fromEntries(out.parsed.lines.map((l) => [l.description, l]));
    expect(by["EXITO CHAPINERO"].amount).toBe(-150_000);
    expect(by["PAGO PSE"].amount).toBe(300_000);
    expect(by["INTERESES CORRIENTES"]).toMatchObject({ amount: -45_000, kind: "INTEREST_OUT" });
    expect(by["CUOTA DE MANEJO"]).toMatchObject({ amount: -20_000, kind: "FEE" });
    expect(by["EXITO CHAPINERO"].kind).toBe("OTHER");
  });

  it("las cuotas de compras diferidas no entran al cruce y se informan aparte", () => {
    expect(out.parsed.lines.some((l) => l.description === "TV SAMSUNG")).toBe(false);
    expect(out.installmentLines).toHaveLength(1);
  });

  it("la cuota 1 de una compra diferida sí es la compra y se cruza", () => {
    const d = sanitizeCardLines(raw({ lines: [{ date: "2026-11-05", description: "TV", amount: 350_000, kind: "PURCHASE", installment_no: 1 }] }), TODAY);
    expect(parsedFromCardLines(d).parsed.lines).toHaveLength(1);
  });

  it("devoluciones de intereses son 'a favor'; reversión de un cobro no suma como cobro", () => {
    const d = sanitizeCardLines(raw({ lines: [
      { date: "2026-11-05", description: "AJUSTE INTERESES", amount: 3_000, kind: "INTEREST", is_credit: true },
      { date: "2026-11-05", description: "REVERSION CUOTA MANEJO", amount: 20_000, kind: "FEE", is_credit: true },
    ] }), TODAY);
    expect(parsedFromCardLines(d).parsed.lines.map((l) => l.kind).sort()).toEqual(["INTEREST_IN", "OTHER"]);
  });

  it("ids según la posición en el extracto (los intereses se agrupan por mes) y periodo declarado", () => {
    expect(out.parsed.lines.map((l) => l.id).sort()).toEqual(["G:INTEREST_OUT|2026-11", "P1", "P2", "P5"]);
    expect(out.parsed.period).toEqual({ start: "2026-10-21", end: "2026-11-20" });
  });

  it("sin periodo declarado usa el rango de fechas de los movimientos", () => {
    const d = sanitizeCardLines(raw({ period_start: null, period_end: null }), TODAY);
    expect(parsedFromCardLines(d).parsed.period).toEqual({ start: "2026-10-25", end: "2026-11-20" });
  });

  it("sin movimientos avisa", () => {
    const e = parsedFromCardLines(sanitizeCardLines({}, TODAY));
    expect(e.parsed.lines).toEqual([]);
    expect(e.parsed.warnings[0]).toMatch(/No encontré movimientos/);
    expect(e.parsed.period).toBeNull();
  });
});

describe("por qué no hay movimientos", () => {
  it("la lectura vino vacía: lo dice y sugiere revisar el archivo", () => {
    const w = parsedFromCardLines(sanitizeCardLines({ lines: [] }, TODAY)).parsed.warnings[0];
    expect(w).toMatch(/^No encontré movimientos en el extracto\./);
    expect(w).toMatch(/ninguna fila/);
  });
  it("filas sin fecha o valor legible: dice cuántas", () => {
    const d = sanitizeCardLines({ lines: [{ date: "2019-01-05", description: "X", amount: 5000, kind: "PURCHASE" }, { date: "2026-11-05", description: "Y", amount: 0, kind: "PURCHASE" }] }, TODAY);
    const w = parsedFromCardLines(d).parsed.warnings[0];
    expect(w).toMatch(/Leí 2 filas pero sin una fecha o un valor/);
  });
  it("todo eran cuotas de compras diferidas: no es un error de lectura", () => {
    const d = sanitizeCardLines({ lines: [{ date: "2026-11-05", description: "TV", amount: 100_000, kind: "PURCHASE", installment_no: 3 }] }, TODAY);
    const out = parsedFromCardLines(d);
    expect(out.parsed.lines).toEqual([]);
    expect(out.parsed.warnings[0]).toMatch(/son cuotas de compras diferidas/);
  });
});

describe("leer con el siguiente modelo si la lista viene vacía", () => {
  const withLines = sanitizeCardLines(raw(), TODAY);
  const empty = sanitizeCardLines({ lines: [] }, TODAY);
  const run = (reads: Record<string, CardLinesData | Error>, models = Object.keys(reads), budget = 57_000, clock?: () => number) => {
    const asked: string[] = [];
    const p = firstReadWithLines(models, async (m) => {
      asked.push(m);
      const r = reads[m];
      if (r instanceof Error) throw r;
      return r;
    }, budget, 8_000, clock);
    return p.then((data) => ({ data, asked }));
  };

  it("el primero trae movimientos: no se pregunta más", async () => {
    const { data, asked } = await run({ a: withLines, b: withLines });
    expect(data.lines).toHaveLength(5);
    expect(asked).toEqual(["a"]);
  });
  it("el primero responde vacío: se prueba el siguiente y se queda con el que trae movimientos", async () => {
    const { data, asked } = await run({ a: empty, b: withLines, c: withLines });
    expect(data.lines).toHaveLength(5);
    expect(asked).toEqual(["a", "b"]);
  });
  it("uno falla (saturado) y el siguiente responde", async () => {
    const { data, asked } = await run({ a: new Error("saturado"), b: withLines });
    expect(data.lines).toHaveLength(5);
    expect(asked).toEqual(["a", "b"]);
  });
  it("todos vacíos: devuelve la lectura vacía (con su aviso), no un error", async () => {
    const { data } = await run({ a: empty, b: empty });
    expect(data.lines).toEqual([]);
  });
  it("uno vacío y los demás fallan: devuelve la lectura vacía", async () => {
    const { data } = await run({ a: empty, b: new Error("x") });
    expect(data.lines).toEqual([]);
  });
  it("todos fallan: relanza el último error", async () => {
    const err = await run({ a: new Error("uno"), b: new Error("dos") }).then(() => null, (e: Error) => e);
    expect(err?.message).toBe("dos");
  });
  it("sin tiempo suficiente no prueba otro modelo", async () => {
    let t = 0;
    const clock = () => (t += 30_000); // cada consulta al reloj avanza 30 s
    const { asked } = await run({ a: empty, b: withLines }, ["a", "b"], 57_000, clock);
    expect(asked).toEqual(["a"]);
  });
});

describe("checkPrintedTotals", () => {
  const lines = sanitizeCardLines(raw(), TODAY).lines;
  it("cuadra con el resumen del extracto", () => {
    // compras 150.000 + 350.000 (cuota 3) = 500.000
    const c = checkPrintedTotals(lines, { purchases: 500_000, payments: 300_000, interest: 45_000, fees: 20_000 });
    expect(c.map((x) => x.ok)).toEqual([true, true, true, true]);
  });
  it("detecta un movimiento que la lectura se dejó", () => {
    const c = checkPrintedTotals(lines.filter((l) => l.description !== "EXITO CHAPINERO"), { purchases: 500_000 });
    expect(c).toEqual([{ key: "purchases", label: "Compras y cargos", read: 350_000, printed: 500_000, ok: false }]);
  });
  it("tolera redondeos de hasta $1.000 y solo compara lo que el extracto imprime", () => {
    const c = checkPrintedTotals(lines, { payments: 300_000 + TOTALS_TOLERANCE });
    expect(c).toHaveLength(1);
    expect(c[0].ok).toBe(true);
    expect(checkPrintedTotals(lines, { payments: 300_000 + TOTALS_TOLERANCE + 1 })[0].ok).toBe(false);
    expect(checkPrintedTotals(lines, {})).toEqual([]);
  });
});

describe("cruce con la app usando los movimientos del PDF", () => {
  const data = sanitizeCardLines(raw(), TODAY);
  const { parsed } = parsedFromCardLines(data);
  const range = coveredRange(cycleRange(20, "2026-11"), parsed.lines, parsed.period);

  it("lo que está en ambos cuadra; lo que falta y lo que sobra se reporta", () => {
    const txs = [tx("exito", 150_000, "2026-10-25"), tx("pago", 300_000, "2026-11-02", "INCOME"), tx("solo-app", 77_000, "2026-11-10")];
    const rec = reconcileStatement(card, txs, parsed.lines, range);
    expect(rec.matched.map((m) => m.line.description).sort()).toEqual(["EXITO CHAPINERO", "PAGO PSE"]);
    expect(rec.missing.map((l) => l.description).sort()).toEqual(["CUOTA DE MANEJO", "INTERESES CORRIENTES"]);
    expect(rec.extra.map((e) => e.tx.id)).toEqual(["solo-app"]);
  });

  it("la cuota de la compra diferida no se reporta como faltante", () => {
    const rec = reconcileStatement(card, [tx("exito", 150_000, "2026-10-25")], parsed.lines, range);
    expect(rec.missing.some((l) => l.description === "TV SAMSUNG")).toBe(false);
  });
});

