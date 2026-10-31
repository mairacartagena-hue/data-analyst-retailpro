import { describe, expect, it } from "vitest";
import { parseWithRules } from "@/lib/ingest/registry";
import type { Channel, RawEvent } from "@/lib/ingest/types";

const sms = (text: string, source = "85540"): RawEvent => ({ channel: "ANDROID_SMS", source, text, receivedAt: "2026-10-23T16:00:00.000Z" });
const notif = (title: string, text: string, source = "BBVA Colombia"): RawEvent => ({ channel: "ANDROID_NOTIFICATION" as Channel, source, title, text, receivedAt: "2026-10-23T18:00:00.000Z" });
const mail = (subject: string, text: string): RawEvent => ({
  channel: "GMAIL", source: "Bancolombia <alertasynotificaciones@ayn.notificacionesbancolombia.com>", subject, text, receivedAt: "2026-10-23T16:00:00.000Z",
});

describe("Bancolombia (mensajes reales)", () => {
  it("compra con tarjeta débito", () => {
    const r = parseWithRules(sms("Bancolombia: Compraste $63.490,00 en GOOGLE *Claude by An con tu T.Deb *7473, el 22/10/2026 a las 14:10. Si tienes dudas, encuentranos aqui: 6045109095 o 018000931987. Estamos cerca."));
    expect(r.parser).toBe("bancolombia");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 63490, merchant: "Claude by An", last4: "7473", institution: "Bancolombia", occurredAt: "2026-10-22T19:10:00.000Z" });
    expect(r.parsed?.identifiers).toEqual([]);
  });

  it("compra en TEMU", () => {
    const r = parseWithRules(sms("Bancolombia: Compraste $18.108,00 en TEMU COM con tu T.Deb *7473, el 22/09/2026 a las 00:47. Si tienes dudas, encuentranos aqui: 6045109095 o 018000931987. Estamos cerca."));
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 18108, merchant: "Temu Com", merchantNorm: "temu com", last4: "7473" });
  });

  it("pagos PSE desde el producto 2505", () => {
    const a = parseWithRules(sms("Bancolombia: Pagaste $1,043,000.00 a Banco Davivienda S A Zona Pa desde tu producto 2505 el 23/10/2026 10:42:10. ¿Dudas? Llamanos al 6045109095. Estamos cerca", "85784"));
    expect(a.parsed).toMatchObject({ kind: "PURCHASE", amount: 1043000, last4: "2505", occurredAt: "2026-10-23T15:42:10.000Z" });
    const b = parseWithRules(sms("Bancolombia: Pagaste $838,057.50 a LULO BANK S A desde tu producto 2505 el 23/10/2026 10:50:44. ¿Dudas? Llamanos al 6045109095. Estamos cerca", "85784"));
    expect(b.parsed).toMatchObject({ kind: "PURCHASE", amount: 838058, merchant: "Lulo Bank", merchantNorm: "lulo bank" });
    const c = parseWithRules(sms("Bancolombia: Pagaste $1,953,000.00 a Banco de Bogota desde tu producto 2505 el 23/10/2026 10:55:27. ¿Dudas? Llamanos al 6045109095. Estamos cerca", "85784"));
    expect(c.parsed).toMatchObject({ kind: "PURCHASE", amount: 1953000, merchant: "Banco de Bogota" });
  });

  it("transferencia enviada a otra cuenta", () => {
    const r = parseWithRules(sms("Bancolombia: Transferiste $800,000 desde tu cuenta *2505 a la cuenta *0123416876 el 23/10/2026 a las 11:26. ¿Dudas? Llamanos al 018000931987. Estamos cerca."));
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_OUT", amount: 800000, last4: "2505", merchant: "Cuenta ···6876", occurredAt: "2026-10-23T16:26:00.000Z" });
    expect(r.parsed?.identifiers).toEqual([{ type: "ACCOUNT", value: "0123416876" }]);
  });

  it("transferencia recibida por llave", () => {
    const r = parseWithRules(sms("Bancolombia: MAYRA, recibiste una transferencia de XXXX XXXX por $100,000.00 en tu cuenta *2505 conectada a la llave @cartagena220 el 23/10/26 a las 18:19. Con llaves es de una y gratis. Dudas al 018000912345."));
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_IN", amount: 100000, merchant: "Xxxx Xxxx", last4: "2505", occurredAt: "2026-10-23T23:19:00.000Z" });
  });

  it("pago recibido (nómina) con la hora antes de la fecha", () => {
    const r = parseWithRules(sms("Bancolombia: Recibiste un pago por $6,044,772.00 de DELOITTE XXXX a tu cuenta AHORROS, el 10:07 a las 23/10/2026. ¿Tienes dudas? Encuentranos aqui:018000931987. Estamos cerca"));
    expect(r.parsed).toMatchObject({ kind: "INCOME", amount: 6044772, merchant: "Deloitte Xxxx", last4: null, occurredAt: "2026-10-23T15:07:00.000Z" });
  });

  it("el correo trae el mismo texto después de un encabezado", () => {
    const r = parseWithRules(mail("Alertas y Notificaciones", "¡Listo! Todo salió bien con tus movimientos\n\nBancolombia: Pagaste $1,953,000.00 a Banco de Bogota desde tu producto 2505 el 23/10/2026 10:55:27. ¿Dudas? Llamanos al 6045109095."));
    expect(r.parser).toBe("bancolombia");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 1953000, last4: "2505" });
  });
});

