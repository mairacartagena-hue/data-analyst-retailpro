import { describe, expect, it } from "vitest";
import { addMonthsIso, cardDue, expandInstallments, installmentPlan, monthlyRate, projectCard, rateOf, splitEven, statementsDueIn, cutsBetween, statementItemsAfter, matchedWithItems } from "@/lib/finance/installments";
import type { CardStatementItem } from "@/lib/types";
import { spendingRows } from "@/lib/finance/spaces";
import type { Transaction } from "@/lib/types";

const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t1", kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-15", amount: 1_200_000, description: "Nevera", merchant: null,
  account_id: "visa", to_account_id: null, payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL",
  creates_debt: true, source: "MANUAL", tags: [], created_by: "u1", created_at: "2026-10-15T12:00:00Z", installments: 12,
  splits: [{ id: "s1", transaction_id: "t1", amount: 1_200_000, category_id: "hogar", responsible_user_id: "u1" } as Transaction["splits"][number]],
  ...over,
});

describe("fechas y reparto", () => {
  it("un mes después conserva el día o usa el último del mes", () => {
    expect(addMonthsIso("2026-10-15", 1)).toBe("2026-11-15");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
  });
  it("el sobrante de pesos va en la primera cuota", () => {
    expect(splitEven(100_000, 3)).toEqual([33_334, 33_333, 33_333]);
  });
});

describe("intereses", () => {
  it("tasa mensual equivalente a la efectiva anual", () => {
    expect(monthlyRate(28)).toBeCloseTo(0.02079, 4);
    expect(monthlyRate(null)).toBe(0);
  });
  it("capital fijo e intereses sobre el saldo que queda", () => {
    const plan = installmentPlan(1_200_000, 12, "2026-10-15", 28);
    expect(plan).toHaveLength(12);
    expect(plan.every((c) => c.capital === 100_000)).toBe(true);
    expect(plan[0].interest).toBe(Math.round(1_200_000 * monthlyRate(28)));
    expect(plan[11].interest).toBe(Math.round(100_000 * monthlyRate(28)));
    expect(plan[11].date).toBe("2027-09-15");
  });
  it("a 1 cuota no hay intereses", () => {
    expect(installmentPlan(500_000, 1, "2026-10-15", 28)[0].interest).toBe(0);
  });
});

describe("presupuesto: cada mes su cuota", () => {
  it("una compra a 12 cuotas cuenta 100.000 por mes durante 12 meses", () => {
    const rows = spendingRows(expandInstallments([tx({})]));
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.total === 100_000 && r.categoryId === "hogar")).toBe(true);
    expect(rows.map((r) => r.occurredOn).slice(0, 3)).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
  });
  it("las copias apuntan al movimiento original", () => {
    const parts = expandInstallments([tx({})]);
    expect(parts[4].installment_no).toBe(5);
    expect(parts[4].installment_of?.amount).toBe(1_200_000);
  });
  it("sin cuotas, ingresos y transferencias quedan igual", () => {
    const list = [tx({ installments: 1 }), tx({ id: "t2", kind: "INCOME", installments: 6 })];
    expect(expandInstallments(list)).toEqual(list);
  });
});

describe("tarjeta: lo que toca pagar en el periodo", () => {
  const card = { id: "visa", interest_rate_ea: 28 };
  const oct = { start: "2026-10-01", end: "2026-10-31" };

  it("aparta la cuota del mes con sus intereses y no toda la deuda", () => {
    const d = cardDue(card, -1_200_000, [tx({})], oct);
    expect(d.debt).toBe(1_200_000);
    expect(d.laterCapital).toBe(1_100_000);
    expect(d.due).toBe(100_000 + Math.round(1_200_000 * monthlyRate(28)));
  });

  it("las compras a 1 cuota se pagan completas", () => {
    const d = cardDue(card, -1_350_000, [tx({}), tx({ id: "t2", amount: 150_000, installments: 1 })], oct);
    expect(d.due - d.interest).toBe(250_000);
  });

  it("después de pagar la cuota del mes no queda nada por pagar en el periodo", () => {
    const d = cardDue(card, -1_100_000, [tx({})], oct);
    expect(d.due - d.interest).toBe(0);
  });

  it("al mes siguiente toca la segunda cuota", () => {
    const d = cardDue({ id: "visa" }, -1_100_000, [tx({})], { start: "2026-11-01", end: "2026-11-30" });
    expect(d.due).toBe(100_000);
  });
});

