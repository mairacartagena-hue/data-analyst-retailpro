// Primer barrido del celular: la persona sube SMS o avisos con su sesión y entran como los del webhook.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";

const ev = (over: Record<string, unknown> = {}) => ({
  channel: "ANDROID_SMS",
  source: "85540",
  external_id: "sms:85540:1",
  raw_text: "Bancolombia: Compraste $45.000 en EXITO",
  received_at: "2026-10-20T15:00:00Z",
  parser: "bancolombia",
  parsed: { kind: "PURCHASE", amount: 45000, merchant: "Exito", merchant_norm: "exito", institution: "Bancolombia", identifiers: [], tags: [] },
  ...over,
});

describe("subir SMS y notificaciones desde la app", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
  }, 30_000);

  it("registra el aviso y no lo duplica si se sube otra vez", async () => {
    expect(await rpc<{ result: string }>(db, MAY, "ingest_import_event", ev())).toMatchObject({ result: "ACCEPTED" });
    expect(await rpc<{ result: string }>(db, MAY, "ingest_import_event", ev())).toMatchObject({ result: "DUPLICATE" });
    const logs = await as<{ channel: string }>(db, MAY, `select channel from ingest_logs`);
    expect(logs).toEqual([{ channel: "ANDROID_SMS" }]);
  });

  it("no acepta Gmail, avisos sin identificador ni llamadas sin sesión", async () => {
    await expect(rpc(db, MAY, "ingest_import_event", ev({ channel: "GMAIL", external_id: "x" }))).rejects.toThrow(/SMS o notificaciones/);
    await expect(rpc(db, MAY, "ingest_import_event", ev({ external_id: "" }))).rejects.toThrow(/identificador/);
    await expect(rpc(db, null, "ingest_import_event", ev({ external_id: "y" }))).rejects.toThrow();
  });
});
