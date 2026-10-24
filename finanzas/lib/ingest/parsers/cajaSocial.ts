// Banco Caja Social: SMS del 87227. Formato de mensajes reales (2026). La fecha viene mes/día/año.

import type { BankParser } from "../types";
import { eventText, findDate, parseAmountCo } from "../normalize";

export const cajaSocialParser: BankParser = {
  id: "caja-social",
  institution: "Banco Caja Social",
  matches: (ev) => /caja social/i.test(`${ev.source} ${eventText(ev)}`) || ev.source.replace(/\D/g, "") === "87227",
  parse: (ev) => {
    const text = eventText(ev).replace(/\s+/g, " ");
    // Su pago por $469.462,35 para CREDITOS DE CONSUMO quedo Aprobado. 06/25/2026 12:21. Banco Caja Social …
    const m = /su pago por\s+\$\s?([\d][\d.,]*\d)\s+para\s+(.+?)\s+qued[oó]\s+(aprobado|rechazado)/i.exec(text);
    if (!m) return null;
    if (/rechazado/i.test(m[3])) return { kind: "IGNORE", ignoreReason: "Pago rechazado" };
    return {
      kind: "PURCHASE",
      amount: parseAmountCo(m[1]) ?? undefined,
      merchant: m[2],
      institution: "Banco Caja Social",
      occurredAt: findDate(text, "MDY"),
    };
  },
};
