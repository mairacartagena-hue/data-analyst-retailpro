import { describe, expect, it } from "vitest";
import { looksLikeBankSms, parsePasted, parseSmsBackup } from "@/lib/ingest/phoneSweep";

const ms = (iso: string) => Date.parse(iso);

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<smses count="5">
  <sms protocol="0" address="85540" date="${ms("2026-10-20T15:00:00Z")}" type="1" body="Bancolombia: Compraste $45.000,00 en EXITO con tu T.Deb *1234 el 20/10/2026 10:00." readable_date="" />
  <sms protocol="0" address="85540" date="${ms("2026-09-20T15:00:00Z")}" type="1" body="Bancolombia: Compraste $10.000 en D1" />
  <sms protocol="0" address="+573001234567" date="${ms("2026-10-21T15:00:00Z")}" type="1" body="Hola! te debo $20.000" />
  <sms protocol="0" address="85954" date="${ms("2026-10-22T15:00:00Z")}" type="2" body="Enviado $5.000" />
  <sms protocol="0" address="891333" date="${ms("2026-10-23T15:00:00Z")}" type="1" body="Nequi: Recibiste $120.000 de ANA &amp; LUIS&#10;Saldo" />
</smses>`;

describe("primer barrido del celular", () => {
  it("de la copia de SMS toma solo los recibidos de bancos desde la fecha", () => {
    const { items, total } = parseSmsBackup(XML, "2026-10-01");
    expect(total).toBe(3);
    expect(items.map((i) => i.source)).toEqual(["85540", "891333"]);
    expect(items[0]).toMatchObject({ channel: "ANDROID_SMS", receivedAt: "2026-10-20T15:00:00.000Z", externalId: `sms:85540:${ms("2026-10-20T15:00:00Z")}` });
    expect(items[1].text).toBe("Nequi: Recibiste $120.000 de ANA & LUIS\nSaldo");
  });

  it("los celulares de personas no se envían", () => {
    expect(looksLikeBankSms("3001234567", "Te paso $20.000")).toBe(false);
    expect(looksLikeBankSms("Bancolombia", "Compraste $1.000")).toBe(true);
    expect(looksLikeBankSms("85540", "Tu clave es 1234")).toBe(false);
  });

  it("los avisos pegados se separan por línea en blanco y no se repiten", () => {
    const items = parsePasted("Compraste $45.000 en Éxito\n\n\nRecibiste $1.000\n\ncompraste   $45.000 en éxito", "2026-10-05", "ANDROID_NOTIFICATION", "Nequi");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ source: "Nequi", receivedAt: "2026-10-05T17:00:00.000Z" });
    expect(parsePasted("Compraste $45.000 en Éxito", "2026-10-05", "ANDROID_NOTIFICATION", "Nequi")[0].externalId).toBe(items[0].externalId);
  });
});
