import { describe, expect, it } from "vitest";
import { buildReminders, type ReminderInput } from "@/lib/finance/reminders";
import type { Account, ScheduledPayment, Transaction } from "@/lib/types";

const ME = "me";
const acc = (x: Partial<Account>) => ({ id: "a", owner_user_id: ME, archived: false, kind: "DEPOSIT", name: "Ahorros", opening_at: "2026-01-01", ...x }) as Account;
const base = (x: Partial<ReminderInput>): ReminderInput => ({
  me: ME, today: "2026-10-26", accounts: [], balances: {}, transactions: [], commitments: [], cardItems: [], reconciliations: [], ...x,
});
const rent = { id: "p1", scope: "HOUSEHOLD", owner_user_id: ME, name: "Arriendo", kind: "EXPENSE", amount: 1_500_000, category_id: null,
  responsible_user_id: ME, frequency: "MONTHLY", due_date: null, day_of_month: 30, start_date: "2026-01-01", end_date: null, active: true } as ScheduledPayment;

describe("recordatorios para notificaciones", () => {
  it("vencimiento: el día antes y el mismo día; nada si ya se pagó o es de la pareja", () => {
    const r = buildReminders(base({ commitments: [rent] }));
    const oct = r.filter((x) => x.key.includes("2026-10-30"));
    expect(oct.map((x) => [x.send_on, x.title])).toEqual([["2026-10-29", "Mañana vence Arriendo"], ["2026-10-30", "Hoy vence Arriendo"]]);
    const paid = { id: "t", kind: "EXPENSE", scheduled_payment_id: "p1", scheduled_for: "2026-10-30", amount: 1_500_000, occurred_on: "2026-10-28" } as Transaction;
    expect(buildReminders(base({ commitments: [rent], transactions: [paid] })).some((x) => x.key.includes("2026-10-30"))).toBe(false);
    expect(buildReminders(base({ commitments: [{ ...rent, responsible_user_id: "pareja" }] })).filter((x) => x.key.startsWith("pago"))).toHaveLength(0);
  });

  it("cuota del crédito el día antes del pago y confirmar el saldo el día después", () => {
    const credit = acc({ id: "h", kind: "CREDIT", name: "Hipoteca", due_day: 4, interest_rate_ea: 12, term_months: 240, monthly_costs: 0 });
    const r = buildReminders(base({ accounts: [credit], balances: { h: -100_000_000 } }));
    expect(r.find((x) => x.key === "credito:h:2026-11-04")?.send_on).toBe("2026-11-03");
    // octubre aún sin confirmar: hoy mismo; noviembre: el 5
    expect(r.find((x) => x.key === "credito-saldo:h:2026-10-01")?.send_on).toBe("2026-10-26");
    expect(r.find((x) => x.key === "credito-saldo:h:2026-11-01")?.send_on).toBe("2026-11-05");
    const confirmed = buildReminders(base({ accounts: [credit], balances: { h: -100_000_000 }, reconciliations: [{ account_id: "h", month: "2026-10-01", status: "RECONCILED" }] }));
    expect(confirmed.some((x) => x.key === "credito-saldo:h:2026-10-01")).toBe(false);
  });

  it("cierre del mes el día 1 si falta conciliar, separando cuentas y créditos", () => {
    const r = buildReminders(base({ accounts: [acc({}), acc({ id: "h", kind: "CREDIT", name: "Hipoteca" })], balances: { a: 10, h: 0 } }));
    const c = r.find((x) => x.key === "cierre:2026-10")!;
    expect(c.send_on).toBe("2026-11-01");
    expect(c.body).toBe("Falta conciliar 1 cuenta y 1 crédito.");
    expect(c.url).toBe("/cierre?mes=2026-10");
  });

  it("tarjeta con deuda: aviso antes del pago", () => {
    const card = acc({ id: "v", kind: "CREDIT_CARD", name: "Visa", due_day: 5 });
    const r = buildReminders(base({ accounts: [card], balances: { v: -300_000 } }));
    expect(r.find((x) => x.key === "tarjeta:v:2026-11-05:-1")?.send_on).toBe("2026-11-04");
  });
});
