// Migración 0043: un vencimiento del hogar se puede compartir con montos fijos (share_a / share_b).

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";

describe("vencimientos compartidos (0043)", () => {
  let db: PGlite;
  let hh = "";
  const insert = (scope: string, a: number | null, b: number | null) =>
    as(db, MAY, `insert into scheduled_payments (household_id, owner_user_id, scope, name, kind, amount, frequency, day_of_month, start_date, share_a, share_b)
      values ($1, $2, $3, 'Administración', 'EXPENSE', 205000, 'MONTHLY', 5, '2026-10-01', $4, $5) returning share_a, share_b`, [hh, MAY, scope, a, b]);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
  }, 30_000);

  it("del hogar: guarda lo que pone cada uno", async () => {
    expect(await insert("HOUSEHOLD", 102500, 102500)).toEqual([{ share_a: 102500, share_b: 102500 }]);
  });

  it("sin reparto sigue funcionando", async () => {
    expect(await insert("HOUSEHOLD", null, null)).toEqual([{ share_a: null, share_b: null }]);
  });

  it("no se puede compartir uno personal ni dejar una sola parte", async () => {
    await expect(insert("PERSONAL", 100, 105)).rejects.toThrow();
    await expect(insert("HOUSEHOLD", 100, null)).rejects.toThrow();
  });
});
