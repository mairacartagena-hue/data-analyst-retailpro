import { describe, expect, it } from "vitest";
import { parseWithRules } from "@/lib/ingest/registry";
import type { Channel, RawEvent } from "@/lib/ingest/types";

// Textos reales de noviembre 2026 (con números largos y enlaces ya enmascarados).
const app = (source: string, title: string, text: string): RawEvent => ({ channel: "ANDROID_NOTIFICATION" as Channel, source, title, text, receivedAt: "2026-11-20T21:20:00.000Z" });
const mail = (source: string, subject: string, text: string): RawEvent => ({ channel: "GMAIL", source, subject, text, receivedAt: "2026-11-20T21:20:00.000Z" });
const bbvaMail = (subject: string, text: string) => mail("BBVA <BBVA@bbvanet.com.co>", subject, text);
const bancolombiaMail = (text: string) => mail("alertasynotificaciones@ayn.notificacionesbancolombia.com", "Alertas y Notificaciones", text);

describe("BBVA: correos y avisos nuevos", () => {
  it("correo de compra exitosa con el establecimiento y la hora", () => {
    const r = parseWithRules(
      mail(
        "BBVA@bbvanet.com.co",
        "Compra Exitosa",
        "Si no puedes ver este correo accede a la versión Web *Hola,* *Mayra Julieth* *Ref:12345678* En BBVA nos transformamos para poner en tus manos todas las oportunidades del mundo. A continuación encuentras el comprobante de la transacción que realizaste. *Detalles de la operación:* - *Tarjeta terminada en:* *5367 - *Fecha de la operación:* 2026-10-30 - *Establecimiento:* Mercado pago*merc - *Valor:* $116,361.00 - *Hora:* 08:51 Gracias por utilizar nuestros Canales Transaccionales.",
      ),
    );
    expect(r.parser).toBe("bbva");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 116361, last4: "5367", institution: "BBVA", occurredAt: "2026-10-30T13:51:00.000Z" });
    expect(r.parsed?.merchant).toBe("Mercado pago");
  });

  it("avance de la tarjeta de crédito: aviso de la app", () => {
    const r = parseWithRules(app("BBVA Colombia", "¡Avance exitoso!", "Realizaste un avance de tu tarjeta de crédito terminada en *5367 a tu cuenta terminada en *7480 por valor de $10,000.00 el 2026-11-20 a las 16:14."));
    expect(r.parser).toBe("bbva");
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_OUT", amount: 10000, last4: "5367", institution: "BBVA", occurredAt: "2026-11-20T21:14:00.000Z" });
    expect(r.parsed?.merchant).toContain("7480");
  });

  it("avance de la tarjeta de crédito: correo", () => {
    const r = parseWithRules(
      bbvaMail(
        "BBVA Móvil - Notificación Avances de Tarjetas de Crédito",
        "Ref: <12345678> *HolaEstamos contigo en cada paso, por eso te informamos el resumen de tu transacción.* *Tipo de transacción:* Avance de tarjeta *Tarjeta terminada en:* *5367 *Cuenta destinoterminada en:* *7480 *Fecha de la operación:* 2026-11-20 *Valor:* $10,000.00 *Hora:* 16:14 *Recuerda que:* Nunca te contactaremos solicitando tus claves o códigos de activación.",
      ),
    );
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_OUT", amount: 10000, last4: "5367", occurredAt: "2026-11-20T21:14:00.000Z" });
    expect(r.parsed?.merchant).toContain("7480");
  });

  it("pago de la tarjeta por PSE: trae los 4 últimos dígitos", () => {
    const r = parseWithRules(
      bbvaMail(
        "BBVA Notificación Pago de Tarjetas Crédito",
        "BBVA Ref: 1196142 *Estimado (a) Cliente:* Te informamos que el día 2026-11-04 a las 17:56, realizaste exitosamente el pago de tu Tarjeta de Crédito No.XXXX5367 a través del servicio PSE, por un valor de $1,814,051.26 en BBVA móvil. Gracias por utilizar nuestros Canales transaccionales.",
      ),
    );
    expect(r.parsed).toMatchObject({ kind: "CARD_PAYMENT", amount: 1814051, last4: "5367", institution: "BBVA", occurredAt: "2026-11-04T22:56:00.000Z" });
  });

  it("pago de la tarjeta por BBVA Net: solo 2 dígitos, no se usan como últimos 4", () => {
    const r = parseWithRules(
      mail(
        "BBVA@bbvanet.com.co",
        "BBVA net - Pagos Tarjeta de Credito",
        "BBVA Ref: 11961429 *Estimado (a) Cliente:* Te informamos que el día 2026-11-05 a las 18.18 realizaste un pago de Tarjeta de Credito No. 67 por un valor de $7,302.31, a través de nuestro servicio de BBVA Net . Gracias por utilizar nuestros Canales transaccionales.",
      ),
    );
    expect(r.parsed).toMatchObject({ kind: "CARD_PAYMENT", amount: 7302, last4: null, occurredAt: "2026-11-05T23:18:00.000Z" });
  });

  it("Bre-B enviado: aviso de la app", () => {
    const r = parseWithRules(
      app("BBVA Colombia", "Tu envío con llave fue exitoso", "2026/11/20 16:14 FLOREYCY TELLO SERNA recibió el valor de $ 990.000,00 que enviaste a su llave *****3945 registrada en Nequi. Si no reconoces la operación, comunícate al 01 8000 912 227."),
    );
    expect(r.parser).toBe("bbva");
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_OUT", amount: 990000, merchant: "Floreycy Tello Serna", institution: "BBVA", occurredAt: "2026-11-20T21:14:00.000Z" });
  });

  it("Bre-B enviado: correo de notificacionesBreB", () => {
    const r = parseWithRules(
      mail(
        "notificacionesBreB@bbva.com",
        "Tu envío con llave fue exitoso",
        "Tu envío con llave fue exitoso [image: BBVA Logo] *El envío se completó correctamente* Mayra julieth Cartagena tello , tu envío a través de Bre-B fue exitoso. La llave *****3945 recibió el valor que le enviaste. *Detalles de la operación* Fecha y hora *2026/11/20 16:14* Valor enviado *$ 990.000,00* Persona que recibe *FLOREYCY TELLO SERNA* Entidad que recibe *Nequi*",
      ),
    );
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_OUT", amount: 990000, merchant: "Floreycy Tello Serna", occurredAt: "2026-11-20T21:14:00.000Z" });
  });

  it("Bre-B que no se pudo hacer se ignora", () => {
    const r = parseWithRules(app("BBVA Colombia", "No fue posible realizar tu envío desde Bre-B", "2026/11/20 16:13 El envío a FLOREYCY TELLO SERNA por $ 1.000.000,00 a su llave *****3945 registrada en Nequi no fue exitoso. Si no reconoces la operación, comunícate al 01 8000 912 227."));
    expect(r.parsed).toMatchObject({ kind: "IGNORE", ignoreReason: "Transacción no aprobada" });
  });

  it("la compra de la app sigue funcionando", () => {
    const r = parseWithRules(app("BBVA Colombia", "Compra Exitosa", "Hola, realizaste una compra por $16,900.00 en Dlo*google crunch con tu tarjeta BBVA *0602. El 2026-11-23 a las 12:48."));
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 16900, last4: "0602", occurredAt: "2026-11-23T17:48:00.000Z" });
  });
});

