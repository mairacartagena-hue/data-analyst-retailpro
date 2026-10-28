// Migración 0042: solo una compra que se repite cada mes se marca como suscripción; una transferencia que se repite
// (lo que se le envía cada mes a un familiar) no.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";

describe("marca de suscripción (0042)", () => {
  let db: PGlite;
  let token = "";
  const ev = (kind: string, merchant: string, amount: number, at: string) => ({
    channel: "GMAIL", source: "banco", external_id: null, raw_text: `${merchant} ${amount}`, received_at: at, parser: "prueba",
    parsed: { kind, amount, merchant, merchant_norm: merchant.toLowerCase(), last4: "2505", institution: "Bancolombia", occurred_at: at, identifiers: [], tags: [], ignore_reason: null },
  });
  const ingest = (e: unknown) => as(db, null, `select public.ingest_event($1, $2::jsonb)`, [token, JSON.stringify(e)]);
  const tagged = async (merchant: string) =>
    (await db.query<{ n: number }>(`select count(*)::int n from transactions where merchant = $1 and '#suscripcion' = any (tags)`, [merchant])).rows[0].n;

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    await db.exec(`insert into accounts (household_id, owner_user_id, name, kind, opening_balance, opening_at, last4, institution)
      values ('${hh}', '${MAY}', 'Bancolombia', 'DEPOSIT', 1000000, '2026-01-01', '2505', 'Bancolombia')`);
    token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
  }, 30_000);

  it("una compra que se repite cada mes sí es suscripción", async () => {
    await ingest(ev("PURCHASE", "Netflix", 44900, "2026-09-14T15:00:00Z"));
    await ingest(ev("PURCHASE", "Netflix", 44900, "2026-10-14T15:00:00Z"));
    expect(await tagged("Netflix")).toBe(2);
  });

  it("una transferencia que se repite cada mes no lo es", async () => {
    await ingest(ev("TRANSFER_OUT", "Cuenta 6409", 70000, "2026-09-25T15:00:00Z"));
    await ingest(ev("TRANSFER_OUT", "Cuenta 6409", 70000, "2026-10-25T15:00:00Z"));
    expect(await tagged("Cuenta 6409")).toBe(0);
  });
});
