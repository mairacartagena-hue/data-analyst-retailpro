import { describe, it, expect } from "vitest";
import type { PdfTextItem } from "@/lib/capture/pdf/rows";
import { parseAddiCreditStatement, parseCop, parseLongDate } from "@/lib/capture/pdf/addiCredit";
import { readLocalCreditStatement } from "@/lib/capture/creditStatementLocal";
import { readLocalCardStatement } from "@/lib/capture/cardStatementLocal";
import type { CardChargeLine } from "@/lib/capture/cardStatement";
import { checkMonthlyCharges } from "@/lib/finance/cardStatements";
import { parsedFromCardLines } from "@/lib/finance/cardLines";
import type { Account, CardStatementItem, Transaction } from "@/lib/types";

// Extracto sintético con la misma disposición del de Addi (posiciones en puntos como las entrega pdf.js: x a la izquierda,
// y hacia arriba). Nombres, comercios, IDs y valores son inventados.
const at = (page: number, y: number, x: number, text: string): PdfTextItem => ({ page, y, x, w: text.length * 3, text });

interface Row { mon: string; year: string; name: string[]; id: string; cap: string; int: string; rate: string; fianza: string; min: string }

function row(y: number, r: Row): PdfTextItem[] {
  const out = [at(2, y + 0.7, 24.8, r.mon), at(2, y - 6.2, 24.8, r.year)];
  r.name.forEach((n, i) => out.push(at(2, y - i * 7.8, 60.3, n)));
  out.push(at(2, y - r.name.length * 7.5, 60.3, r.id));
  out.push(at(2, y, 121.4, r.cap), at(2, y, 178.7, r.int), at(2, y - 7.1, 178.7, r.rate), at(2, y, 232.2, r.fianza));
  out.push(at(2, y, 285.7, "$ 0,00"), at(2, y, 331.7, "$ 0,00"), at(2, y, 379.2, r.min));
  return out;
}

interface Opts { minimum?: string; capital?: string; rows?: Row[] }

const ROWS: Row[] = [
  { mon: "Oct. 5", year: "2026", name: ["Tienda Inventada"], id: "a1b2c3", cap: "$ 50.000,00", int: "$ 0,00", rate: "0,00 % E.A.", fianza: "$ 0,00", min: "$ 50.000,00" },
  // fila con intereses y fianza: el pago mínimo impreso difiere unos centavos de la suma, como en los extractos reales
  { mon: "Ene. 20", year: "2026", name: ["Almacén de", "Prueba SAS"], id: "d4e5f6", cap: "$ 80.000,00", int: "$ 30.000,00", rate: "30,00 % E.A.", fianza: "$ 10.000,00", min: "$ 120.000,50" },
];

function statement(o: Opts = {}): PdfTextItem[] {
  return [
    at(1, 717.6, 332.9, "10 de octubre de 2026"),
    at(1, 652.8, 24, "Extracto de Octubre"),
    at(1, 548.5, 24.8, "18 de sep. de 2026 - 17 de oct. de 2026"),
    at(1, 464.6, 24.8, "Fecha límite de pago"), at(1, 448.1, 24.8, "17 de oct. de"), at(1, 435.6, 24.8, "2026"),
    at(1, 464.8, 144.8, "Tu pago mínimo"), at(1, 448.4, 144.8, o.minimum ?? "$ 170.000,50"),
    at(1, 464.6, 241.5, "Tu pago total al 10 de octubre"), at(1, 448.1, 241.5, "$ 1.500.000,00"),
    at(1, 375.6, 30.8, "Resumen de tu pago mínimo"),
    at(1, 351.4, 45, "Intereses corrientes"), at(1, 351.3, 172.9, "$ 30.000,00"),
    at(1, 336.4, 45, "Capital de tus compras"), at(1, 336.3, 168.8, o.capital ?? "$ 130.000,00"),
    at(1, 321.2, 45, "Servicio de fianza"), at(1, 323.7, 105.7, "1"), at(1, 321.3, 172.9, "$ 10.000,00"),
    at(2, 636, 24, "Detalle de tu pago mínimo"),
    at(2, 604.2, 24.8, "Fecha"), at(2, 604.2, 60.3, "Crédito"), at(2, 590.3, 60.3, "ID"), at(2, 604.2, 379.2, "Pago mínimo"),
    ...(o.rows ?? ROWS).flatMap((r, i) => row(566.7 - i * 32, r)),
    at(2, 407.3, 30.8, "Tu pago mínimo del mes"), at(2, 407.3, 384.5, o.minimum ?? "$ 170.000,50"),
    at(2, 102.2, 248.9, "soporte@addi.com"),
  ];
}

