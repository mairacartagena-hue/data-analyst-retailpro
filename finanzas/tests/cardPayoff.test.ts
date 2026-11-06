import { describe, expect, it } from "vitest";
import { cardDue, expandInstallments, payoffDates, pointsPayoffs, projectCard } from "@/lib/finance/installments";
import { cardPaymentPortions, legacySchedule } from "@/lib/finance/cardBudget";
import type { Account, CardStatementItem, Transaction } from "@/lib/types";

// Pagar el total de una compra a cuotas antes de tiempo (migración 0058): el pago es una transferencia a la tarjeta
// con pays_off_id = id de la compra. Desde ese día la compra ya no tiene cuotas pendientes.

const U = "u1";
const tx = (p: Partial<Transaction>): Transaction => ({
  id: "x", kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-15", amount: 0, description: null, merchant: null,
  account_id: "visa", to_account_id: null, payer_user_id: U, counterparty_user_id: null, is_shared: false, scope: "PERSONAL",
  creates_debt: false, source: "MANUAL", tags: [], created_by: U, created_at: "", splits: [], ...p,
});
// Nevera de $1.200.000 a 12 cuotas comprada el 15-oct (sin intereses para que las cuentas sean exactas)
const nevera = tx({
  id: "nevera", amount: 1_200_000, installments: 12, interest_rate_ea: 0,
  splits: [{ id: "s1", transaction_id: "nevera", amount: 1_200_000, category_id: "hogar", responsible_user_id: U } as Transaction["splits"][number]],
});
// Pago total el 20-dic de lo que faltaba: 10 cuotas de $100.000 (ya se pagaron las de oct y nov)
const pagoTotal = tx({ id: "pago", kind: "TRANSFER", occurred_on: "2026-12-20", amount: 1_000_000, account_id: "ahorros", to_account_id: "visa", pays_off_id: "nevera" });
const card = { id: "visa", interest_rate_ea: 0 };

