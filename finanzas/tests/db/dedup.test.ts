// La misma compra avisada por Google Wallet, SMS y correo debe quedar en UN solo movimiento,
// sin importar el orden ni el retraso con que llegue cada aviso. Se prueba de punta a punta:
// texto real → lector (parser) → ingest_event() sobre las migraciones reales.

import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, setupDb } from "./harness";
import { finishParsed, parseWithRules } from "@/lib/ingest/registry";
import type { RawEvent } from "@/lib/ingest/types";

const MAY = "00000000-0000-0000-0000-00000000000a";

const SMS = "Bancolombia: Compraste $33.900,00 en AGRO LA HACIENDA con tu T.Deb *7473, el 24/10/2026 a las 12:19. Si tienes dudas, encuentranos aqui: 6045109095 o 018000931987. Estamos cerca.";
const WALLET: RawEvent = { channel: "ANDROID_NOTIFICATION", source: "Billetera de Google", title: "AGRO LA HACIENDA", text: "COP33,900.00 con Debito Mastercard ••7473", receivedAt: "2026-10-24T17:19:20.000Z" };
const SMS_EV: RawEvent = { channel: "ANDROID_SMS", source: "85540", text: SMS, receivedAt: "2026-10-24T17:19:25.000Z" };
const MAIL: RawEvent = { channel: "GMAIL", source: "Bancolombia <alertasynotificaciones@ayn.notificacionesbancolombia.com>", subject: "Alertas y Notificaciones", text: `¡Listo! Todo salió bien con tus movimientos\n\n${SMS}`, receivedAt: "2026-10-24T17:23:00.000Z", externalId: "gmail-1" };

function dbEvent(ev: RawEvent) {
  const r = parseWithRules(ev);
  const p = r.parsed!;
  return {
    channel: ev.channel, source: ev.source, external_id: ev.externalId ?? null, raw_text: [ev.title, ev.subject, ev.text].filter(Boolean).join("\n"),
    received_at: ev.receivedAt, parser: r.parser,
    parsed: { kind: p.kind, amount: p.amount ?? null, merchant: p.merchant ?? null, merchant_norm: p.merchantNorm ?? null, last4: p.last4 ?? null,
      institution: p.institution ?? null, occurred_at: p.occurredAt ?? null, identifiers: p.identifiers ?? [], tags: p.tags ?? [], ignore_reason: null },
  };
}

describe("la misma compra por Wallet, SMS y correo no se duplica", () => {
  let db: PGlite;
  let token: string;
  const ingest = async (ev: RawEvent) => (await as<{ r: { result: string; transaction_id?: string } }>(db, null, `select public.ingest_event($1, $2::jsonb) as r`, [token, JSON.stringify(dbEvent(ev))]))[0].r;
  const count = async () => (await db.query<{ n: number }>(`select count(*)::int n from transactions`)).rows[0].n;

  beforeEach(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    await db.exec(`insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at, last4, alias_last4, institution)
      values ('${hh}', '${MAY}', 'Bancolombia', 'DEPOSIT', 'PRIVATE', 1000000, '2026-01-01', '2505', array['7473'], 'Bancolombia')`);
    token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
  }, 30_000);

  const ORDERS: [string, RawEvent[]][] = [
    ["Wallet → SMS → correo", [WALLET, SMS_EV, MAIL]],
    ["SMS → Wallet → correo", [SMS_EV, WALLET, MAIL]],
    ["correo → SMS → Wallet", [MAIL, SMS_EV, WALLET]],
    ["Wallet → correo → SMS", [WALLET, MAIL, SMS_EV]],
  ];

  for (const [name, events] of ORDERS) {
    it(name, async () => {
      const results = [];
      for (const e of events) results.push(await ingest(e));
      expect(results.map((r) => r.result)).toEqual(["ACCEPTED", "MERGED", "MERGED"]);
      expect(await count()).toBe(1);
      const t = (await db.query<{ amount: number; account: string }>(`select t.amount::int amount, a.name account from transactions t join accounts a on a.id = t.account_id`)).rows;
      expect(t).toEqual([{ amount: 33900, account: "Bancolombia" }]);
    });
  }

  it("el mismo correo enviado dos veces se descarta", async () => {
    await ingest(MAIL);
    expect((await ingest(MAIL)).result).toBe("DUPLICATE");
    expect(await count()).toBe(1);
  });

  it("el correo llega con 8 minutos de retraso (Apps Script cada 5 min): se une igual", async () => {
    await ingest(WALLET);
    const late = { ...MAIL, receivedAt: "2026-10-24T17:28:00.000Z" };
    expect((await ingest(late)).result).toBe("MERGED");
    expect(await count()).toBe(1);
  });

  it("límite conocido: Wallet no trae la hora de la compra, solo la de llegada; si llega con más de 5 min de retraso queda aparte", async () => {
    // Pasa solo si el celular estuvo sin internet. Unir con ventanas más amplias arriesgaría juntar dos compras iguales reales.
    await ingest(SMS_EV);
    const late = { ...WALLET, receivedAt: "2026-10-24T17:40:00.000Z" };
    expect((await ingest(late)).result).toBe("ACCEPTED");
    expect(await count()).toBe(2);
  });

  it("dos compras distintas (monto o comercio distinto) no se unen", async () => {
    await ingest(WALLET);
    await ingest({ ...SMS_EV, text: SMS.replace("33.900,00", "34.900,00") });
    await ingest({ ...SMS_EV, receivedAt: "2026-10-24T17:20:00.000Z", text: SMS.replace("AGRO LA HACIENDA", "DROGUERIA LA ECONOMIA") });
    expect(await count()).toBe(3);
  });

  it("dos compras iguales con horas lejanas (ej. 2 horas) son movimientos distintos", async () => {
    await ingest(WALLET);
    await ingest({ ...SMS_EV, text: SMS.replace("las 12:19", "las 14:30"), receivedAt: "2026-10-24T19:30:10.000Z" });
    expect(await count()).toBe(2);
  });

  it("finishParsed deja la hora de Wallet vacía (se usa la de llegada)", () => {
    const p = finishParsed(WALLET, parseWithRules(WALLET).parsed!);
    expect(p.occurredAt ?? null).toBeNull();
  });
});