describe("tarjeta con día de corte y de pago: solo el extracto que vence en el periodo", () => {
  // Corta el 20 y se paga el 5 del mes siguiente: el extracto del 20-sep se paga el 5-oct y el del 20-oct el 5-nov
  const card = { id: "visa", statement_day: 20, due_day: 5 };
  const oct = { start: "2026-10-01", end: "2026-10-31" };
  const nov = { start: "2026-11-01", end: "2026-11-30" };
  const buy = (id: string, on: string, amount: number) => tx({ id, occurred_on: on, amount, installments: 1 });

  it("encuentra el pago y el corte que le corresponde", () => {
    expect(statementsDueIn(20, 5, oct)).toEqual([{ due: "2026-10-05", cut: "2026-09-20" }]);
    expect(statementsDueIn(20, 5, nov)).toEqual([{ due: "2026-11-05", cut: "2026-10-20" }]);
    expect(statementsDueIn(20, 5, { start: "2027-01-01", end: "2027-01-31" })).toEqual([{ due: "2027-01-05", cut: "2026-12-20" }]);
    // pago el 25 del mismo mes del corte (el 10): el corte es el del mismo mes
    expect(statementsDueIn(10, 25, oct)).toEqual([{ due: "2026-10-25", cut: "2026-10-10" }]);
  });

  it("las compras posteriores al corte del 20-sep no son de octubre", () => {
    // Deuda de 1.000.000 hecha entre el 15 y el 26 de octubre: va en los extractos de noviembre y diciembre
    const txs = [buy("a", "2026-10-15", 400_000), buy("b", "2026-10-22", 600_000)];
    const d = cardDue(card, -1_000_000, txs, oct);
    expect(d.due).toBe(0);
    expect(d.laterCapital).toBe(1_000_000);
    expect(d.dueDate).toBe("2026-10-05");
    expect(d.cutDate).toBe("2026-09-20");
  });

  it("en noviembre toca lo comprado hasta el corte del 20-oct, no lo posterior", () => {
    const txs = [buy("a", "2026-10-15", 400_000), buy("b", "2026-10-22", 600_000)];
    const d = cardDue(card, -1_000_000, txs, nov);
    expect(d.due).toBe(400_000);
    expect(d.laterCapital).toBe(600_000);
  });

  it("lo que se pagó cubre primero las compras más viejas", () => {
    // Antes del corte se compró 700.000; se pagaron 300.000 y se compró 200.000 después: debe 600.000
    const txs = [buy("viejo", "2026-10-10", 700_000), buy("nuevo", "2026-10-25", 200_000)];
    const d = cardDue(card, -600_000, txs, nov);
    expect(d.due).toBe(400_000); // 700.000 − 300.000 pagados, solo lo anterior al 20-oct
  });

  it("deuda anterior a lo registrado se considera ya facturada", () => {
    const d = cardDue(card, -900_000, [buy("a", "2026-10-22", 400_000)], oct);
    expect(d.due).toBe(500_000); // 900.000 − 400.000 de octubre (posterior al corte)
  });

  it("de una compra a cuotas antes del corte solo toca la cuota del mes", () => {
    // ya se pagó la cuota de octubre: debe 1.100.000 y en noviembre toca solo la segunda cuota
    const d = cardDue({ ...card, interest_rate_ea: 0 }, -1_100_000, [tx({ occurred_on: "2026-10-10" })], nov);
    expect(d.due).toBe(100_000);
  });

  it("sin día de corte y de pago sigue apartando la deuda menos las cuotas futuras", () => {
    const d = cardDue({ id: "visa" }, -1_000_000, [buy("a", "2026-10-22", 1_000_000)], oct);
    expect(d.due).toBe(1_000_000);
  });
});

