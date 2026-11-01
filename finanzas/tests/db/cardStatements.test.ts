// Migraciones 0049 y 0050: as_of en las compras del extracto; los valores del extracto no se guardan.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("compras del extracto y extractos", () => {
  let db: PGlite;
  let hh: string, card: string;

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
  }, 30_000);

  it("los extractos no se guardan: no existe la tabla", async () => {
    await expect(as(db, MAY, `select * from card_statements`)).rejects.toThrow(/card_statements/);
  });

  it("las compras del extracto aceptan el corte del que salieron", async () => {
    await as(db, MAY, `insert into card_statement_items (household_id, account_id, owner_user_id, description, purchase_date, amount, installments, paid_installments, remaining_balance, as_of)
      values ($1, $2, $3, 'CDA', '2026-10-24', 200000, 2, 1, 100000, '2026-11-20')`, [hh, card, MAY]);
    const rows = await as<{ as_of: string }>(db, MAY, `select as_of::text from card_statement_items`);
    expect(rows).toEqual([{ as_of: "2026-11-20" }]);
  });
});