describe("BBVA (notificaciones reales)", () => {
  it("compra exitosa", () => {
    const r = parseWithRules(notif("Compra Exitosa", "Hola, realizaste una compra por $16,900.00 en Google *play yout con tu tarjeta BBVA *0602. El 2026-10-23 a las 12:51."));
    expect(r.parser).toBe("bbva");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 16900, merchant: "play yout", last4: "0602", occurredAt: "2026-10-23T17:51:00.000Z" });
    const s = parseWithRules(notif("Compra Exitosa", "Hola, realizaste una compra por $18,750.00 en Supermercado bela con tu tarjeta BBVA *0602. El 2026-10-23 a las 10:07."));
    expect(s.parsed).toMatchObject({ amount: 18750, merchant: "Supermercado bela" });
  });

  it("aviso de ingreso a la app se ignora", () => {
    const r = parseWithRules(notif("Ingreso a App BBVA", "BBVA te informa que ingresaste a la App el 2026-10-23 a las 10:44 desde el dispositivo Android 16 samsung SM-S918B."));
    expect(r.parsed?.kind).toBe("IGNORE");
  });
});

describe("Banco Caja Social (SMS reales)", () => {
  it("pago aprobado con fecha mes/día/año", () => {
    const r = parseWithRules(sms("Su pago por $469.462,35 para CREDITOS DE CONSUMO quedo Aprobado. 06/25/2026 12:21. Banco Caja Social Tel Bta 601 542 6446 ? Nal 018000910038.", "87227"));
    expect(r.parser).toBe("caja-social");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 469462, merchant: "Creditos De Consumo", institution: "Banco Caja Social", occurredAt: "2026-06-25T17:21:00.000Z" });
  });

  it("pago rechazado se ignora", () => {
    const r = parseWithRules(sms("Su pago por $224.506,94 para CREDITOS DE CONSUMO quedo Rechazado. 10/23/2026 11:10. Banco Caja Social Tel Bta 601 542 6446 ? Nal 018000910038.", "87227"));
    expect(r.parsed?.kind).toBe("IGNORE");
  });
});

describe("Bancolombia: formatos nuevos (correos reales)", () => {
  it("pago con Botón Bancolombia a Wompi", () => {
    const r = parseWithRules(mail("Alertas y Notificaciones", "Notificación Transaccional Bancolombia: Transferiste $12,900.00 por Boton Bancolombia a Wompi SAS desde producto *2505. 22/10/2026 10:22:05 ¿Dudas? 018000931987."));
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 12900, merchant: "Wompi", last4: "2505", occurredAt: "2026-10-22T15:22:05.000Z" });
  });

  it("transferencia a una llave (Bre-B) de otra persona", () => {
    const r = parseWithRules(mail("Alertas y Notificaciones", "¡Listo! Todo salió bien con tus movimientos *Bancolombia: MAYRA, transferiste $35,000.00 a la llave @3218164052 desde tu cuenta *2505 a XXXX CABRERA el 21/10/26 a las 19:53. Con Bre-b es de una y gratis. Dudas al 018000912345.*"));
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_OUT", amount: 35000, merchant: "Xxxx Cabrera", last4: "2505", occurredAt: "2026-10-22T00:53:00.000Z" });
    expect(r.parsed?.identifiers).toEqual([{ type: "PHONE", value: "3218164052" }]);
  });
});

