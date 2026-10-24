// BBVA Colombia: notificaciones de la app (título "Compra Exitosa"). Formatos de mensajes reales (octubre 2026).

import type { BankParser } from "../types";
import { eventText, findDate, parseAmountCo } from "../normalize";

export const bbvaParser: BankParser = {
  id: "bbva",
  institution: "BBVA",
  matches: (ev) => /bbva/i.test(ev.source) || /\bbbva\b/i.test(eventText(ev)),
  parse: (ev) => {
    const text = eventText(ev).replace(/\s+/g, " ");
    // Avisos de seguridad (ingreso a la app, cambio de clave…): no son movimientos
    if (/ingresaste a la app|ingreso a app/i.test(text)) return { kind: "IGNORE", ignoreReason: "Aviso de ingreso a la app" };

    // Hola, realizaste una compra por $16,900.00 en Google *play yout con tu tarjeta BBVA *0602. El 2026-10-23 a las 12:51.
    const m = /realizaste una compra por\s+\$\s?([\d][\d.,]*\d)\s+en\s+(.+?)\s+con tu tarjeta(?:\s+bbva)?\s*\*?(\d{4})/i.exec(text);
    if (m) {
      return {
        kind: "PURCHASE",
        amount: parseAmountCo(m[1]) ?? undefined,
        merchant: m[2],
        last4: m[3],
        institution: "BBVA",
        occurredAt: findDate(text),
      };
    }
    return null;
  },
};
