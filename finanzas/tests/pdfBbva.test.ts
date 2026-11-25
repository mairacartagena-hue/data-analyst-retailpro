import { describe, it, expect } from "vitest";
import { groupRows, isMoney, parseDate, parseMoney, type PdfTextItem } from "@/lib/capture/pdf/rows";
import { parseBbvaCardStatement, previousCutoff } from "@/lib/capture/pdf/bbvaCard";
import { readLocalCardStatement } from "@/lib/capture/cardStatementLocal";
import { sanitizeCardLines, sanitizeCardStatement } from "@/lib/capture/cardStatement";
import { parsedFromCardLines } from "@/lib/finance/cardLines";

// Extracto sintético con la misma disposición del de BBVA (posiciones en puntos como las entrega pdf.js: x a la izquierda,
// y hacia arriba, y las columnas de valores alineadas por su borde derecho). Nombres, tarjetas y valores son inventados.
const TODAY = "2026-10-25";
const left = (page: number, y: number, x: number, text: string): PdfTextItem => ({ page, y, x, w: text.length * 3, text });
const right = (page: number, y: number, edge: number, text: string): PdfTextItem => { const w = text.length * 3.2; return { page, y, x: edge - w, w, text }; };

interface Mov { date: string; desc: string | string[]; rate?: string; cuota?: string; orig?: string; atCut?: string; charge?: string; deferred?: string; credit?: boolean }

function mov(page: number, y: number, m: Mov): PdfTextItem[] {
  const out = [left(page, y, 34, m.date), left(page, y, 91, "000000")];
  (Array.isArray(m.desc) ? m.desc : [m.desc]).forEach((d, i) => out.push(left(page, y, 137 + i * 50, d)));
  if (m.rate) out.push(right(page, y, 293, m.rate));
  if (m.cuota) out.push(left(page, y, 332, m.cuota));
  if (m.credit) out.push(left(page, y, 380, "-"), left(page, y, 382, " "));
  if (m.orig) out.push(right(page, y, 417, m.orig));
  if (m.atCut) out.push(right(page, y, 472, m.atCut));
  if (m.charge) out.push(right(page, y, 523, m.charge));
  if (m.deferred) out.push(right(page, y, 580, m.deferred));
  return out;
}

/** Nota con el valor en la moneda original, debajo de una compra en el exterior. */
function note(page: number, y: number, desc: string, value: string): PdfTextItem[] {
  return [left(page, y, 34, "15082026"), left(page, y, 91, "000000"), left(page, y, 137, desc), left(page, y, 200, "MXN"), left(page, y, 278, "*****"), left(page, y, 338, "*****"), right(page, y, 417, value), left(page, y, 458, "*****"), left(page, y, 508, "*****"), left(page, y, 565, "*****")];
}

const cardRow = (page: number, y: number, last4: string) => [left(page, y, 97, "******"), left(page, y, 140, `TARJETA 000000******${last4}`), left(page, y, 278, "*****")];
const section = (page: number, y: number, name: string) => [left(page, y, 140, name)];

interface Opts { previous?: string; purchases?: string; interest?: string; payments?: string; total?: string; payTotal?: string; extraRows?: PdfTextItem[] }