describe("lectura local del extracto de Addi", () => {
  it("valores y fechas en el formato de Addi", () => {
    expect(parseCop("$ 2.343.761,51")).toBe(2343761.51);
    expect(parseCop("$ 0,00")).toBe(0);
    expect(parseCop("$ 21.300")).toBe(21300);
    expect(parseCop("21,300.00")).toBeNull();
    expect(parseLongDate("15 de noviembre de 2026")).toBe("2026-11-15");
    expect(parseLongDate("22 de nov. de 2026")).toBe("2026-11-22");
    expect(parseLongDate("31 de sept. de 2026")).toBeNull();
  });

  it("lee fechas, pago mínimo, pago total y el detalle por compra", () => {
    const r = parseAddiCreditStatement(statement());
    expect(r?.purchases.map((p) => [p.date, p.merchant, p.id, p.minimum])).toEqual([
      ["2026-10-05", "Tienda Inventada", "a1b2c3", 50000],
      ["2026-01-20", "Almacén de Prueba SAS", "d4e5f6", 120000.5],
    ]);
    expect(readLocalCreditStatement(statement())).toEqual({
      institution: "Addi",
      statement: {
        institution: "Addi", statementDate: "2026-10-10", dueDate: "2026-10-17", rateEa: 30,
        installmentAmount: 160000, monthlyCosts: 10000, amountDue: 170000.5, payoffAmount: 1500000,
      },
    });
  });

  it("si el detalle no cuadra con el total o con el resumen, no lo lee (cae a Gemini)", () => {
    expect(parseAddiCreditStatement(statement({ minimum: "$ 171.000,00" }))).toBeNull();
    expect(parseAddiCreditStatement(statement({ capital: "$ 130.500,00" }))).toBeNull();
    const bad = ROWS.map((r, i) => (i === 0 ? { ...r, min: "$ 55.000,00" } : r));
    expect(parseAddiCreditStatement(statement({ rows: bad, minimum: "$ 175.000,50" }))).toBeNull();
  });

  it("con varias tasas distintas no adivina una sola", () => {
    const rows = [{ ...ROWS[0], int: "$ 1.000,00", rate: "25,00 % E.A.", min: "$ 51.000,00" }, ROWS[1]];
    const items = statement({ rows, minimum: "$ 171.000,50" }).map((it) => (it.text === "$ 30.000,00" && it.page === 1 ? { ...it, text: "$ 31.000,00" } : it));
    expect(readLocalCreditStatement(items)?.statement.rateEa).toBeUndefined();
  });

  it("un PDF que no es de Addi no se toca", () => {
    expect(parseAddiCreditStatement(statement().filter((it) => !it.text.includes("addi")))).toBeNull();
    expect(readLocalCreditStatement([at(1, 700, 40, "Banco Cualquiera"), at(1, 690, 40, "Saldo a capital")])).toBeNull();
  });
});

describe("el extracto de Addi en la revisión de tarjetas", () => {
  it("deuda (pago total), pago mínimo, fechas y el cobro del mes de cada compra", () => {
    const r = readLocalCardStatement(statement(), "2026-10-12");
    expect(r?.bank).toBe("Addi");
    expect(r?.statement).toMatchObject({
      institution: "Addi", statementDate: "2026-10-10", dueDate: "2026-10-17", totalDebt: 1500000, totalPayment: 1500000,
      minimumPayment: 170001, rateEa: 30, purchases: [],
      chargeLines: [
        { purchaseDate: "2026-10-05", description: "Tienda Inventada", capital: 50000, interest: 0, fees: 0 },
        { purchaseDate: "2026-01-20", description: "Almacén de Prueba SAS", capital: 80000, interest: 30000, fees: 10000, rateEa: 30 },
      ],
    });
  });

  it("movimientos: solo los cobros de Addi (intereses y fianza), con el período y cuadrando con el resumen", () => {
    const lines = readLocalCardStatement(statement(), "2026-10-12")?.lines;
    expect(lines).toMatchObject({
      periodStart: "2026-09-18", periodEnd: "2026-10-17", totals: { interest: 30000, fees: 10000 }, chargesOnly: true,
      lines: [
        { date: "2026-10-10", description: "Intereses corrientes (Addi)", amount: 30000, kind: "INTEREST", credit: false },
        { date: "2026-10-10", description: "Servicio de fianza (Addi)", amount: 10000, kind: "FEE", credit: false },
      ],
    });
    expect(parsedFromCardLines(lines!).totals.every((t) => t.ok)).toBe(true);
  });
});