describe("Nequi: avisos nuevos", () => {
  it("compra con la Tarjeta Nequi (app)", () => {
    const r = parseWithRules(app("Nequi Colombia", "Compra exitosa con Tarjeta Nequi", "Pagaste 63.490,00 en GOOGLE *Claude by Anth"));
    expect(r.parser).toBe("nequi");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 63490, institution: "Nequi" });
    expect(r.parsed?.merchant).toBe("Claude by Anth");
  });

  it("compra con la Tarjeta Nequi (SMS que llega por Mensajes)", () => {
    const r = parseWithRules(app("Mensajes", "", "⁨890806⁩ NEQUI: Pagaste 63.490,00 en GOOGLE *Claude by Anth"));
    expect(r.parser).toBe("nequi");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 63490 });
  });

  it("pago por PSE", () => {
    const r = parseWithRules(app("Nequi Colombia", "Pago exitoso por PSE", "Hiciste un pago en FONDO DE INVERSIÓN COLECTIVA ACCIVAL VISTA por $73.500 y todo salió bien."));
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 73500, institution: "Nequi" });
    expect(r.parsed?.merchant).toMatch(/accival vista/i);
  });

  it("envío de plata exitoso", () => {
    const r = parseWithRules(app("Nequi Colombia", "Envío de plata exitoso", "Te contamos que el envío de plata por $110.000 fue exitoso. Puedes revisar en tus movimientos el detalle del envío."));
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_OUT", amount: 110000, institution: "Nequi" });
  });

  it("'Tu plata llegó' confirma un envío que ya se avisó: se ignora", () => {
    const r = parseWithRules(app("Nequi Colombia", "Tu plata llegó con éxito 💜", "Envío exitoso, la plata ya está en el Nequi destino.✈ Recuerda que no se puede cancelar. Avísale a tu amigo que ya le llegó. ✨"));
    expect(r.parsed).toMatchObject({ kind: "IGNORE", ignoreReason: "Confirmación de envío" });
  });

  it("el código de autenticación del SMS sigue ignorándose", () => {
    const r = parseWithRules(app("Mensajes", "", "⁨890806⁩ NEQUI: 145049 es tu codigo de autenticacion para conectar tu Tarjeta Nequi a Google Pay. Por seguridad no lo compartas. Codigo valido por 5 minutos."));
    expect(r.parsed).toMatchObject({ kind: "IGNORE" });
  });

  it("recibir plata sigue funcionando", () => {
    const r = parseWithRules(app("Nequi Colombia", "Envío", "JUAN PEREZ te envió 300000, ¡lo mejor!"));
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_IN", amount: 300000, merchant: "Juan Perez" });
  });
});

