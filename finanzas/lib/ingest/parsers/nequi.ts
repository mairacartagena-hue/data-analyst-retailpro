// Nequi: notificaciones de la app (fuente "Nequi Colombia"). Formatos de mensajes reales (octubre 2026):
//   título: "Crédito Nequi: ¡Pago exitoso!"  texto: "Pagaste tu cuota por $84.493,07 el día 28 de Octubre de 2026."
//   título: "Envío"                          texto: "ALIRIO SABOGAL te envió 300000, ¡lo mejor!"
// El texto de la notificación va sin el título: el título ("Envío") no debe confundirse con el nombre de quien envía.

import type { BankParser, ParsedEvent } from "../types";
import { bogotaIso, fold, parseAmountCo } from "../normalize";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const nequiParser: BankParser = {
  id: "nequi",
  institution: "Nequi",
  matches: (ev) => /nequi/i.test(ev.source),
  parse: (ev) => {
    const body = ev.text.replace(/\s+/g, " ").trim();
    const base = { institution: "Nequi" } satisfies Partial<ParsedEvent>;
    let m: RegExpExecArray | null;

    // Pagaste tu cuota por $84.493,07 el día 28 de Octubre de 2026.
    // La cuota de un crédito Nequi sale de la cuenta; la fecha viene sin hora.
    m = /pagaste tu cuota por\s+\$\s?([\d][\d.,]*\d)\s+el d[ií]a\s+(\d{1,2}) de (\w+) de (\d{4})/i.exec(body);
    if (m) {
      const month = MONTHS.indexOf(fold(m[3])) + 1;
      return { ...base, kind: "PURCHASE", amount: parseAmountCo(m[1]) ?? undefined, merchant: "Crédito Nequi", occurredAt: bogotaIso(+m[4], month, +m[2]) };
    }

    // ALIRIO SABOGAL te envió 300000, ¡lo mejor!
    m = /^(.+?)\s+te envi[oó]\s+\$?\s?([\d][\d.,]*\d|\d)\b/i.exec(body);
    if (m) return { ...base, kind: "TRANSFER_IN", amount: parseAmountCo(m[2]) ?? undefined, merchant: m[1] };

    return null;
  },
};