describe("pagos totales de compras a cuotas", () => {
  it("cada compra queda con la fecha de su pago total; un pago pendiente de revisar no cuenta", () => {
    expect(payoffDates([nevera, pagoTotal]).get("nevera")).toBe("2026-12-20");
    expect(payoffDates([nevera, { ...pagoTotal, status: "PENDING_REVIEW" }]).has("nevera")).toBe(false);
  });

  it("la proyección ya no trae cuotas después del pago total", () => {
    const sin = projectCard(card, [nevera], "2026-10-01", 14);
    expect(sin.filter((r) => r.capital > 0)).toHaveLength(12);
    const con = projectCard(card, [nevera, pagoTotal], "2026-10-01", 14);
    // Quedan solo las cuotas hasta diciembre (oct, nov y dic: la de dic vence el 15, antes del pago)
    expect(con.filter((r) => r.capital > 0).map((r) => r.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("en el periodo siguiente al pago total no se aparta nada de esa compra", () => {
    // Deuda después del pago: 0 (se compró 1.200.000 y se pagaron 200.000 en cuotas + 1.000.000 del total)
    const enero = { start: "2027-01-01", end: "2027-01-31" };
    expect(cardDue(card, 0, [nevera, pagoTotal], enero).due).toBe(0);
    // Sin el pago total, con deuda de 1.000.000 (falta la cuota de dic), se apartaban las cuotas de dic y ene
    expect(cardDue(card, -1_000_000, [nevera], enero).due).toBe(200_000);
  });

  it("el presupuesto cuenta lo que faltaba en la fecha del pago total", () => {
    const copias = expandInstallments([nevera, pagoTotal]).filter((t) => t.installment_of?.id === "nevera");
    expect(copias.map((c) => [c.occurred_on, c.amount])).toEqual([
      ["2026-10-15", 100_000], ["2026-11-15", 100_000], ["2026-12-15", 100_000], ["2026-12-20", 900_000],
    ]);
    expect(copias.reduce((a, c) => a + c.amount, 0)).toBe(1_200_000);
    expect(copias[3].splits[0].amount).toBe(900_000);
  });

  it("si se borra el pago total, la compra vuelve a sus 12 cuotas", () => {
    expect(expandInstallments([nevera]).filter((t) => t.installment_of?.id === "nevera")).toHaveLength(12);
  });
});

describe("pago total de una compra del extracto", () => {
  const A = "may";
  const acc: Account = {
    id: "visa", household_id: "h", owner_user_id: A, name: "Visa", kind: "CREDIT_CARD", institution: null, last4: null,
    visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -1_600_000, credit_limit: null, statement_day: 20, due_day: 5,
    archived: false, opening_at: "2026-10-21T05:00:00.000Z", budget_category_id: "cat-visa",
  } as Account;
  // Televisor diferido: faltan 10 cuotas ($600.000)
  const tv: CardStatementItem = { id: "tv", account_id: "visa", description: "Televisor", purchase_date: "2026-03-01", amount: 1_200_000,
    installments: 20, paid_installments: 10, remaining_balance: 600_000, rate_ea: 0 };
  const pagoTv = tx({ id: "pago-tv", kind: "TRANSFER", occurred_on: "2026-11-10", amount: 600_000, account_id: "ahorros", to_account_id: "visa", pays_off_id: "tv" });

  it("ya no se proyectan sus cuotas", () => {
    const sin = projectCard(acc, [], "2026-11-01", 14, [tv]);
    expect(sin.flatMap((r) => r.lines).filter((l) => l.key.startsWith("tv"))).toHaveLength(10);
    const con = projectCard(acc, [pagoTv], "2026-11-01", 14, [tv]);
    expect(con.flatMap((r) => r.lines).filter((l) => l.key.startsWith("tv"))).toHaveLength(0);
  });

  it("el saldo facturado del extracto no cambia: el pago total no se toma como pago del extracto", () => {
    const linea = (txs: Transaction[]) => projectCard(acc, txs, "2026-11-01", 3, [tv]).flatMap((r) => r.lines).find((l) => l.source === "STATEMENT");
    expect(linea([pagoTv])?.capital).toBe(1_000_000);
    expect(linea([])?.capital).toBe(1_000_000);
  });

  it("en el presupuesto de la tarjeta lo que faltaba vence de una vez y el pago total lo cubre", () => {
    const plan = legacySchedule(acc, [tv], payoffDates([pagoTv]));
    expect(plan.filter((c) => !c.statement).map((c) => [c.cut, c.amount])).toEqual([["2026-11-09", 600_000]]);
    const portions = cardPaymentPortions([acc], [
      tx({ id: "pago-extracto", kind: "TRANSFER", occurred_on: "2026-11-05", amount: 1_000_000, account_id: "ahorros", to_account_id: "visa" }),
      pagoTv,
    ], [tv]);
    expect(portions.get("pago-extracto")?.amount).toBe(1_000_000);
    expect(portions.get("pago-tv")?.amount).toBe(600_000);
  });
});

describe("pago con puntos de una compra a cuotas", () => {
  // El 20-dic se canjean puntos por lo que faltaba de la nevera: ajuste que suma a la tarjeta
  const conPuntos = tx({ id: "puntos", kind: "ADJUSTMENT", direction: "IN", occurred_on: "2026-12-20", amount: 1_000_000, account_id: "visa", pays_off_id: "nevera" });

  it("cuenta como pago total: la compra ya no tiene cuotas después del canje", () => {
    expect(payoffDates([nevera, conPuntos]).get("nevera")).toBe("2026-12-20");
    expect(pointsPayoffs([nevera, conPuntos]).has("nevera")).toBe(true);
    expect(pointsPayoffs([nevera, pagoTotal]).has("nevera")).toBe(false);
    const con = projectCard(card, [nevera, conPuntos], "2026-10-01", 14);
    expect(con.filter((r) => r.capital > 0).map((r) => r.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("lo que cubrieron los puntos no cuenta en el presupuesto", () => {
    const copias = expandInstallments([nevera, conPuntos]).filter((t) => t.installment_of?.id === "nevera");
    expect(copias.map((c) => [c.occurred_on, c.amount])).toEqual([
      ["2026-10-15", 100_000], ["2026-11-15", 100_000], ["2026-12-15", 100_000],
    ]);
  });

  it("un ajuste que resta o sin compra no es pago con puntos", () => {
    expect(payoffDates([{ ...conPuntos, direction: "OUT" }]).size).toBe(0);
    expect(payoffDates([{ ...conPuntos, pays_off_id: null }]).size).toBe(0);
  });

  it("una compra del extracto pagada con puntos no se factura en el presupuesto de la tarjeta", () => {
    const acc = { id: "visa", kind: "CREDIT_CARD", statement_day: 20, due_day: 5, opening_at: "2026-10-21T05:00:00.000Z", opening_balance: -1_600_000 };
    const tv: CardStatementItem = { id: "tv", account_id: "visa", description: "Televisor", purchase_date: "2026-03-01", amount: 1_200_000,
      installments: 20, paid_installments: 10, remaining_balance: 600_000, rate_ea: 0 };
    const pagoTv = tx({ id: "pt", kind: "ADJUSTMENT", direction: "IN", occurred_on: "2026-11-10", amount: 600_000, account_id: "visa", pays_off_id: "tv" });
    const conPlata = legacySchedule(acc, [tv], new Map([["tv", "2026-11-10"]]));
    const conPts = legacySchedule(acc, [tv], payoffDates([pagoTv]), pointsPayoffs([pagoTv]));
    const total = (xs: { amount: number }[]) => xs.reduce((a, c) => a + c.amount, 0);
    expect(total(conPlata)).toBe(1_600_000);
    expect(total(conPts)).toBe(1_000_000); // solo el saldo al corte
  });
});