describe("Bancolombia: formatos nuevos de noviembre", () => {
  it("transferencia recibida con el monto antes del nombre (SMS)", () => {
    const r = parseWithRules(app("Mensajes", "", "⁨85540⁩ Bancolombia: Recibiste una transferencia por $1,050,000 de YOLIMA CAMPAZ en tu cuenta **2505, el 18/11/2026 a las 19:36. Si tienes dudas, hablemos: 6045109095. Siempre a tu lado."));
    expect(r.parser).toBe("bancolombia");
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_IN", amount: 1050000, merchant: "Yolima Campaz", last4: "2505", occurredAt: "2026-11-19T00:36:00.000Z" });
  });

  it("transferencia recibida con el monto antes del nombre (correo)", () => {
    const r = parseWithRules(bancolombiaMail("¡Listo! Todo salió bien con tus movimientos Bancolombia: Recibiste una transferencia por $1,050,000 de YOLIMA CAMPAZ en tu cuenta **2505, el 18/11/2026 a las 19:36. Si tienes dudas, hablemos: 6045109095. Siempre a tu lado."));
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_IN", amount: 1050000, last4: "2505" });
  });

  it("pago con código QR", () => {
    const r = parseWithRules(bancolombiaMail("¡Listo! Todo salió bien con tus movimientos *Bancolombia: MAYRA JULIETH CARTAGENA TELLO pagaste $160,611.00 por codigo QR desde tu cuenta *2505 a la llave 3001234567 el 08/11/2026 a las 18:14. Con codigo QR es facil y de una. Dudas al 6045109095.*"));
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 160611, last4: "2505", occurredAt: "2026-11-08T23:14:00.000Z" });
    expect(r.parsed?.identifiers).toEqual([{ type: "PHONE", value: "3001234567" }]);
  });

  it("transferencia por Bre-B con llave (SMS) sigue funcionando", () => {
    const r = parseWithRules(app("Mensajes", "", "⁨85540⁩ Bancolombia: MAYRA, transferiste $1,000.00 a la llave 3001234567 desde tu cuenta *2505 a OSCAR STEVEN SOLARTE CARDONA el 13/11/26 a las 21:52. Con Bre-b es de una y gratis. Dudas al 6045109095."));
    expect(r.parsed).toMatchObject({ kind: "TRANSFER_OUT", amount: 1000, last4: "2505", merchant: "Oscar Steven Solarte Cardona" });
  });
});