function statement(o: Opts = {}): PdfTextItem[] {
  const f = (y: number, v: string) => right(1, y, 215, v);
  const g = (y: number, v: string) => right(1, y, 380, v);
  const header: PdfTextItem[] = [
    left(1, 760, 40, "NOMBRE INVENTADO DE PRUEBA"), left(1, 640, 430, "000000******1111"), left(1, 560, 541, "847"),
    f(579, "5,000,000.00"), f(568, "3,000,000.00"), f(547, "3,000,000.00"), f(506, "20-10-2026"), f(494, "04-11-2026"), f(483, o.payTotal ?? o.total ?? "1,397,000.00"), f(471, "150,000.00"),
    g(565, o.previous ?? "1,000,000.00"), g(555, o.purchases ?? "705,000.00"), g(544, o.interest ?? "12,000.00"), g(533, "00.00"), g(523, o.payments ?? "320,000.00"), g(512, o.total ?? "1,397,000.00"),
    g(489, "00.00"), g(478, "28.50% E.A."), g(463, "28.40% E.A."),
  ];
  const page1: PdfTextItem[] = [
    ...cardRow(1, 396, "1111"), ...section(1, 389, "MOVIMIENTOS ANTERIORES"),
    ...mov(1, 382, { date: "15082026", desc: "COMPRA ANTERIOR", rate: "29.63", cuota: "02 DE 12", orig: "120,000.00", atCut: "100,000.00", charge: "10,000.00", deferred: "90,000.00" }),
    ...note(1, 375, "COMPRA ANTERIOR", "600.00"),
    ...section(1, 368, "MOVIMIENTOS DE ESTE MES"),
    ...mov(1, 361, { date: "01102026", desc: "TIENDA UNO", rate: "28.40", cuota: "01 DE 01", orig: "100,000.00", atCut: "100,000.00", charge: "100,000.00", deferred: "00.00" }),
    ...mov(1, 354, { date: "03102026", desc: "DEVOLUCION TIENDA", rate: "28.40", orig: "20,000.00", credit: true }),
  ];
  const page2: PdfTextItem[] = [
    left(2, 747, 52, "NOMBRE INVENTADO DE PRUEBA"),
    ...cardRow(2, 615, "2222"), ...section(2, 608, "MOVIMIENTOS DE ESTE MES"),
    ...mov(2, 601, { date: "05102026", desc: "COMPRA DIFERIDA NUEVA", rate: "28.40", cuota: "00 DE 12", orig: "600,000.00", atCut: "600,000.00", charge: "00.00", deferred: "600,000.00" }),
    ...mov(2, 594, { date: "06102026", desc: "Cobro Prima: Seguro de Vida", rate: ".00", cuota: "01 DE 01", orig: "5,000.00", atCut: "5,000.00", charge: "5,000.00", deferred: "00.00" }),
    // el número del pago viene en otro trozo de texto de la misma fila
    ...mov(2, 587, { date: "10102026", desc: ["PAGO X PSE.", "123456"], orig: "300,000.00", credit: true }),
    ...(o.extraRows ?? []),
  ];
  return [...header, ...page1, ...page2];
}

describe("lectura local del PDF: filas y utilidades", () => {
  it("junta en una fila lo que está a la misma altura y separa las páginas", () => {
    const items: PdfTextItem[] = [
      { page: 1, x: 100, y: 500.4, w: 10, text: "B" }, { page: 1, x: 10, y: 500, w: 10, text: "A" }, { page: 1, x: 50, y: 492.9, w: 10, text: "C" },
      { page: 2, x: 5, y: 700, w: 10, text: "D" }, { page: 1, x: 70, y: 500, w: 3, text: " " },
    ];
    const rows = groupRows(items);
    expect(rows.map((r) => r.items.map((i) => i.text).join(""))).toEqual(["AB", "C", "D"]);
    expect(rows.map((r) => r.page)).toEqual([1, 1, 2]);
  });

  it("valores y fechas: lo que no es un valor o una fecha posible se descarta", () => {
    expect(parseMoney("1,814,051.26")).toBe(1814051.26);
    expect(parseMoney("- 39,870.00")).toBe(39870);
    expect(parseMoney("00.00")).toBe(0);
    expect(parseMoney("28.34% E.A.")).toBeNull();
    expect(parseMoney("123")).toBeNull();
    expect(isMoney("***** ")).toBe(false);
    expect(parseDate("23082026")).toBe("2026-08-23");
    expect(parseDate("20-11-2026")).toBe("2026-11-20");
    expect(parseDate("31112026")).toBeNull();
    expect(parseDate("00112026")).toBeNull();
    expect(parseDate("12345678")).toBeNull();
  });

  it("el corte anterior es el mismo día del mes anterior (o el último día si ese mes es más corto)", () => {
    expect(previousCutoff("2026-11-20")).toBe("2026-10-20");
    expect(previousCutoff("2026-01-15")).toBe("2025-12-15");
    expect(previousCutoff("2026-03-31")).toBe("2026-02-28");
    expect(previousCutoff("2024-03-31")).toBe("2024-02-29");
  });
});

