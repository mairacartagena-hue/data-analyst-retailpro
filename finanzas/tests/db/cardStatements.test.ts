// Migración 0049: extractos de la tarjeta (pago mínimo, total y deuda por corte) y as_of en las compras del extracto.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("extractos de la tarjeta", () => {
  let db: PGlite;
  let hh: string, card: string, savings: string;

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string; id: string }>(`select invite_code, id from households`)).rows[0];
    hh = code.id;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code.invite_code]);
    const acc = async (kind: string) => (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, $3, $4, 'PRIVATE', 0, '2026-10-21') returning id`, [hh, MAY, kind, kind]))[0].id;
    card = await acc("CREDIT_CARD");
    savings = await acc("DEPOSIT");
  }, 30_000);

  const insert = (uid: string, account: string, cut: string, min: number) => as(db, uid, `insert into card_statements (household_id, account_id, owner_user_id, cut_date, due_date, minimum_payment, total_debt, source)
    values ($1, $2, $3, $4, ($4::date + 15), $5, 1000000, 'PDF')
    on conflict (account_id, cut_date) do update set minimum_payment = excluded.minimum_payment`, [hh, account, uid, cut, min]);

  it("la dueña guarda y corrige un extracto por corte", async () => {
    await insert(MAY, card, "2026-10-20", 400000);
    await insert(MAY, card, "2026-10-20", 410000);
    const rows = await as<{ minimum_payment: string }>(db, MAY, `select minimum_payment::text from card_statements`);
    expect(rows).toEqual([{ minimum_payment: "410000.00" }]);
  });

  it("la pareja no lo ve ni puede escribirlo, y solo se guarda en tarjetas", async () => {
    expect(await as(db, BREI, `select * from card_statements`)).toHaveLength(0);
    await expect(insert(BREI, card, "2026-11-20", 1)).rejects.toThrow();
    await expect(insert(MAY, savings, "2026-11-20", 1)).rejects.toThrow();
  });

  it("las compras del extracto aceptan el corte del que salieron", async () => {
    await as(db, MAY, `insert into card_statement_items (household_id, account_id, owner_user_id, description, purchase_date, amount, installments, paid_installments, remaining_balance, as_of)
      values ($1, $2, $3, 'CDA', '2026-10-24', 200000, 2, 1, 100000, '2026-11-20')`, [hh, card, MAY]);
    const rows = await as<{ as_of: string }>(db, MAY, `select as_of::text from card_statement_items`);
    expect(rows).toEqual([{ as_of: "2026-11-20" }]);
  });
});
