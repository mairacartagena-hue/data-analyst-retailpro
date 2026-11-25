// BBVA Colombia: notificaciones de la app, correos de bbvanet.com.co y avisos de Bre-B.
// Formatos de mensajes reales (octubre y noviembre 2026).

import type { BankParser, ParsedEvent } from "../types";
import { bogotaIso, eventText, findDate, parseAmountCo } from "../normalize";

const AMOUNT = "\\$\\s?([\\d][\\d.,]*\\d)";

/** Fecha y hora de los correos de BBVA: "Fecha de la operación: 2026-10-30 … Hora: 08:51". Sin hora no se arriesga una fecha. */
function emailDate(text: string): string | null {
  const d = /fecha de la operaci[oó]n:?\**\s*(\d{4})-(\d{2})-(\d{2})/i.exec(text);
  const h = /\bhora:?\**\s*(\d{1,2}):(\d{2})/i.exec(text);
  return d && h ? bogotaIso(+d[1], +d[2], +d[3], +h[1], +h[2]) : null;
}

export const bbvaParser: BankParser = {
  id: "bbva",
  institution: "BBVA",
  matches: (ev) => /bbva/i.test(ev.source) || /\bbbva\b/i.test(eventText(ev)),
  parse: (ev) => {
    const text = eventText(ev).replace(/\s+/g, " ");
    // Avisos de seguridad (ingreso a la app, cambio de clave…): no son movimientos
    if (/ingresaste a la app|ingreso a app/i.test(text)) return { kind: "IGNORE", ignoreReason: "Aviso de ingreso a la app" };
    const base = { institution: "BBVA" } satisfies Partial<ParsedEvent>;
    let m: RegExpExecArray | null;

    // Hola, realizaste una compra por $16,900.00 en Google *play yout con tu tarjeta BBVA *0602. El 2026-10-23 a las 12:51.
    m = new RegExp(`realizaste una compra por\\s+${AMOUNT}\\s+en\\s+(.+?)\\s+con tu tarjeta(?:\\s+bbva)?\\s*\\*?(\\d{4})`, "i").exec(text);
    if (m) return { ...base, kind: "PURCHASE", amount: parseAmountCo(m[1]) ?? undefined, merchant: m[2], last4: m[3], occurredAt: findDate(text) };

    // Correo "Compra Exitosa": *Tarjeta terminada en:* *5367 - *Fecha de la operación:* 2026-10-30 - *Establecimiento:* Mercado pago*merc - *Valor:* $116,361.00 - *Hora:* 08:51
    m = new RegExp(`tarjeta terminada en:?\\**\\s*\\**(\\d{4}).*?establecimiento:?\\**\\s*(.+?)\\s+-\\s+\\**valor:?\\**\\s*${AMOUNT}`, "i").exec(text);
    if (m) return { ...base, kind: "PURCHASE", amount: parseAmountCo(m[3]) ?? undefined, merchant: m[2], last4: m[1], occurredAt: emailDate(text) };

    // Avance de la tarjeta de crédito a una cuenta: se ve como transferencia desde la tarjeta (sube la deuda y entra plata a la cuenta).
    // App: ¡Avance exitoso! Realizaste un avance de tu tarjeta de crédito terminada en *5367 a tu cuenta terminada en *7480 por valor de $10,000.00 el 2026-11-20 a las 16:14.
    m = new RegExp(`avance de tu tarjeta de cr[eé]dito terminada en\\s*\\*?(\\d{4})\\s+a tu cuenta terminada en\\s*\\*?(\\d{4})\\s+por valor de\\s+${AMOUNT}`, "i").exec(text);
    if (m) return avance(m[1], m[2], m[3], findDate(text));
    // Correo: Tipo de transacción: Avance de tarjeta *Tarjeta terminada en:* *5367 *Cuenta destinoterminada en:* *7480 *Fecha de la operación:* … *Valor:* $10,000.00 *Hora:* 16:14
    m = /tipo de transacci[oó]n:?\**\s*avance de tarjeta.*?tarjeta terminada en:?\**\s*\**(\d{4}).*?cuenta destino\s*terminada en:?\**\s*\**(\d{4})/i.exec(text);
    const value = new RegExp(`\\bvalor:?\\**\\s*${AMOUNT}`, "i").exec(text);
    if (m && value) return avance(m[1], m[2], value[1], emailDate(text));

    // Pago de la tarjeta de crédito (correo). Dos redacciones; en la segunda solo llegan 2 dígitos de la tarjeta, que no sirven para ubicarla.
    // …el día 2026-11-04 a las 17:56, realizaste exitosamente el pago de tu Tarjeta de Crédito No.XXXX5367 a través del servicio PSE, por un valor de $1,814,051.26 en BBVA móvil.
    // …el día 2026-11-05 a las 18.18 realizaste un pago de Tarjeta de Credito No. 67 por un valor de $7,302.31, a través de nuestro servicio de BBVA Net.
    m = new RegExp(
      `el d[ií]a (\\d{4})-(\\d{2})-(\\d{2}) a las (\\d{1,2})[:.](\\d{2}),?\\s+realizaste (?:exitosamente )?(?:el|un) pago de (?:tu )?tarjeta de cr[eé]dito no\\.?\\s*x*(\\d*).*?por un valor de\\s+${AMOUNT}`,
      "i",
    ).exec(text);
    if (m) {
      return {
        ...base,
        kind: "CARD_PAYMENT",
        amount: parseAmountCo(m[7]) ?? undefined,
        last4: m[6].length === 4 ? m[6] : null,
        occurredAt: bogotaIso(+m[1], +m[2], +m[3], +m[4], +m[5]),
      };
    }

    // Bre-B enviado (app): Tu envío con llave fue exitoso 2026/11/20 16:14 NOMBRE recibió el valor de $ 990.000,00 que enviaste a su llave *****3945 registrada en Nequi.
    m = new RegExp(`tu env[ií]o con llave fue exitoso.*?\\d{1,2}:\\d{2}\\s+(.+?)\\s+recibi[oó] el valor de\\s+${AMOUNT}`, "i").exec(text);
    if (m) return { ...base, kind: "TRANSFER_OUT", amount: parseAmountCo(m[2]) ?? undefined, merchant: m[1], occurredAt: findDate(text) };
    // Bre-B enviado (correo): *Detalles de la operación* Fecha y hora *2026/11/20 16:14* Valor enviado *$ 990.000,00* Persona que recibe *NOMBRE* Entidad que recibe *Nequi*
    m = new RegExp(`valor enviado[\\s*:]*${AMOUNT}[\\s*]*persona que recibe[\\s*:]*(.+?)[\\s*]*entidad que recibe`, "i").exec(text);
    if (m) return { ...base, kind: "TRANSFER_OUT", amount: parseAmountCo(m[1]) ?? undefined, merchant: m[2], occurredAt: findDate(text) };

    return null;
  },
};

function avance(card: string, destination: string, amount: string, occurredAt: string | null): ParsedEvent {
  return {
    kind: "TRANSFER_OUT",
    amount: parseAmountCo(amount) ?? undefined,
    merchant: `Avance a cuenta ···${destination}`,
    last4: card,
    institution: "BBVA",
    occurredAt,
    identifiers: [],
  };
}
