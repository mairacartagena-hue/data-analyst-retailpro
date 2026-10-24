import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "@/lib/types";
import { monthRange } from "@/lib/finance/reconcile";
import {
  bankCharges, classifyLine, closingBalance, parseDate, parseSignedAmount, parseStatement, reconcileStatement, splitCsv, type StatementLine,
} from "@/lib/finance/statement";

// Formatos de ejemplo escritos para estas pruebas (no son un extracto real de ningún banco).
const SEMICOLON = `Extracto de cuenta de ahorros;;;;
Cuenta: 123-456789;;;;
FECHA;DESCRIPCIÓN;SUCURSAL;VALOR;SALDO
01/10/2026;COMPRA EN TIENDA D1;CALI;-45.000,00;955.000,00
02/10/2026;PAGO PSE DAVIVIENDA;VIRTUAL;-1.043.000,00;-88.000,00
03/10/2026;ABONO INTERESES AHORROS;;1.250,50;-86.749,00
05/10/2026;IMPTO GOBIERNO 4X1000;;-4.172,00;-90.921,00
30/10/2026;CUOTA DE MANEJO;;-18.900,00;-109.821,00
`;

const QUOTED_DEBIT_CREDIT = `"FECHA","DETALLE","DÉBITOS","CRÉDITOS","SALDO"
"2026-10-01","TRANSFERENCIA A CUENTA 6876","950,000.00","","1,050,000.00"
"2026-10-04","PAGO DE NOMINA DELOITTE","","11,986,615.00","13,036,615.00"
"2026-10-31","INTERESES DE MORA","1,500.00","","13,035,115.00"
`;

const NO_HEADER_TAB = `2026-10-02\tCOMPRA NETFLIX\t-18900\t500000
2026-10-03\tCOMPRA CLAUDE\t-63490\t436510
2026-10-09\tRETIRO CAJERO\t-100000\t336510
`;

const CARD = `Fecha,Descripción,Valor
05/10/2026,AGRO LA HACIENDA,33900
07/10/2026,PAGO TARJETA,-500000
20/10/2026,INTERESES CORRIENTES,12000
`;

const account = (kind = "DEPOSIT", gmf = "TAXED"): Account => ({ id: "acc1", kind, gmf_mode: gmf } as unknown as Account);
let n = 0;
const tx = (amount: number, date: string, kind = "EXPENSE", extra: Partial<Transaction> = {}): Transaction =>
  ({ id: `t${++n}`, kind, amount, occurred_on: date, account_id: "acc1", to_account_id: null, status: "CONFIRMED", tags: [], ...extra } as unknown as Transaction);
const line = (id: string, date: string, amount: number, description = "X"): StatementLine => ({ id, date, amount, description, balance: null, kind: classifyLine(description, amount) });
const OCT = monthRange("2026-10");

