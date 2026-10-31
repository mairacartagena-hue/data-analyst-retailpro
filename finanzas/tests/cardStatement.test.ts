import { describe, expect, it } from "vitest";
import { sanitizeCardStatement } from "@/lib/capture/cardStatement";

describe("sanitizeCardStatement", () => {
  it("conserva solo compras diferidas válidas", () => {
    const r = sanitizeCardStatement({
      card_number: "**** 1234", statement_date: "2026-10-15", total_debt: 1500000.4,
      purchases: [
        { description: "IKEA", amount: 1200000, installments: 12, paid_installments: 3, remaining_balance: 900000 },
        { description: "Una cuota", amount: 50000, installments: 1, paid_installments: 0, remaining_balance: 50000 },
        { description: "Saldo mayor", amount: 100, installments: 6, paid_installments: 1, remaining_balance: 500 },
      ],
    }, "2026-10-31");
    expect(r.last4).toBe("1234");
    expect(r.totalDebt).toBe(1500000);
    expect(r.purchases).toHaveLength(1);
    expect(r.purchases[0]).toMatchObject({ description: "IKEA", purchaseDate: "2026-10-15", paidInstallments: 3 });
  });
});