describe("cobro del mes por compra contra la app (Addi)", () => {
  const addi: Account = {
    id: "addi", household_id: "h", owner_user_id: "u1", name: "Addi", kind: "CREDIT_CARD", institution: "Addi", last4: null,
    visibility: "PRIVATE", reveal_in_shared: false, opening_balance: 0, opening_at: "2026-09-01T05:00:00+00:00",
    credit_limit: null, statement_day: 10, due_day: 17, interest_rate_ea: 0, archived: false,
  } as Account;
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: "t1", kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-05", amount: 150_000, description: "Tienda Inventada", merchant: null,
    account_id: "addi", to_account_id: null, payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL",
    creates_debt: true, source: "MANUAL", tags: [], created_by: "u1", created_at: "2026-10-05T12:00:00Z", installments: 3, splits: [], ...over,
  } as Transaction);
  const line = (over: Partial<CardChargeLine> = {}): CardChargeLine => ({ purchaseDate: "2026-10-05", description: "Tienda Inventada", capital: 50_000, interest: 0, fees: 0, ...over });

  it("la compra de 3 cuotas sin intereses: la cuota 1 de $50.000 cuadra", () => {
    const [c] = checkMonthlyCharges(addi, [tx({})], [], [line()], "2026-10-10");
    expect(c).toMatchObject({ verdict: "OK", installment: 1, of: 3, appCharge: 50000, extractCharge: 50000 });
  });

  it("si la app tiene otro número de cuotas, la cuota no cuadra", () => {
    const [c] = checkMonthlyCharges(addi, [tx({ installments: 2 })], [], [line()], "2026-10-10");
    expect(c).toMatchObject({ verdict: "DIFFERS", appCharge: 75000 });
  });

  it("sin la compra en la app ni en el proyectado (otra fecha) queda como solo en el extracto", () => {
    const [c] = checkMonthlyCharges(addi, [tx({ occurred_on: "2026-09-20" })], [], [line()], "2026-10-10");
    expect(c.verdict).toBe("ONLY_EXTRACT");
  });

  // Addi real: la tarjeta se registró el 16-oct con las compras de antes en el proyectado, todas con la fecha del registro
  it("compras de antes de la app: se cruzan con el proyectado por comercio o por el valor de la cuota, no por la fecha", () => {
    const real: Account = { ...addi, statement_day: 15, due_day: 22, opening_balance: -1_885_015, opening_at: "2026-10-16T05:00:00+00:00" } as Account;
    const item = (over: Partial<CardStatementItem>): CardStatementItem => ({
      id: "x", account_id: "addi", description: "", purchase_date: "2026-10-15", amount: 0, installments: 3, paid_installments: 2, remaining_balance: 0, rate_ea: null, ...over,
    });
    const items = [
      item({ id: "sofa", description: "Sofá", amount: 2_530_000, installments: 24, paid_installments: 7, remaining_balance: 1_829_240, rate_ea: 33 }),
      item({ id: "linea", description: "Línea estética", amount: 103_425, remaining_balance: 34_475 }),
      item({ id: "feria", description: "Feria del brasier", amount: 63_900, remaining_balance: 21_300, rate_ea: 0 }),
    ];
    const lines: CardChargeLine[] = [
      { purchaseDate: "2026-08-19", description: "Feria del Brasier", capital: 21_300, interest: 0, fees: 0 },
      { purchaseDate: "2026-08-09", description: "Linea Estética", capital: 34_475, interest: 0, fees: 0 },
      { purchaseDate: "2026-01-29", description: "Muebles La Semana MS", capital: 95_091.25, interest: 43_992.37, fees: 13_759.01, rateEa: 33 },
    ];
    const checks = checkMonthlyCharges(real, [], items, lines, "2026-11-15");
    // El Sofá (Muebles La Semana, 33 %): los intereses cuadran ($43.992) pero la app amortiza el saldo en 17 cuotas y Addi cobra como si
    // quedaran 16 ($139.084 contra $132.364): se marca para corregir las cuotas pagadas o el plazo del proyectado
    expect(checks.map((c) => [c.line.description, c.item?.id, c.verdict, c.installment, c.of, c.appCharge])).toEqual([
      ["Muebles La Semana MS", "sofa", "DIFFERS", 8, 24, 132364],
      ["Feria del Brasier", "feria", "OK", 3, 3, 21300],
      ["Linea Estética", "linea", "OK", 3, 3, 34475],
    ]);
  });

  it("un valor del proyectado distinto al del extracto no se da por bueno, aunque el comercio coincida", () => {
    const real: Account = { ...addi, statement_day: 15, due_day: 22, opening_at: "2026-10-16T05:00:00+00:00" } as Account;
    const bad: CardStatementItem = { id: "linea", account_id: "addi", description: "Línea estética", purchase_date: "2026-10-15", amount: 90_000, installments: 3, paid_installments: 2, remaining_balance: 30_000, rate_ea: null };
    const [c] = checkMonthlyCharges(real, [], [bad], [{ purchaseDate: "2026-08-09", description: "Linea Estética", capital: 34_475, interest: 0, fees: 0 }], "2026-11-15");
    expect(c).toMatchObject({ verdict: "DIFFERS", appCharge: 30000, extractCharge: 34475 });
  });
});
