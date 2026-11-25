import { describe, expect, it } from "vitest";
import {
  MAX_MERCHANT, cleanMerchant, detectIgnore, dropUnfilled, findDate, findDateEs, findAmount, findIdentifiers, findLast4, guessInstitution, maskSensitive, normalizeMerchant, parseAmountCo,
} from "@/lib/ingest/normalize";
import { parseWithRules } from "@/lib/ingest/registry";
import { isNoMovementSender, senderEmail } from "@/lib/ingest/senders";
import type { RawEvent } from "@/lib/ingest/types";

const ev = (text: string, source = "Bancolombia"): RawEvent => ({ channel: "ANDROID_NOTIFICATION", source, text, receivedAt: "2026-10-24T15:00:00.000Z" });

describe("montos colombianos", () => {
  it("separadores de miles y centavos", () => {
    expect(parseAmountCo("1.250.000")).toBe(1250000);
    expect(parseAmountCo("45,000.00")).toBe(45000);
    expect(parseAmountCo("20.000,50")).toBe(20001);
    expect(parseAmountCo("1.234")).toBe(1234);
    expect(parseAmountCo("$ 300")).toBe(300);
    expect(parseAmountCo("abc")).toBeNull();
  });

  it("encuentra el monto en un texto", () => {
    expect(findAmount("Pagaste $45.000 en ÉXITO")).toBe(45000);
    expect(findAmount("valor COP 1.200.000,00")).toBe(1200000);
    expect(findAmount("sin monto")).toBeNull();
  });
});

describe("comercios", () => {
  it("quita pasarelas, ciudad y códigos", () => {
    expect(cleanMerchant("PAYU*RAPPI COLOMBIA")).toBe("Rappi Colombia");
    expect(cleanMerchant("MERCADOPAGO*TIENDA XYZ BOGOTA CO")).toBe("Tienda Xyz");
    expect(cleanMerchant("GOOGLE *YouTube")).toBe("YouTube");
    expect(cleanMerchant("  ")).toBeNull();
    expect(cleanMerchant("Wompi SAS")).toBe("Wompi");
    expect(cleanMerchant("S.A.S")).toBe("S.A.S");
  });

  it("normaliza para comparar", () => {
    expect(normalizeMerchant("PAYU*Éxito Colina")).toBe("exito colina");
    expect(normalizeMerchant("Éxito colina")).toBe("exito colina");
  });
});

describe("tarjeta, identificadores y privacidad", () => {
  it("últimos 4 dígitos", () => {
    expect(findLast4("tarjeta *1234 por")).toBe("1234");
    expect(findLast4("terminada en 9876")).toBe("9876");
    expect(findLast4("sin tarjeta")).toBeNull();
  });

  it("celular y NIT", () => {
    expect(findIdentifiers("Enviaste a 3001234567")).toEqual([{ type: "PHONE", value: "3001234567" }]);
    expect(findIdentifiers("NIT 900.123.456-7")).toEqual([{ type: "NIT", value: "900123456-7" }]);
  });

  it("nunca envía números completos a Gemini", () => {
    const masked = maskSensitive("Cuenta 1234567890123 celular 3001234567 por $45.000 a juan@correo.com");
    expect(masked).not.toMatch(/1234567890123|3001234567|juan@/);
    expect(masked).toContain("****0123");
    expect(masked).toContain("$45.000");
  });
});