describe("lectura del CSV", () => {
  it("monto con signo en formatos colombianos y gringos", () => {
    expect(parseSignedAmount("-45.000,00")).toBe(-45000);
    expect(parseSignedAmount("1,234.56")).toBe(1235);
    expect(parseSignedAmount("(1.234)")).toBe(-1234);
    expect(parseSignedAmount("1.234-")).toBe(-1234);
    expect(parseSignedAmount("$ 50.000")).toBe(50000);
    expect(parseSignedAmount("0,00")).toBe(0);
    expect(parseSignedAmount("abc")).toBeNull();
    expect(parseSignedAmount("")).toBeNull();
  });

  it("fechas: día/mes/año, ISO, con mes en letras y sin separadores", () => {
    expect(parseDate("05/10/2026")).toBe("2026-10-05");
    expect(parseDate("5-10-26")).toBe("2026-10-05");
    expect(parseDate("2026-10-05 14:30:00")).toBe("2026-10-05");
    expect(parseDate("20261005")).toBe("2026-10-05");
    expect(parseDate("05 oct 2026")).toBe("2026-10-05");
    expect(parseDate("05-Ene-2026")).toBe("2026-01-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("texto")).toBeNull();
  });

  it("CSV con comillas, comas dentro de un campo y saltos de línea Windows", () => {
    expect(splitCsv('a,"b, c",d\r\n1,2,3\r\n')).toEqual([["a", "b, c", "d"], ["1", "2", "3"]]);
  });

  it("punto y coma, con filas de título antes del encabezado y saldo", () => {
    const r = parseStatement(SEMICOLON);
    expect(r.lines).toHaveLength(5);
    expect(r.lines.map((l) => l.amount)).toEqual([-45000, -1043000, 1251, -4172, -18900]);
    expect(r.lines[0]).toMatchObject({ date: "2026-10-01", description: "COMPRA EN TIENDA D1", balance: 955000 });
    expect(r.lines.map((l) => l.kind)).toEqual(["OTHER", "OTHER", "INTEREST_IN", "GMF", "FEE"]);
    expect(closingBalance(r.lines)).toBe(-109821);
    expect(r.warnings).toEqual([]);
  });

  it("comas, comillas y columnas separadas de débitos y créditos", () => {
    const r = parseStatement(QUOTED_DEBIT_CREDIT);
    expect(r.lines.map((l) => l.amount)).toEqual([-950000, 11986615, -1500]);
    expect(r.lines[2].kind).toBe("INTEREST_OUT");
    expect(closingBalance(r.lines)).toBe(13035115);
  });

  it("sin encabezado y separado por tabulaciones: deduce las columnas", () => {
    const r = parseStatement(NO_HEADER_TAB);
    expect(r.lines.map((l) => [l.date, l.amount])).toEqual([["2026-10-02", -18900], ["2026-10-03", -63490], ["2026-10-09", -100000]]);
    expect(r.lines[0].description).toBe("COMPRA NETFLIX");
  });

  it("extracto en orden descendente: el saldo final es el de la fila más reciente", () => {
    const r = parseStatement(`Fecha;Descripcion;Valor;Saldo\n10/10/2026;B;-10;90\n09/10/2026;A;-10;100\n`);
    expect(closingBalance(r.lines)).toBe(90);
  });

  it("tarjeta de crédito: las compras positivas quedan como salidas", () => {
    const r = parseStatement(CARD, { isCard: true });
    expect(r.lines.map((l) => l.amount)).toEqual([-33900, 500000, -12000]);
    expect(r.lines[2].kind).toBe("INTEREST_OUT");
    // si el banco las muestra al revés, se puede invertir
    expect(parseStatement(CARD, { isCard: true, flip: true }).lines.map((l) => l.amount)).toEqual([33900, -500000, 12000]);
  });

  it("fecha mes/día/año si algún segundo número pasa de 12", () => {
    const r = parseStatement(`Fecha,Descripción,Valor\n10/25/2026,A,-5000\n10/26/2026,B,-6000\n`);
    expect(r.lines.map((l) => l.date)).toEqual(["2026-10-25", "2026-10-26"]);
  });

  it("archivo que no es un extracto: avisa en vez de inventar", () => {
    expect(parseStatement("hola\nesto no es un extracto").warnings.length).toBeGreaterThan(0);
    expect(parseStatement("").lines).toEqual([]);
  });

  it("columnas elegidas a mano reemplazan a las detectadas", () => {
    const r = parseStatement(`A;B;C\n01/10/2026;-5.000;detalle\n`, { map: { date: 0, amount: 1, description: 2 } });
    expect(r.lines[0]).toMatchObject({ amount: -5000, description: "detalle" });
  });
});

describe("clasificación", () => {
  it.each([
    ["IMPTO GOBIERNO 4X1000", -4000, "GMF"],
    ["GRAVAMEN MOVIMIENTOS FINANCIEROS", -4000, "GMF"],
    ["Cobro 4 x 1000", -800, "GMF"],
    ["ABONO INTERESES AHORROS", 1200, "INTEREST_IN"],
    ["RENDIMIENTOS FINANCIEROS", 900, "INTEREST_IN"],
    ["INTERESES CORRIENTES", -12000, "INTEREST_OUT"],
    ["RETENCION EN LA FUENTE INTERESES", -190, "FEE"],
    ["CUOTA DE MANEJO TARJETA", -18900, "FEE"],
    ["COMISION TRANSFERENCIA ACH", -6000, "FEE"],
    ["IVA CUOTA DE MANEJO", -3600, "FEE"],
    ["COMPRA EN TIENDA D1", -45000, "OTHER"],
    ["SEGUROS BOLIVAR POLIZA CARRO", -90000, "OTHER"],
  ])("%s → %s", (d, amount, kind) => expect(classifyLine(d, amount as number)).toBe(kind));
});

describe("conciliación con la app", () => {
  it("empareja por monto y fecha (con 1-3 días de diferencia) y detecta lo que falta", () => {
    const lines = [line("a", "2026-10-01", -45000, "TIENDA D1"), line("b", "2026-10-06", -80000, "SUPERMERCADO"), line("c", "2026-10-09", -3000, "EXTRA")];
    const txs = [tx(45000, "2026-10-01"), tx(80000, "2026-10-04")];
    const r = reconcileStatement(account(), txs, lines, OCT);
    expect(r.matched.map((m) => m.line.id)).toEqual(["a", "b"]);
    expect(r.missing.map((l) => l.id)).toEqual(["c"]);
    expect(r.extra).toEqual([]);
  });

  it("una compra no empareja con un ingreso del mismo monto", () => {
    const r = reconcileStatement(account(), [tx(50000, "2026-10-05", "INCOME")], [line("a", "2026-10-05", -50000)], OCT);
    expect(r.matched).toHaveLength(0);
    expect(r.missing).toHaveLength(1);
    expect(r.extra).toHaveLength(1);
  });

  it("detecta el movimiento duplicado en la app (2 en la app, 1 en el extracto)", () => {
    const a = tx(33900, "2026-10-24");
    const b = tx(33900, "2026-10-24", "EXPENSE", { status: "PENDING_REVIEW" });
    const r = reconcileStatement(account(), [a, b], [line("a", "2026-10-24", -33900, "AGRO LA HACIENDA")], OCT);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].entry.tx.id).toBe(a.id); // se queda con el confirmado
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].entry.tx.id).toBe(b.id);
    expect(r.duplicates[0].twin.tx.id).toBe(a.id);
  });

  it("dos compras iguales de verdad (2 en la app, 2 en el extracto) no son duplicado", () => {
    const r = reconcileStatement(account(), [tx(6000, "2026-10-05"), tx(6000, "2026-10-05")], [line("a", "2026-10-05", -6000), line("b", "2026-10-05", -6000)], OCT);
    expect(r.matched).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });

  it("una línea no le roba la pareja a otra: primero las de la misma fecha", () => {
    const x = tx(10000, "2026-10-10");
    const y = tx(10000, "2026-10-12");
    const r = reconcileStatement(account(), [x, y], [line("late", "2026-10-11", -10000), line("exact", "2026-10-10", -10000)], OCT);
    expect(r.matched.find((m) => m.line.id === "exact")?.entry.tx.id).toBe(x.id);
    expect(r.matched.find((m) => m.line.id === "late")?.entry.tx.id).toBe(y.id);
  });

  it("las transferencias entre mis cuentas cuentan en las dos cuentas", () => {
    const t = tx(200000, "2026-10-07", "TRANSFER", { account_id: "otra", to_account_id: "acc1" });
    const r = reconcileStatement(account(), [t], [line("a", "2026-10-07", 200000, "ABONO")], OCT);
    expect(r.matched).toHaveLength(1);
  });

  it("ignora lo que cae fuera del mes y lo cuenta aparte", () => {
    const r = reconcileStatement(account(), [], [line("a", "2026-09-30", -5000), line("b", "2026-10-02", -5000)], OCT);
    expect(r.outOfRange).toBe(1);
    expect(r.missing.map((l) => l.id)).toEqual(["b"]);
  });

  it("lo que está en la app pero no en el extracto queda como 'extra'", () => {
    const r = reconcileStatement(account(), [tx(7000, "2026-10-15")], [], OCT);
    expect(r.extra).toHaveLength(1);
    expect(r.duplicates).toHaveLength(0);
  });
});