describe("extracto BBVA: lectura local", () => {
  const read = parseBbvaCardStatement(statement());

  it("el resumen: fechas, pago total y mínimo, cupo, tasa y tarjeta", () => {
    expect(read).not.toBeNull();
    const s = sanitizeCardStatement((read as NonNullable<typeof read>).statement, TODAY);
    expect(s).toMatchObject({ institution: "BBVA", last4: "1111", statementDate: "2026-10-20", dueDate: "2026-11-04", totalDebt: 1_397_000, totalPayment: 1_397_000, minimumPayment: 150_000, creditLimit: 5_000_000, rateEa: 28.4 });
    expect(read?.cards).toEqual(["1111", "2222"]);
  });

  it("compras diferidas: la de antes y la nueva del mes; no las de una cuota ni los seguros", () => {
    const s = sanitizeCardStatement((read as NonNullable<typeof read>).statement, TODAY);
    expect(s.purchases.map((p) => p.description)).toEqual(["COMPRA ANTERIOR", "COMPRA DIFERIDA NUEVA"]);
    expect(s.purchases[0]).toEqual({ description: "COMPRA ANTERIOR", purchaseDate: "2026-08-15", amount: 120_000, installments: 12, paidInstallments: 2, remainingBalance: 90_000, monthlyCharge: 10_000, balanceAtCut: 100_000, rateEa: 29.63 });
    // La compra nueva todavía no factura cuota: cuota 0, sin cargo del mes, todo el saldo pendiente
    expect(s.purchases[1]).toMatchObject({ amount: 600_000, installments: 12, paidInstallments: 0, remainingBalance: 600_000, balanceAtCut: 600_000, rateEa: 28.4 });
    expect(s.purchases[1].monthlyCharge).toBeUndefined();
  });

  it("movimientos: tipo, abonos, número de cuota y totales impresos; las notas en moneda original no cuentan", () => {
    const data = sanitizeCardLines((read as NonNullable<typeof read>).lines, TODAY);
    expect(read?.stats).toEqual({ movements: 6, currencyNotes: 1, unreadable: 0 });
    expect(data).toMatchObject({ institution: "BBVA", last4: "1111", periodStart: "2026-09-21", periodEnd: "2026-10-20", totals: { purchases: 705_000, payments: 320_000, interest: 12_000, fees: 0 }, dropped: 0 });
    const by = (d: string) => data.lines.find((l) => l.description.startsWith(d));
    expect(by("COMPRA ANTERIOR")).toMatchObject({ date: "2026-08-15", amount: 120_000, kind: "PURCHASE", credit: false, installmentNo: 2 });
    expect(by("TIENDA UNO")).toMatchObject({ kind: "PURCHASE", credit: false, installmentNo: 1 });
    expect(by("COMPRA DIFERIDA")?.installmentNo).toBeUndefined();
    expect(by("Cobro Prima")).toMatchObject({ kind: "FEE", credit: false, amount: 5_000 });
    expect(by("DEVOLUCION")).toMatchObject({ kind: "OTHER", credit: true, amount: 20_000 });
    expect(by("PAGO X PSE")).toMatchObject({ description: "PAGO X PSE. 123456", kind: "PAYMENT", credit: true, amount: 300_000 });
  });

  it("lo leído cuadra con los totales del propio extracto", () => {
    const data = sanitizeCardLines((read as NonNullable<typeof read>).lines, TODAY);
    const checks = parsedFromCardLines(data).totals;
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.ok)).toBe(true);
    const local = readLocalCardStatement(statement(), TODAY);
    expect(local?.bank).toBe("BBVA");
    expect(local?.statement.totalDebt).toBe(1_397_000);
    expect(local?.lines.lines).toHaveLength(6);
  });

  it("una fila con fecha pero sin valor se cuenta aparte y no se inventa", () => {
    const sinValor = [left(2, 570, 34, "11102026"), left(2, 570, 91, "000000"), left(2, 570, 137, "COMERCIO SIN VALOR")];
    const r = parseBbvaCardStatement(statement({ extraRows: sinValor }));
    expect(r?.stats.unreadable).toBe(1);
    expect(r?.stats.movements).toBe(6);
  });
});

describe("extracto BBVA: cuando no se debe confiar en la lectura local (queda a Gemini)", () => {
  it("si la cuenta del resumen no cuadra, no se lee", () => {
    expect(parseBbvaCardStatement(statement({ total: "1,500,000.00" }))).toBeNull();
    expect(parseBbvaCardStatement(statement({ payTotal: "1,000,000.00" }))).toBeNull();
  });

  it("si el PDF no tiene la forma del extracto de BBVA, no se lee", () => {
    expect(parseBbvaCardStatement([])).toBeNull();
    expect(parseBbvaCardStatement(statement().filter((i) => !i.text.startsWith("TARJETA")))).toBeNull();
    expect(parseBbvaCardStatement(statement().filter((i) => !(i.page === 1 && i.text === "04-11-2026")))).toBeNull();
    expect(parseBbvaCardStatement(statement().filter((i) => !i.text.endsWith("% E.A.")))).toBeNull();
  });

  it("si los movimientos no suman lo que imprime el resumen, no se entrega (aunque el resumen cuadre solo)", () => {
    // Facturación 800.000 con saldo total coherente, pero los movimientos leídos suman 705.000: algo se saltó
    const o = { purchases: "800,000.00", total: "1,492,000.00" };
    expect(parseBbvaCardStatement(statement(o))).not.toBeNull();
    expect(readLocalCardStatement(statement(o), TODAY)).toBeNull();
  });

  it("si falta un movimiento de pago, el total de pagos lo delata", () => {
    const sinPago = statement().filter((i) => i.y !== 587);
    expect(readLocalCardStatement(sinPago, TODAY)).toBeNull();
  });
});