describe("Google Wallet (notificación real)", () => {
  const wallet = (title: string, text: string, source = "Billetera de Google"): RawEvent =>
    ({ channel: "ANDROID_NOTIFICATION", source, title, text, receivedAt: "2026-10-24T17:19:00.000Z" });

  it("pago con tarjeta débito", () => {
    const r = parseWithRules(wallet("AGRO LA HACIENDA", "COP33,900.00 con Debito Mastercard ••7473"));
    expect(r.parser).toBe("google-wallet");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 33900, merchant: "Agro La Hacienda", last4: "7473", institution: "Google Wallet" });
  });

  it("también con el nombre en inglés de la app", () => {
    const r = parseWithRules(wallet("TIENDA D1", "COP 6.490 con Visa •• 0602", "Google Wallet"));
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 6490, last4: "0602" });
  });

  it("otras notificaciones de la billetera se ignoran", () => {
    const r = parseWithRules(wallet("Tarjeta lista", "Ya puedes pagar con tu tarjeta en tiendas"));
    expect(r.parsed?.kind).toBe("IGNORE");
  });
});

describe("Nequi (notificaciones reales)", () => {
  it("dinero recibido: sin depender de Gemini", () => {
    const a = parseWithRules(notif("Envío", "JUAN PEREZ te envió 1, ¡lo mejor!", "Nequi Colombia"));
    expect(a.parser).toBe("nequi");
    expect(a.parsed).toMatchObject({ kind: "TRANSFER_IN", amount: 1, merchant: "Juan Perez", institution: "Nequi" });
    const b = parseWithRules(notif("Envío", "ANA GOMEZ te envió 300000, ¡lo mejor!", "Nequi Colombia"));
    expect(b.parsed).toMatchObject({ kind: "TRANSFER_IN", amount: 300000, merchant: "Ana Gomez" });
  });

  it("con monto con separador de miles y sin título", () => {
    const r = parseWithRules({ channel: "ANDROID_NOTIFICATION", source: "Nequi Colombia", text: "MARIA PEREZ te envió $1.250.000, ¡lo mejor!", receivedAt: "2026-10-31T22:00:00.000Z" });
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_IN", amount: 1250000, merchant: "Maria Perez" });
  });

  it("las promociones y avisos de seguridad siguen sin ser movimientos", () => {
    expect(parseWithRules(notif("Haz 5  compras", "Haz 5  compras con tu Tarjeta Nequi Visa, mantén tu racha y participa por hasta $45.000 COP. Aplican TyC.", "Nequi Colombia")).parsed?.kind).toBe("IGNORE");
    expect(parseWithRules(notif("Seguridad", "Iniciaste sesión en tu Nequi desde la web.", "Nequi Colombia")).parsed?.kind).toBe("IGNORE");
  });
});

const luloMail = (subject: string, text: string): RawEvent => ({
  channel: "GMAIL", source: "Notificaciones Lulo bank <notificaciones@lulobank.com>", subject, text, receivedAt: "2026-10-31T20:00:00.000Z",
});
const rappiMail = (subject: string, text: string): RawEvent => ({
  channel: "GMAIL", source: "RappiCard <noreply@rappicard.co>", subject, text, receivedAt: "2026-10-31T20:00:00.000Z",
});