describe("reglas de ignorar", () => {
  it("códigos, rechazos y publicidad", () => {
    expect(detectIgnore("Tu código de verificación es 123456")).toBe("Código o clave");
    expect(detectIgnore("La compra por $20.000 fue rechazada")).toBe("Transacción no aprobada");
    expect(detectIgnore("Aprovecha 30% de descuento este fin de semana")).toBe("Publicidad");
    expect(detectIgnore("Compraste $45.000 en Éxito")).toBeNull();
    // Promoción de Nequi: no es una compra de $45.000 aunque traiga monto y "compras"
    expect(detectIgnore("Haz 5 compras con tu Tarjeta Nequi Visa, mantén tu racha y participa por hasta $45.000 COP. ¡Que no se corte! Aplican TyC. Válido hasta el 01/11/2026.")).toBe("Publicidad");
    // Así llegó en la base de datos: con doble espacio después del número
    expect(detectIgnore("[notification_title]\nHaz 5  compras con tu Tarjeta Nequi Visa, mantén tu racha y participa por hasta $45.000 COP. ¡Que no se corte! Aplican TyC. Válido hasta el")).toBe("Publicidad");
    expect(detectIgnore("Compraste $45.000 en Éxito. Aplican TyC")).toBeNull();
    // Avisos de inicio de sesión (BBVA por correo, Nequi, banca virtual)
    for (const msg of [
      "Importante: Confirmación de ingreso en nuestros canales digitales. Acabas de ingresar a tu App BBVA el 26/10/2026",
      "¿Iniciaste otra sesión en tu App BBVA?, confirma esta información. Has ingresado nuevamente a la App BBVA. Tipo de operación: Ingreso App BBVA",
      "Iniciaste sesión en tu Nequi desde la web",
      "Inicio de sesión Banca Virtual",
    ]) expect(detectIgnore(msg)).toBe("Aviso de inicio de sesión");
    expect(detectIgnore("Recibiste un ingreso de $1.200.000 en tu cuenta")).toBeNull();
    expect(detectIgnore("BBVA te informa que ingresaste a la Net el 2026-10-26 a las 09:57")).toBe("Aviso de inicio de sesión");
    expect(detectIgnore("BBVA te informa que estas intentando realizar un Olvido de Contraseña, el 2026-10-26 a las 09:56")).toBe("Aviso de seguridad");
  });

  it("la entidad sale de la app o el remitente", () => {
    expect(guessInstitution(ev("x", "Nequi"))).toBe("Nequi");
    expect(guessInstitution(ev("x", "com.google.android.apps.walletnfcrel"))).toBe("Google Wallet");
  });

  it("sin parser del banco todavía: queda para Gemini o como no reconocido", () => {
    expect(parseWithRules(ev("Compraste $45.000 en Éxito")).parsed).toBeNull();
    expect(parseWithRules(ev("Tu clave dinámica es 1234")).parsed?.kind).toBe("IGNORE");
  });
});

describe("fechas con el mes escrito", () => {
  it("Lulo y RappiCard", () => {
    expect(findDateEs("Fecha 22 de octubre de 2026 Hora 5:41 p.m.")).toBe("2026-10-22T22:41:00.000Z");
    expect(findDateEs("Fecha 31 oct. 2026 Hora 8:19 a.m.")).toBe("2026-10-31T13:19:00.000Z");
    expect(findDateEs("31 oct 2026 03:17")).toBe("2026-10-31T08:17:00.000Z");
    expect(findDateEs("Fecha 5 de enero de 2026 Hora 12:05 a.m.")).toBe("2026-01-05T05:05:00.000Z");
    expect(findDateEs("Fecha 5 de enero de 2026 Hora 12:05 p.m.")).toBe("2026-01-05T17:05:00.000Z");
    // El número de comprobante seguido de "CUS 7871…" no es una fecha
    expect(findDateEs("No. comprobante 1234567890123456 CUS 100000001 Fecha 31 oct. 2026 Hora 8:19 a.m.")).toBe("2026-10-31T13:19:00.000Z");
    expect(findDateEs("sin fecha")).toBeNull();
    expect(findDateEs("10 de algo de 2026")).toBeNull();
  });
});

describe("variables de MacroDroid sin reemplazar", () => {
  it("se quitan de la app, el título y el texto", () => {
    expect(dropUnfilled("[app_name]")).toBe("");
    expect(dropUnfilled("{not_title}\nTe enviaron $20.000")).toBe("Te enviaron $20.000");
    expect(dropUnfilled("[notification_title]\nANA GOMEZ te envió 300000")).toBe("ANA GOMEZ te envió 300000");
    expect(dropUnfilled("Nequi")).toBe("Nequi");
    expect(dropUnfilled("Compraste $45.000 [ref] en Éxito")).toBe("Compraste $45.000 [ref] en Éxito");
  });
});

describe("nombres de comercio desmedidos", () => {
  it("se cortan a 60 caracteres sin partir palabras (ej. el lector de respaldo copió medio correo)", () => {
    const junk = "Davivienda Cartera Creditos " + "otros servicios ".repeat(60);
    const out = cleanMerchant(junk)!;
    expect(out.length).toBeLessThanOrEqual(MAX_MERCHANT);
    expect(out.startsWith("Davivienda Cartera Creditos")).toBe(true);
    expect(out.endsWith(" ")).toBe(false);
  });

  it("un nombre normal no cambia", () => {
    expect(cleanMerchant("Banco De Bogotá - Crédito Hipotecario")).toBe("Banco De Bogotá - Crédito Hipotecario");
  });
});

