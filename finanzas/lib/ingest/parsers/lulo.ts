// Lulo bank: correos de notificaciones@lulobank.com. Formatos tomados de correos reales (octubre 2026).
// La fecha viene escrita ("22 de octubre de 2026 … Hora 5:41 p.m.") y la tarjeta como "•1111".

import type { BankParser } from "../types";
import { eventText, findDateEs, parseAmountCo } from "../normalize";

const AMOUNT = "\\$\\s?(\\d(?:[\\d.,]*\\d)?)";
const LAST4 = /[•·*]+\s?(\d{4})\b/;

export const luloParser: BankParser = {
  id: "lulo",
  institution: "Lulo Bank",
  matches: (ev) => /lulo ?bank/i.test(ev.source),
  parse: (ev) => {
    const text = eventText(ev).replace(/\s+/g, " ");
    const base = { institution: "Lulo Bank", occurredAt: findDateEs(text) };
    let m: RegExpExecArray | null;

    // Realizaste una compra en SMARTTT por $3,500.00 Origen tarjeta débito •1111
    m = new RegExp(`realizaste una compra en\\s+(.+?)\\s+por\\s+${AMOUNT}\\s+origen tarjeta\\s+\\S+\\s*${LAST4.source}`, "i").exec(text);
    if (m) return { ...base, kind: "PURCHASE", amount: parseAmountCo(m[2]) ?? undefined, merchant: m[1], last4: m[3] };

    // Hiciste un pago a Banco Davivienda Sa por $2,000,000.69 El cobro se hizo a tu cuenta • 2222
    m = new RegExp(`hiciste un pago a\\s+(.+?)\\s+por\\s+${AMOUNT}\\s+el cobro se hizo a tu cuenta\\s*${LAST4.source}`, "i").exec(text);
    if (m) return { ...base, kind: "PURCHASE", amount: parseAmountCo(m[2]) ?? undefined, merchant: m[1], last4: m[3] };

    // Recibiste una recarga a tu cuenta por $1.000.000. Origen · BANCOLOMBIA CUS 765878367 …
    m = new RegExp(`recibiste una recarga a tu cuenta por\\s+${AMOUNT}`, "i").exec(text);
    if (m) {
      const origin = /origen\s*[·•]\s*(.+?)\s+(?:cus|no\.|medio)\b/i.exec(text);
      return { ...base, kind: "TRANSFER_IN", amount: parseAmountCo(m[1]) ?? undefined, merchant: origin?.[1] ?? null };
    }

    // Hiciste el pago de tu crédito No. 48838263333 por $800,000.86. Origen • BANCOLOMBIA Destino Crédito • 3333
    m = new RegExp(`hiciste el pago de tu cr[eé]dito no\\.?\\s*\\d+\\s+por\\s+${AMOUNT}.*?destino cr[eé]dito\\s*${LAST4.source}`, "i").exec(text);
    if (m) return { ...base, kind: "CARD_PAYMENT", amount: parseAmountCo(m[1]) ?? undefined, merchant: "Lulo Bank", last4: m[2] };

    return null;
  },
};