describe("Lulo bank (correos reales)", () => {
  it("compra con la tarjeta débito", () => {
    const r = parseWithRules(luloMail("Compra realizada", "Compra realizada\n[image: ícono de app Lulo] \nCompra realizada \n\nRealizaste una compra en SMARTTT por $3,500.00\n\nOrigen tarjeta débito •1111\nLulo bank 300 000 0000\nNo. comprobante 100001\n\nOperación sin costo\n\nFecha 22 de octubre de 2026\nHora 5:41 p.m. \n\nSi no reconoces este movimiento ingresa a la sección de ayuda."));
    expect(r.parser).toBe("lulo");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 3500, merchant: "Smarttt", last4: "1111", institution: "Lulo Bank", occurredAt: "2026-10-22T22:41:00.000Z" });
  });

  it("compra rechazada: se ignora", () => {
    const r = parseWithRules(luloMail("Compra rechazada", "Compra rechazada\n[image: ícono de app Lulo] \nCompra rechazada \n\nCompra rechazada en MINISO CC UNICO CALI por $30,830.00\n\nOrigen tarjeta débito •1111\nFecha 24 de octubre de 2026\nHora 8:12 p.m."));
    expect(r.parsed?.kind).toBe("IGNORE");
  });

  it("pago PSE desde la cuenta", () => {
    const r = parseWithRules(luloMail("Pago PSE exitoso", "Pago PSE exitoso\n[image: ícono de app Lulo] \nHiciste un pago a Banco Davivienda Sa por $2,000,000.69 \n\nEl cobro se hizo a tu cuenta • 2222 \n\nNo. comprobante 1234567890123456\nCUS 100000001\nReferencia 1: 10.0.0.1 \nDescripción de pago: 100000002. \n\nOperación sin costo\n\nFecha 31 oct. 2026 \nHora 8:19 a.m."));
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 2000001, merchant: "Banco Davivienda", last4: "2222", occurredAt: "2026-10-31T13:19:00.000Z" });
  });

  it("recarga recibida", () => {
    const r = parseWithRules(luloMail("Lulo Cuenta recargada", "Lulo Cuenta recargada\n[image: ícono de app Lulo] \nLulo Cuenta recargada \n\nRecibiste una recarga a tu cuenta por $1.000.000. \n\nOrigen · BANCOLOMBIA \nCUS 100000003 \nNo. comprobante 10000000000000001 \nMedio PSE \n\nCosto de la operación ¡Sin costo! \n\nFecha 23 de octubre de 2026 \nHora 12:06 p.m."));
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_IN", amount: 1000000, merchant: "Bancolombia", occurredAt: "2026-10-23T17:06:00.000Z" });
  });

  it("pago del crédito de Lulo", () => {
    const r = parseWithRules(luloMail("Pago hecho", "Pago hecho\n [image: ícono de app Lulo] \nPago hecho \n\nHiciste el pago de tu crédito No. 48838263333 por $800,000.86. \n\nOrigen • BANCOLOMBIA \nDestino Crédito • 3333 \nNo. comprobante 10000000000000002 \nCUS 100000004 \nMedio PSE \n\nFecha 25 de septiembre de 2026 \nHora 10:33 a.m."));
    expect(r.parsed).toMatchObject({ kind: "CARD_PAYMENT", amount: 800001, merchant: "Lulo Bank", last4: "3333", occurredAt: "2026-09-25T15:33:00.000Z" });
  });

  it("correos de Lulo que no son movimientos no se inventan", () => {
    expect(parseWithRules(luloMail("Tienes hasta $15,000,000 para desembolsar", "Solicita tu crédito desde la app")).parsed).toBeNull();
  });
});

describe("RappiCard (correos reales)", () => {
  const compra = (monto: string, comercio: string, fecha: string) =>
    `RappiCard - Resumen de transacción\n[image: 630x187x1] \n  \n¡Hola, NOMBRE APELLIDO! \nRealizaste una compra con tu RappiCard. \n  \nDetalle de tu transacción: \n  \n\nMonto\n\n${monto}\n------------------------------\n\nMétodo de pago\n\n*4444\n------------------------------\n\nNo. de autorización\n\n100005\n------------------------------\n\nComercio\n\n${comercio}\n------------------------------\n\nFecha de la transacción\n\n${fecha}\n  \n\n¿Necesitas ayuda?`;

  it("compra con la tarjeta", () => {
    const r = parseWithRules(rappiMail("RappiCard - Resumen de transacción", compra("$16.800", "DLO Didi", "2026-10-23 07:28:17")));
    expect(r.parser).toBe("rappicard");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 16800, merchant: "DLO Didi", last4: "4444", institution: "RappiCard", occurredAt: "2026-10-23T12:28:00.000Z" });
    expect(parseWithRules(rappiMail("RappiCard - Resumen de transacción", compra("$539.820", "Puma", "2026-10-22 22:12:51"))).parsed).toMatchObject({ amount: 539820, merchant: "Puma" });
  });

  it("pago de la tarjeta por PSE", () => {
    const r = parseWithRules(rappiMail("Comprobante de pago", "Comprobante de pago\n[image: 540x153x1] \n  \nHola, NOMBRE \n  \nRecibimos el pago de tu tarjeta y lo estamos procesando. \nSigue disfrutando todos los beneficios de tu RappiCard. \n  \n\nDestino de pago\n\n*4444\n------------------------------\n\nFecha y hora\n\n31 oct 2026 03:17\n------------------------------\n\nMétodo de pago\n\nPSE\n------------------------------\n\nMonto\n\n2.000.000,69\nCashback \n[image: 180x180] \n¡Gracias por estar al día con el pago de tu deuda!\n\nDesde que tienes tu RappiCard, has ganado en total 1.876,07 cashback"));
    expect(r.parsed).toMatchObject({ kind: "CARD_PAYMENT", amount: 2000001, merchant: "RappiCard", last4: "4444", occurredAt: "2026-10-31T08:17:00.000Z" });
  });

  it("el extracto no es un movimiento", () => {
    expect(parseWithRules(rappiMail("¡Llegó el extracto de tu RappiCard!", "Ya puedes consultar tu extracto")).parsed?.kind).toBe("IGNORE");
  });
});