describe("fecha año/mes/día con barras (PSE y Bre-B)", () => {
  it("no confunde 2026/11/16 con día/mes/año (antes quedaba en 2016)", () => {
    expect(findDate("Tu pago por PSE fue aprobado el 2026/11/16 20:27:25 por valor de $10,000.00 Banco de Bogota")).toBe("2026-11-17T01:27:25.000Z");
    expect(findDate("Tu envío con llave fue exitoso 2026/11/20 16:14 NOMBRE APELLIDO recibió")).toBe("2026-11-20T21:14:00.000Z");
  });

  it("día/mes/año sigue igual", () => {
    expect(findDate("el 22/10/2026 a las 14:10")).toBe("2026-10-22T19:10:00.000Z");
    expect(findDate("el 10:07 a las 23/10/2026")).toBe("2026-10-23T15:07:00.000Z");
  });
});

describe("Google Wallet con el espacio duro del celular", () => {
  const NB = "Billetera de\u00A0Google";
  const wallet = (text: string, title: string): RawEvent => ({ ...ev(text, NB), title });

  it("lee el pago con reglas, sin Gemini", () => {
    const a = parseWithRules(wallet("$ 137.700,00 con Tarjeta Nequi Visa ••6867", "AGROVENTAS NORTE"));
    expect(a.parser).toBe("google-wallet");
    expect(a.parsed).toMatchObject({ kind: "PURCHASE", amount: 137700, last4: "6867" });
    const b = parseWithRules(wallet("COP 27,800.00 con Visa Platinum ••5367", "JUAN VALDEZ CHIPICHAPE"));
    expect(b.parsed).toMatchObject({ kind: "PURCHASE", amount: 27800, last4: "5367" });
  });

  it("los avisos de la billetera que no son pagos se ignoran", () => {
    expect(parseWithRules(wallet("Crea un número de tarjeta virtual para Visa ••6182 en unos pocos pasos", "Compra con más seguridad")).parsed?.kind).toBe("IGNORE");
    expect(parseWithRules(wallet("Agregaremos la ubicación a tu recibo", "Preparando tu recibo")).parsed?.kind).toBe("IGNORE");
  });
});

