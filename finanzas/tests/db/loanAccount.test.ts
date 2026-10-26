// Préstamo: recibirlo y pagarlo son transferencias, así que no cuentan como ingreso ni gasto.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";

describe("cuenta de préstamo", () => {
  let db: PGlite;
  let hh: string, bank: string, loan: string;
  const balance = async (acc: string) =>
    Number((await as<{ balance: string }>(db, MAY, `select balance::text from public.account_balances() where account_id = $1`, [acc]))[0].balance);
  const flow = async () => (await db.query<{ n: string }>(
    `select count(*)::text n from transactions where kind in ('INCOME','EXPENSE') and account_id = $1 or kind in ('INCOME','EXPENSE') and to_account_id = $1`, [loan])).rows[0].n;

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    bank = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Ahorros', 'DEPOSIT', 'PRIVATE', 500000, '2026-01-01') returning id`, [hh, MAY]))[0].id;
    loan = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Préstamo de mi hermana', 'LOAN', 'PRIVATE', 0, '2026-01-01') returning id`, [hh, MAY]))[0].id;
  }, 30_000);

  it("acepta el tipo LOAN", async () => {
    expect(await balance(loan)).toBe(0);
  });

  it("me prestan 200: la deuda sube y mi cuenta recibe la plata; no es ingreso", async () => {
    await rpc(db, MAY, "save_transaction", { kind: "TRANSFER", amount: 200_000, occurred_on: "2026-10-26", account_id: loan, to_account_id: bank, description: "Préstamo" });
    expect(await balance(loan)).toBe(-200_000);
    expect(await balance(bank)).toBe(700_000);
    expect(await flow()).toBe("0");
  });

  it("compro algo con esa plata: es un gasto normal de mi cuenta de ahorros", async () => {
    const cat = await rpc<string>(db, MAY, "save_category", { name: "Varios" });
    await rpc(db, MAY, "save_transaction", { kind: "EXPENSE", scope: "PERSONAL", amount: 200_000, occurred_on: "2026-10-26", account_id: bank,
      splits: [{ amount: 200_000, category_id: cat, responsible_user_id: MAY }] });
    expect(await balance(bank)).toBe(500_000);
    expect(await balance(loan)).toBe(-200_000);
  });

  it("le pago 120: la deuda baja y no es gasto", async () => {
    await rpc(db, MAY, "save_transaction", { kind: "TRANSFER", amount: 120_000, occurred_on: "2026-11-05", account_id: bank, to_account_id: loan, description: "Abono préstamo" });
    expect(await balance(loan)).toBe(-80_000);
    expect(await balance(bank)).toBe(380_000);
  });
});
