// Compras a cuotas: save_transaction guarda las cuotas solo en gastos con tarjeta de crédito,
// y los totales compartidos con la pareja reparten la compra en sus meses.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("cuotas de tarjeta de crédito", () => {
  let db: PGlite;
  let hh: string, card: string, savings: string, ropa: string;
  const inst = async (id: string) => Number((await db.query<{ n: number }>(`select installments n from transactions where id = $1`, [id])).rows[0].n);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    const acc = async (name: string, kind: string) =>
      (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at, interest_rate_ea)
        values ($1, $2, $3, $4, 'PRIVATE', 0, '2026-01-01', $5) returning id`, [hh, MAY, name, kind, kind === "CREDIT_CARD" ? 28.5 : null]))[0].id;
    card = await acc("Visa", "CREDIT_CARD");
    savings = await acc("Ahorros", "DEPOSIT");
    ropa = await rpc<string>(db, MAY, "save_category", { name: "Ropa" });
  }, 30_000);

  const expense = (account: string, installments: number, extra = {}) => ({
    kind: "EXPENSE", scope: "PERSONAL", amount: 1_200_000, occurred_on: "2026-10-15", account_id: account, installments,
    splits: [{ amount: 1_200_000, category_id: ropa, responsible_user_id: MAY }], ...extra,
  });

  it("guarda las cuotas de un gasto con tarjeta de crédito", async () => {
    const id = await rpc<string>(db, MAY, "save_transaction", expense(card, 12));
    expect(await inst(id)).toBe(12);
    await rpc(db, MAY, "save_transaction", { ...expense(card, 6), id });
    expect(await inst(id)).toBe(6);
    await db.query(`delete from transactions where id = $1`, [id]);
  });

  it("con otra cuenta o sin cuotas queda en 1, y no pasa de 48", async () => {
    expect(await inst(await rpc<string>(db, MAY, "save_transaction", expense(savings, 12)))).toBe(1);
    expect(await inst(await rpc<string>(db, MAY, "save_transaction", expense(card, 0)))).toBe(1);
    expect(await inst(await rpc<string>(db, MAY, "save_transaction", expense(card, 99)))).toBe(48);
    await db.exec(`delete from transactions`);
  });

  it("la pareja ve el total de un presupuesto personal compartido repartido en cuotas", async () => {
    await as(db, MAY, `select public.save_category_limit($1::jsonb)`, [JSON.stringify({ category_id: ropa, scope: "PERSONAL", amount: 500_000, shared_with_partner: true })]).catch(async () => {
      // Si save_category_limit cambia de forma, se marca directo
      await db.query(`insert into category_limits (household_id, category_id, scope, owner_user_id, shared_with_partner) values ($1, $2, 'PERSONAL', $3, true)`, [hh, ropa, MAY]);
    });
    await rpc(db, MAY, "save_transaction", expense(card, 3, { amount: 100_000, splits: [{ amount: 100_000, category_id: ropa, responsible_user_id: MAY }] }));
    const rows = await as<{ occurred_on: string; total: string }>(db, BREI, `select occurred_on::text, total::text from public.shared_personal_spending() order by 1`);
    expect(rows).toEqual([
      { occurred_on: "2026-10-15", total: "33334" },
      { occurred_on: "2026-11-15", total: "33333" },
      { occurred_on: "2026-12-15", total: "33333" },
    ]);
  });
});