describe("avisos que se descartan sin llamar a Gemini", () => {
  const casos: Record<string, string[]> = {
    "Código o clave": [
      "98765 es tu codigo de autenticacion para conectar tu Tarjeta Nequi a Google Pay. Por seguridad no lo compartas. Codigo valido por 5 minutos.",
      "Código de autenticación 123456 es tu código de autenticación para conectar tu Tarjeta Nequi. Para más info, ingresa acá.",
    ],
    "Aviso de seguridad": [
      "Activaste tu Token Digital con éxito Hola, MAYRA acabas de activar tu Token Digital con éxito en la App BBVA Tipo de operación: Activación Token Digital Fecha de la operación: 2026-10-31 Hora: 22:14",
      "Agregaste con éxito tu tarjeta a Google Pay Hola, MAYRA Ref: 1 Tarjeta terminada en: *5367",
      "Eliminaste tu tarjeta de Google Pay Hola, MAYRA Tarjeta terminada en: *5367 Fecha: 2026-10-26",
      "Autorizaste el uso de tu foto",
    ],
    "Notificación sin contenido": ["Se ocultó contenido sensible de la notificación"],
    "Transacción no aprobada": [
      "No fue posible realizar tu envío desde Bre-B 2026/11/20 16:13 El envío a NOMBRE APELLIDO por $ 1.000.000,00 a su llave *****3945 registrada en Nequi no fue exitoso.",
      "Pago con error Pago en error Estimado(a) cliente parece que algo salió mal con su pago. Lo sentimos, no pudimos procesar la transacción. Valor total: $ 1,043,000.00",
      "Bancolombia: tu compra en PATREON  MEMBERSHIP   DU por COP22.387,73 no fue exitosa, el cupo de tu T.Credito *1234 no se afecto. 22:01.16/11/2026.",
      "RappiCard | ¡Ups! Tarjeta congelada ❄️ ¡Congelaste tu tarjeta y no pudimos completar tu compra! Descongélala desde tu app y completa tu compra por $23.984",
      "El envío no se completó Mayra, tu envío a través de Bre-B no se pudo completar, pero no te preocupes: el valor no fue debitado. Valor no enviado $ 1.000.000,00",
    ],
    "Publicidad": [
      "Temu: Descubre el trato: 3 x $10. Selecciona tres productos y paga solo $10. app.temu.com/t/9nRLfqHA Cancelar suscripcion: app.temu.com/t/zp4jRVFA",
      "Black Days Cruz Verde: Hasta 50% OFF en Salud Digestiva, Suplementos, Dermo y mas. Aqui https://ma.sv/Q5MvoBR o 123 TyC https://ma.sv/x",
      "Lulo bank: podrias tener ya mismo $15,000,000 en tu cuenta sin filas ni codeudor. Desembolsa tu credito y paga cuotas mensuales desde $464,859",
      "Tienes hasta $15,000,000 para desembolsar Hola, Natalia El 2026 pronto se termina, sácale el jugo",
      "¡Ahorra con tus Puntos BBVA! Paga tu compra en JUAN VALDEZ TJV CHIPICHAPE con Puntos BBVA. Entre más uses tu tarjeta más cerca estás de nuevas experiencias",
      "Trae tu plata de PayPal sin enredos 💸 Con Nequi puedes pasarla a tu disponible fácil y sin vueltas. Todo desde la app. Hazlo aquí",
      "¿Se te acabó el Plus? 😬 Ahora puedes recargar PlayStation en Nequi y volver a la partida cuando tú quieras. 🎮",
      "Entonces es hora de un cambio. 🎮 Entra a Nequi y paga o recarga Xbox, PlayStation o Roblox. 💜 Con Nequi, tus juegos en serio.",
      "Ahora podrás hacer pagos, compras o transacciones por PSE, transferencias a otros bancos y pagar productos BBVA",
    ],
    "Aviso informativo": [
      "Información sobre tu crédito Solo con fines informativos, queremos contarte que cedimos tu crédito con Addi al patrimonio autónomo",
      "Tu extracto del mes. Extracto noviembre Mayra, Conoce la información que necesitas Pago Total: Cuota actual $ 277.052",
      "Tus extractos BBVA Noviembre de 2026",
    ],
  };
  for (const [razon, textos] of Object.entries(casos)) {
    it(razon, () => { for (const t of textos) expect(detectIgnore(t)).toBe(razon); });
  }

  it("los movimientos reales nunca se descartan", () => {
    for (const t of [
      "Compra exitosa con Tarjeta Nequi\nPagaste 63.490,00 en GOOGLE *Claude by Anth",
      "Envío de plata exitoso Te contamos que el envío de plata por $110.000 fue exitoso. Puedes revisar en tus movimientos el detalle del envío.",
      "Tu envío con llave fue exitoso 2026/11/20 16:14 NOMBRE APELLIDO recibió el valor de $ 990.000,00 que enviaste a su llave *****3945 registrada en Nequi. Si no reconoces la operación, comunícate al 01 8000 912 227.",
      "Tu pago por PSE fue aprobado el 2026/11/16 20:27:25 por valor de $10,000.00 Banco de Bogota, si no realizaste esta compra comunicate a la servilinea.",
      "Compra Exitosa Si no puedes ver este correo accede a la versión Web <https://view.email.bbva.com.co/?qs=abc> *Hola,* *Mayra Julieth* A continuación encuentras el comprobante de la transacción que realizaste. *Detalles de la operación:* - *Tarjeta terminada en:* *5367 - *Fecha de la operación:* 2026-11-22 - *Establecimiento:* Homecenter - *Valor:* $50,700.00 - *Hora:* 13:24 Gracias por utilizar nuestros Canales Transaccionales. cambiar periódicamente tus claves de accesos",
      "Bancolombia: Recibiste una transferencia por $1,050,000 de NOMBRE APELLIDO en tu cuenta **2505, el 18/11/2026 a las 19:36. Si tienes dudas, hablemos",
      "Pagaste tu cuota por $84.493,07 el día 28 de Octubre de 2026.",
    ]) expect(detectIgnore(t)).toBeNull();
  });
});

describe("remitentes que nunca traen movimientos", () => {
  it("se reconoce la dirección dentro del nombre", () => {
    expect(senderEmail('"vercel[bot]" <notifications@github.com>')).toBe("notifications@github.com");
    expect(senderEmail("Mensajes")).toBeNull();
  });

  it("marketing, empleo y extractos se descartan; los bancos no", () => {
    for (const s of ["Alertas de empleo de LinkedIn <jobalerts-noreply@linkedin.com>", '"vercel[bot]" <notifications@github.com>', "BBVA <info@email.bbva.com.co>", "EXTRACTOS BBVA <extractos@extractos.bbva.com.co>", '"Fundación Bancolombia- Lumni" <comunidad.rumbo@lumni.net>']) {
      expect(isNoMovementSender(s)).toBe(true);
      expect(parseWithRules({ ...ev("monto $5.000", s), channel: "GMAIL" }).parsed).toMatchObject({ kind: "IGNORE", ignoreReason: "Remitente sin movimientos" });
    }
    for (const s of ["BBVA <BBVA@bbvanet.com.co>", "mep-autorizador-col.group@bbva.com", "Addi <soporte@addi.com>", "Alertas y Notificaciones <alertasynotificaciones@an.notificacionesbancolombia.com>"]) {
      expect(isNoMovementSender(s)).toBe(false);
    }
  });
});