describe("4x1000, intereses y gastos bancarios", () => {
  it("compara el 4x1000 cobrado con el estimado", () => {
    // Salen $1.000.000 → 0,4 % = $4.000
    const lines = [line("a", "2026-10-02", -1_000_000, "PAGO"), line("g", "2026-10-02", -4000, "IMPTO GOBIERNO 4X1000")];
    const c = bankCharges(account(), lines, 52_374);
    expect(c.gmf).toMatchObject({ charged: 4000, expected: 4000, diff: 0, ok: true, applies: true });
  });

  it("avisa si el banco cobró de más o de menos", () => {
    const more = bankCharges(account(), [line("a", "2026-10-02", -1_000_000), line("g", "2026-10-02", -9000, "4X1000")], 52_374);
    expect(more.gmf.ok).toBe(false);
    expect(more.gmf.diff).toBe(5000);
    const none = bankCharges(account(), [line("a", "2026-10-02", -1_000_000)], 52_374);
    expect(none.gmf).toMatchObject({ charged: 0, expected: 4000, ok: false });
  });

  it("cuenta exenta: lo que sale por debajo del tope (350 UVT) no paga", () => {
    const exempt = bankCharges(account("DEPOSIT", "EXEMPT_350"), [line("a", "2026-10-02", -5_000_000)], 52_374);
    expect(exempt.gmf.expected).toBe(0); // 5.000.000 < 350 × 52.374
    expect(exempt.gmf.ok).toBe(true);
    const charged = bankCharges(account("DEPOSIT", "EXEMPT_350"), [line("a", "2026-10-02", -5_000_000), line("g", "2026-10-02", -20000, "GMF")], 52_374);
    expect(charged.gmf.ok).toBe(false); // cobró siendo exenta
  });

  it("tarjetas de crédito no pagan 4x1000", () => {
    expect(bankCharges(account("CREDIT_CARD"), [line("a", "2026-10-02", -1_000_000)], 52_374).gmf).toMatchObject({ applies: false, expected: 0 });
  });

  it("suma intereses ganados, intereses cobrados y cuotas", () => {
    const c = bankCharges(account(), [
      line("1", "2026-10-03", 1251, "ABONO INTERESES AHORROS"),
      line("2", "2026-10-31", -1500, "INTERESES DE MORA"),
      line("3", "2026-10-30", -18900, "CUOTA DE MANEJO"),
      line("4", "2026-10-30", -3591, "IVA CUOTA DE MANEJO"),
    ], 52_374);
    expect(c.interestIn.total).toBe(1251);
    expect(c.interestOut.total).toBe(1500);
    expect(c.fees.total).toBe(22491);
  });
});
