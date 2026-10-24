// Google Wallet (Billetera de Google): notificación de pago con el celular. Formato de un mensaje real (octubre 2026):
//   título: "AGRO LA HACIENDA"
//   texto:  "COP33,900.00 con Debito Mastercard ••7473"
// La cuenta se reconoce por los últimos 4 dígitos de la tarjeta (alias de la cuenta en la app).

import type { BankParser } from "../types";
import { parseAmountCo } from "../normalize";

export const googleWalletParser: BankParser = {
  id: "google-wallet",
  institution: "Google Wallet",
  matches: (ev) => /wallet|billetera de google|walletnfcrel/i.test(ev.source),
  parse: (ev) => {
    const text = ev.text.replace(/\s+/g, " ").trim();
    const m = /(?:cop|\$)\s?([\d][\d.,]*\d)\s+con\s+.+?[•·*]+\s*(\d{4})\b/i.exec(text);
    // Otras notificaciones de la billetera (tarjeta agregada, pases, ofertas): no son movimientos
    if (!m) return { kind: "IGNORE", ignoreReason: "Aviso de Google Wallet sin pago" };
    return {
      kind: "PURCHASE",
      amount: parseAmountCo(m[1]) ?? undefined,
      merchant: ev.title?.trim() || null,
      last4: m[2],
      institution: "Google Wallet",
      occurredAt: null,
    };
  },
};
