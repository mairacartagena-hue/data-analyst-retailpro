import { describe, expect, it } from "vitest";
import { currentInstallmentFrom, sanitizeCreditStatement } from "@/lib/capture/creditStatement";

// Lo que devuelve la IA con el extracto de Banco Caja Social del 18-oct-2026
const caja = {
  institution: "Banco Caja Social", credit_number: "30025291255", statement_date: "2026-10-18", due_date: "2026-11-03",
  capital_balance: 2405745.56, rate_ea: 28.59, term_months: 60, installments_pending: 19,
  installment_capital_interest: 221758, monthly_costs: 3108, amount_due: 224506.94, original_amount: null,
};

describe("leer el extracto de un crédito", () => {
  it("valida y normaliza lo que devuelve la IA", () => {
    const d = sanitizeCreditStatement(caja);
    expect(d).toEqual({
      institution: "Banco Caja Social", last4: "1255", statementDate: "2026-10-18", dueDate: "2026-11-03",
      capitalBalance: 2405745.56, rateEa: 28.59, termMonths: 60, installmentsPending: 19,
      installmentAmount: 221758, monthlyCosts: 3108, amountDue: 224506.94,
    });
  });
  it("descarta valores sin forma válida", () => {
    const d = sanitizeCreditStatement({ capital_balance: -5, rate_ea: 500, term_months: 0, statement_date: "18/10/2026", installments_pending: 999, credit_number: "12" });
    expect(d).toEqual({});
    expect(sanitizeCreditStatement({ term_months: 60, installments_pending: 70 })).toEqual({ termMonths: 60 });
  });
  it("cuota en la que se va: la facturada mientras no pase su fecha de pago", () => {
    const d = sanitizeCreditStatement(caja);
    expect(currentInstallmentFrom(d, "2026-10-26")).toBe(42);
    expect(currentInstallmentFrom(d, "2026-11-03")).toBe(42);
    expect(currentInstallmentFrom(d, "2026-11-04")).toBe(43);
    expect(currentInstallmentFrom(d, "2026-12-03")).toBe(44);
    expect(currentInstallmentFrom({ termMonths: 60 }, "2026-10-26")).toBeUndefined();
  });
});
