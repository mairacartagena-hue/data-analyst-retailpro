// Nequi: notificaciones de la app (la fuente llega como "Nequi Colombia"). Formato de avisos reales (octubre 2026).

import type { BankParser } from "../types";
import { parseAmountCo } from "../normalize";

export const nequiParser: BankParser = {
  id: "nequi",
  institution: "Nequi",
  matches: (ev) => /nequi/i.test(ev.source),
  parse: (ev) => {
    // Solo el cuerpo: el título ("Envío") va aparte y no es parte del nombre
    const text = ev.text.replace(/\s+/g, " ").trim();
    // BREINER OLAYA te envió 300000, ¡lo mejor!
    const m = /^(.+?)\s+te envi[oó]\s+\$?\s?(\d(?:[\d.,]*\d)?)/i.exec(text);
    if (!m) return null;
    return { kind: "TRANSFER_IN", amount: parseAmountCo(m[2]) ?? undefined, merchant: m[1], institution: "Nequi" };
  },
};
