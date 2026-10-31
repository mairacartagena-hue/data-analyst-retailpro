// RappiCard: correos de noreply@rappicard.co. Formatos tomados de correos reales (octubre 2026).
// Cada dato va en su propia línea, separado por rayas: "Monto / $16.800 / ---- / Método de pago / *4444 …".

import type { BankParser } from "../types";
import { eventText, findDate, findDateEs, parseAmountCo } from "../normalize";

const AMOUNT = "(?:\\$\\s?)?(\\d(?:[\\d.,]*\\d)?)";

export const rappicardParser: BankParser = {
  id: "rappicard",
  institution: "RappiCard",
  matches: (ev) => /rappi ?card/i.test(ev.source),
  parse: (ev) => {
    const text = eventText(ev).replace(/\s+/g, " ");
    const amount = new RegExp(`monto\\s+${AMOUNT}`, "i").exec(text);

    // Realizaste una compra con tu RappiCard. … Monto $16.800 … Método de pago *4444 … Comercio DLO Didi … Fecha de la transacción 2026-10-23 07:28:17
    if (/realizaste una compra con tu rappicard/i.test(text) && amount) {
      return {
        kind: "PURCHASE",
        amount: parseAmountCo(amount[1]) ?? undefined,
        merchant: /comercio\s+(.+?)\s*-{3,}/i.exec(text)?.[1] ?? null,
        last4: /m[eé]todo de pago\s+[•·*]+\s?(\d{4})\b/i.exec(text)?.[1] ?? null,
        institution: "RappiCard",
        occurredAt: findDate(text),
      };
    }

    // Recibimos el pago de tu tarjeta … Destino de pago *4444 … Fecha y hora 31 oct 2026 03:17 … Monto 2.000.000,69
    if (/recibimos el pago de tu tarjeta/i.test(text) && amount) {
      return {
        kind: "CARD_PAYMENT",
        amount: parseAmountCo(amount[1]) ?? undefined,
        merchant: "RappiCard",
        last4: /destino de pago\s+[•·*]+\s?(\d{4})\b/i.exec(text)?.[1] ?? null,
        institution: "RappiCard",
        occurredAt: findDateEs(text.slice(text.search(/fecha y hora/i))),
      };
    }

    if (/lleg[oó] el extracto/i.test(text)) return { kind: "IGNORE", ignoreReason: "Extracto de la tarjeta" };
    return null;
  },
};
