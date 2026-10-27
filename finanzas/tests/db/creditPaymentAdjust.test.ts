// Ajustar una cuota con el pago real: se edita el gasto de intereses cargado al crédito y la deuda queda bien.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";

describe("ajustar la cuota de un crédito con el pago real", () => {
  let db: PGlite;
  let hh: string, bank: string, credit: string, cat: string, charge: string;
  const balance = async (id: string) => {
    const r = await as<{ b: string }>(db, MAY, `select coalesce(sum(case when account_id = $1 then (case when kind in ('INCOME','REFUND') or (kind='ADJUSTMENT' and direction='IN') then amount else -amount end) else 0 end)
      + sum(case when to_account_id = $1 then amount else 0 end), 0) + (select opening_balance from accounts where id = $1) as b
      from transactions where (account_id = $1 or to_account_id = $1) and status = 'CONFIRMED'`, [id]);
    return Number(r[0].b);
  };

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    bank = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Bancolombia', 'DEPOSIT', 'PRIVATE', 5000000, '2026-01-01') returning id`, [hh, MAY]))[0].id;
    credit = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Crédito hipotecario', 'CREDIT', 'PUBLIC', -155032174, '2026-01-01') returning id`, [hh, MAY]))[0].id;
    cat = await rpc<string>(db, MAY, "save_category", { name: "Hipotecario" });
    await rpc(db, MAY, "save_transaction", { kind: "TRANSFER", amount: 1953000, occurred_on: "2026-10-23", account_id: bank, to_account_id: credit, description: "Pago", tags: [] });
    charge = await rpc<string>(db, MAY, "save_transaction", { kind: "EXPENSE", scope: "HOUSEHOLD", amount: 1571638, occurred_on: "2026-10-23", account_id: credit,
      description: "Cuota Crédito hipotecario · intereses y seguros", tags: [], splits: [{ amount: 1571638, category_id: cat, responsible_user_id: MAY, origin: "NORMAL" }] });
  }, 30_000);

  it("con $932.583 a capital, el gasto queda en $1.020.417 y la deuda baja solo el capital", async () => {
    expect(await balance(credit)).toBe(-155032174 + 1953000 - 1571638);
    const t = (await as<Record<string, unknown>>(db, MAY, `select * from transactions where id = $1`, [charge]))[0];
    await rpc(db, MAY, "save_transaction", {
      id: charge, kind: "EXPENSE", scope: t.scope, amount: 1020417, occurred_on: "2026-10-23", description: t.description, merchant: null, tags: [],
      account_id: credit, to_account_id: null, direction: null, installments: 1, interest_rate_ea: null, creates_debt: t.creates_debt, is_shared: false,
      income_category_id: null, scheduled_payment_id: null, scheduled_for: null,
      splits: [{ amount: 1020417, category_id: cat, responsible_user_id: MAY, origin: "NORMAL" }],
    });
    expect(await balance(credit)).toBe(-155032174 + 932583);
    expect(await balance(bank)).toBe(5000000 - 1953000);
    const s = await as<{ amount: string }>(db, MAY, `select amount from transaction_splits where transaction_id = $1`, [charge]);
    expect(s.map((x) => Number(x.amount))).toEqual([1020417]);
  });
});