describe("Pasarelas de pago", () => {
  const miPagoAmigo = (estado: string) =>
    mail(
      "notificador@bancocajasocial.com",
      "Pago exitoso en el Portal MiPagoAmigo ID:32.12345678",
      `*Resumen de su transacción* Su transacción fue ${estado} Número de transacción *APIE12345678* ------------------------------ *Medio de pago* Banco: BANCOLOMBIA CUS: 12345678 Dirección IP: 38.199.89.108 Estado: ${estado === "aprobada" ? "Aprobada" : "Rechazada"} ------------------------------ *Resumen de pago* Fecha y hora: 2 de noviembre de 2026-21:40hrs. Número de transacción: APIE12345678 Nombre del servicio: CREDITOS DE CONSUMO NIT de la empresa: 12345678 Dirección: Ciudad: COBERTURA NACIONAL Numero de producto: 12345678 Celular: 3001234567 Valor: *$ $224.506,94* ------------------------------ Cualquier inquietud comuníquese a la *Línea Amiga 601 542 6446*`,
    );

  it("MiPagoAmigo aprobado: monto, servicio, banco de origen y hora", () => {
    const r = parseWithRules(miPagoAmigo("aprobada"));
    expect(r.parser).toBe("pasarelas");
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 224507, institution: "Bancolombia", occurredAt: "2026-11-03T02:40:00.000Z" });
    expect(r.parsed?.merchant).toMatch(/creditos de consumo/i);
  });

  it("MiPagoAmigo rechazado no es un movimiento", () => {
    const r = parseWithRules(miPagoAmigo("rechazada"));
    expect(r.parsed).toMatchObject({ kind: "IGNORE" });
  });

  it("PSE rechazado y pago con error de Davivienda se ignoran", () => {
    const pse = parseWithRules(mail("serviciopse@achcolombia.com.co", "PSE - Transacción Rechazada ❌ CUS 12345678", "Bienvenido al sistema Protegido ACH. ¡Hola, Maira Cartagena Tello! Los siguientes son los datos de tu transacción: Valor: $ 1.043.000,00 Empresa: Banco Davivienda S.A. (Zona Pagos) Descripción: DAVIVIENDAPORTAL Fecha de la transacción: 24/11/2026"));
    expect(pse.parsed).toMatchObject({ kind: "IGNORE", ignoreReason: "Transacción no aprobada" });
    const davi = parseWithRules(mail("Portal Pagos <pagosenlinea@davivienda.com>", "Pago con error", "Pago en error Estimado(a) cliente parece que algo salió mal con su pago. Lo sentimos, no pudimos procesar la transacción. Resumen *Davivienda Cartera Creditos* Concepto: *Pagos* Valor total: *$ 1,043,000.00*"));
    expect(davi.parsed).toMatchObject({ kind: "IGNORE", ignoreReason: "Transacción no aprobada" });
  });
});

describe("Nequi: el título pegado al cuerpo", () => {
  it("también lee la compra si llega todo en el cuerpo", () => {
    const r = parseWithRules(app("Nequi Colombia", "", "Compra exitosa con Tarjeta Nequi Pagaste 63.490,00 en GOOGLE *Claude by Anth"));
    expect(r.parsed).toMatchObject({ kind: "PURCHASE", amount: 63490, merchant: "Claude by Anth" });
  });
});