describe("tarjeta con compras a cuotas del extracto", () => {
  // Extracto del 20-oct: debe 8.153.194, de los cuales 6.339.143 es capital de cuotas que todavía no se factura
  const card = { id: "visa", statement_day: 20, due_day: 5, opening_at: "2026-10-20", interest_rate_ea: 0 };
  const item = (over: Partial<CardStatementItem> = {}): CardStatementItem => ({
    id: "i1", account_id: "visa", description: "Compra", purchase_date: "2026-08-23", amount: 7_000_000,
    installments: 12, paid_installments: 2, remaining_balance: 6_339_143, rate_ea: 0, ...over,
  });
  const period = { start: "2026-10-22", end: "2026-11-21" };

  it("cuenta los cortes entre dos fechas", () => {
    expect(cutsBetween(20, "2026-10-20", "2026-10-20")).toBe(0);
    expect(cutsBetween(20, "2026-10-20", "2026-11-20")).toBe(1);
    expect(cutsBetween(20, "2026-10-19", "2026-12-20")).toBe(3);
  });

  it("el saldo de las cuotas sin facturar no se paga en el extracto que vence", () => {
    const d = cardDue(card, -8_153_194, [], period, [item()]);
    expect(d.due).toBe(8_153_194 - 6_339_143);
    expect(d.laterCapital).toBe(6_339_143);
  });

  it("un extracto después factura una cuota por compra", () => {
    const next = { start: "2026-11-22", end: "2026-12-21" }; // vence el 5-dic, corte del 20-nov: 1 corte desde la apertura
    const d = cardDue(card, -8_153_194, [], next, [item()]);
    expect(d.due).toBe(8_153_194 - 6_339_143 + Math.round(6_339_143 / 10)); // 10 cuotas restantes
  });

  it("sin día de corte y de pago tampoco se aparta el saldo a cuotas del extracto", () => {
    const d = cardDue({ id: "visa" }, -8_153_194, [], period, [item()]);
    expect(d.due).toBe(8_153_194 - 6_339_143);
  });

  it("las compras de otra tarjeta no cuentan", () => {
    const d = cardDue(card, -1_000_000, [], period, [item({ account_id: "otra" })]);
    expect(d.due).toBe(1_000_000);
  });

  it("intereses de los cortes que se facturan antes del pago", () => {
    const r = statementItemsAfter([item({ rate_ea: 28 })], 1);
    expect(r.interest).toBe(Math.round(6_339_143 * monthlyRate(28)));
    expect(r.capitalDue + r.later).toBe(6_339_143);
  });
});

describe("tarjeta BBVA con los números del extracto del 20-oct", () => {
  // Extracto: debía 8.153.194, de lo cual 6.339.143 es capital de cuotas sin facturar → se paga 1.814.051 el 5-nov.
  // En la app: apertura el 21-oct 00:00 (el corte del 20 ya incluye lo de ese día) y compras posteriores de 292.540.
  const card = { id: "bbva", statement_day: 20, due_day: 5, opening_at: "2026-10-21T05:00:00+00:00", interest_rate_ea: 28.56 };
  const period = { start: "2026-10-22", end: "2026-11-21" };
  const buy = (id: string, on: string, amount: number, installments = 1) =>
    tx({ id, account_id: "bbva", occurred_on: on, amount, installments, interest_rate_ea: installments > 1 ? 28.56 : null });
  const txs = [
    buy("amazon", "2026-10-07", 120_926, 36), buy("ikea", "2026-10-15", 170_950, 2), buy("ali", "2026-10-16", 54_095, 36),
    buy("temu", "2026-10-16", 64_153), buy("ara", "2026-10-17", 124_500), buy("auto", "2026-10-20", 219_926),
    buy("d1", "2026-10-24", 9_300), buy("moto", "2026-10-24", 247_590), buy("bela", "2026-10-23", 18_750), buy("play", "2026-10-23", 16_900),
  ];
  const item = (id: string, desc: string, date: string, amount: number, n: number, paid: number, remaining: number): CardStatementItem =>
    ({ id, account_id: "bbva", description: desc, purchase_date: date, amount, installments: n, paid_installments: paid, remaining_balance: remaining, rate_ea: 28.56 });
  const items = [
    item("resto", "70 compras de agosto", "2026-08-25", 7_000_000, 36, 1, 6_020_598.27),
    item("amazon", "AMAZON MKTPL", "2026-10-07", 120_926.46, 36, 0, 120_926.46),
    item("ikea", "IKEA CALI", "2026-10-15", 170_950, 2, 1, 143_523.27),
    item("ali", "aliexpress", "2026-10-16", 54_095, 36, 0, 54_095),
  ];

  it("reconoce las compras del extracto que ya son movimiento", () => {
    expect([...matchedWithItems(txs, items)].sort()).toEqual(["ali", "amazon", "ikea"]);
  });

  it("la cuota del periodo es la del extracto: ~$1.800.000", () => {
    const d = cardDue(card, -(8_153_194 + 292_540), txs, period, items);
    expect(d.due).toBeGreaterThan(1_800_000);
    expect(d.due).toBeLessThan(1_830_000);
    expect(d.dueDate).toBe("2026-11-05");
  });

  it("la proyección no cuenta dos veces una compra que está en el extracto y como movimiento", () => {
    const both = projectCard(card, txs, "2026-10-26", 3, items);
    const onlyItems = projectCard(card, [], "2026-10-26", 3, items);
    expect(both.map((m) => m.capital)).toEqual(onlyItems.map((m) => m.capital));
  });
});

