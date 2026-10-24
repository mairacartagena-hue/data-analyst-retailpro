// Bancolombia: SMS (85540, 85784…) y correos de alertasynotificaciones@ayn.notificacionesbancolombia.com.
// Formatos tomados de mensajes reales (octubre 2026).

import type { BankParser, ParsedEvent } from "../types";
import { eventText, findDate, parseAmountCo } from "../normalize";

const AMOUNT = "\\$\\s?([\\d][\\d.,]*\\d)";

export const bancolombiaParser: BankParser = {
  id: "bancolombia",
  institution: "Bancolombia",
  matches: (ev) => /bancolombia/i.test(ev.source) || /\bbancolombia\s*:/i.test(eventText(ev)),
  parse: (ev) => {
    const full = eventText(ev).replace(/\s+/g, " ");
    const start = full.search(/bancolombia\s*:/i);
    const text = start >= 0 ? full.slice(start) : full;
    const occurredAt = findDate(text, "DMY");
    const base = { institution: "Bancolombia", occurredAt } satisfies Partial<ParsedEvent>;
    let m: RegExpExecArray | null;

    // Compraste $63.490,00 en GOOGLE *Claude by An con tu T.Deb *7473, el 22/10/2026 a las 14:10.
    m = new RegExp(`compraste\\s+${AMOUNT}\\s+en\\s+(.+?)\\s+con tu\\s+(?:t\\.?\\s?deb|t\\.?\\s?cred|tarjeta)\\w*\\.?\\s*\\*?(\\d{4})`, "i").exec(text);
    if (m) return { ...base, kind: "PURCHASE", amount: parseAmountCo(m[1]) ?? undefined, merchant: m[2], last4: m[3] };

    // Pagaste $1,043,000.00 a Banco Davivienda S A Zona Pa desde tu producto 2505 el 23/10/2026 10:42:10.
    m = new RegExp(`pagaste\\s+${AMOUNT}\\s+a\\s+(.+?)\\s+desde tu producto\\s*\\*?(\\d{4})`, "i").exec(text);
    if (m) return { ...base, kind: "PURCHASE", amount: parseAmountCo(m[1]) ?? undefined, merchant: m[2], last4: m[3] };

    // Transferiste $800,000 desde tu cuenta *2505 a la cuenta *0123456789 el 23/10/2026 a las 11:26.
    m = new RegExp(`transferiste\\s+${AMOUNT}\\s+desde tu cuenta\\s*\\*?(\\d{4})\\s+a la cuenta\\s*\\*?([\\d*]+)`, "i").exec(text);
    if (m) {
      const dest = m[3].replace(/\D/g, "");
      return {
        ...base,
        kind: "TRANSFER_OUT",
        amount: parseAmountCo(m[1]) ?? undefined,
        merchant: dest ? `Cuenta ···${dest.slice(-4)}` : "Transferencia",
        last4: m[2],
        identifiers: dest.length >= 6 ? [{ type: "ACCOUNT", value: dest }] : [],
      };
    }

    // MAYRA, recibiste una transferencia de NOMBRE por $100,000.00 en tu cuenta *2505 conectada a la llave …
    m = new RegExp(`recibiste una transferencia de\\s+(.+?)\\s+por\\s+${AMOUNT}\\s+en tu cuenta\\s*\\*?(\\d{4})`, "i").exec(text);
    if (m) return { ...base, kind: "TRANSFER_IN", amount: parseAmountCo(m[2]) ?? undefined, merchant: m[1], last4: m[3] };

    // Recibiste un pago por $6,044,772.00 de EMPRESA a tu cuenta AHORROS, el 10:07 a las 23/10/2026.
    m = new RegExp(`recibiste un pago por\\s+${AMOUNT}\\s+de\\s+(.+?)\\s+a tu cuenta\\s*(?:\\*?(\\d{4}))?`, "i").exec(text);
    if (m) return { ...base, kind: "INCOME", amount: parseAmountCo(m[1]) ?? undefined, merchant: m[2], last4: m[3] ?? null };

    return null;
  },
};