describe("tasa por compra y proyección", () => {
  it("cada compra usa su propia tasa; si no trae, la de la tarjeta", () => {
    const card = { id: "visa", interest_rate_ea: 28.5 };
    const own = tx({ interest_rate_ea: 29.63 });
    const none = tx({ id: "t3", interest_rate_ea: null });
    expect(rateOf(own, card)).toBe(29.63);
    expect(rateOf(none, card)).toBe(28.5);
    expect(cardDue(card, -1_200_000, [own], { start: "2026-10-01", end: "2026-10-31" }).interest)
      .toBe(Math.round(1_200_000 * monthlyRate(29.63)));
  });

  it("proyecta las cuotas que faltan mes a mes, sin meses pasados", () => {
    const card = { id: "visa", interest_rate_ea: 28 };
    const rows = projectCard(card, [tx({ occurred_on: "2026-10-15", installments: 3, amount: 300_000, interest_rate_ea: null })], "2026-10-26", 5);
    expect(rows.map((r) => r.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(rows.map((r) => r.purchases)).toEqual([1, 1, 1, 0, 0]);
    expect(rows[0].capital).toBe(100_000);
    expect(rows[2].capital).toBe(100_000);
    expect(rows[3].total).toBe(0);
  });

  it("suma varias compras en el mismo mes", () => {
    const card = { id: "visa", interest_rate_ea: 28 };
    const rows = projectCard(card, [
      tx({ id: "a", occurred_on: "2026-10-15", installments: 2, amount: 200_000 }),
      tx({ id: "b", occurred_on: "2026-09-20", installments: 12, amount: 1_200_000 }),
    ], "2026-11-01", 2);
    expect(rows[0].purchases).toBe(2);
    expect(rows[0].capital).toBe(100_000 + 100_000);
  });
});

describe("compras del extracto (no son movimientos)", () => {
  const card = { id: "visa", interest_rate_ea: 28 };
  const item = (over: Partial<CardStatementItem>): CardStatementItem => ({
    id: "i1", account_id: "visa", description: "REST CAFE NIN", purchase_date: "2026-08-23", amount: 75_982.87,
    installments: 36, paid_installments: 1, remaining_balance: 74_484.93, rate_ea: 29.63, ...over,
  });

  it("aparecen en la proyección desde el mes siguiente, con el saldo repartido en las cuotas que faltan", () => {
    const rows = projectCard(card, [], "2026-10-26", 4, [item({})]);
    expect(rows[0].purchases).toBe(0);
    expect(rows[1].purchases).toBe(1);
    expect(rows[1].capital).toBe(Math.round(74_484.93 / 35));
    expect(rows[1].interest).toBe(Math.round(74_484.93 * monthlyRate(29.63)));
  });

  it("no cuentan más cuotas de las que faltan y el último mes cierra el saldo", () => {
    const rows = projectCard(card, [], "2026-10-26", 40, [item({ installments: 3, paid_installments: 1, remaining_balance: 1000 })]);
    const capital = rows.reduce((a, r) => a + r.capital, 0);
    expect(capital).toBe(1000);
    expect(rows.filter((r) => r.purchases > 0)).toHaveLength(2);
  });

  it("una compra ya pagada no aparece", () => {
    const rows = projectCard(card, [], "2026-10-26", 3, [item({ paid_installments: 36, remaining_balance: 0 })]);
    expect(rows.every((r) => r.total === 0)).toBe(true);
  });
});
