// Nequi: notificaciones de la app (la fuente llega como "Nequi Colombia") y SMS del 890806 ("NEQUI: …").
// Formatos de avisos reales (octubre y noviembre 2026).

import type { BankParser, ParsedEvent } from "../types";
import { eventText, parseAmountCo } from "../normalize";

const AMOUNT = "\\$?\\s?(\\d(?:[\\d.,]*\\d)?)";

export const nequiParser: BankParser = {
  id: "nequi",
  institution: "Nequi",
  matches: (ev) => /nequi/i.test(ev.source) || /\bnequi\s*:/i.test(eventText(ev)),
  parse: (ev) => {
    // Solo el cuerpo: el título ("Envío") va aparte y no es parte del nombre
    let text = ev.text.replace(/\s+/g, " ").trim();
    // SMS: "⁨890806⁩ NEQUI: Pagaste 63.490,00 en GOOGLE *Claude by Anth" → se lee desde lo que viene después de "NEQUI:"
    const sms = /\bnequi\s*:\s*/i.exec(text);
    if (sms) text = text.slice(sms.index + sms[0].length);
    const base = { institution: "Nequi" } satisfies Partial<ParsedEvent>;
    let m: RegExpExecArray | null;

    // Tu plata llegó con éxito 💜 Envío exitoso, la plata ya está en el Nequi destino. (confirma el envío que ya avisó otra notificación)
    if (/tu plata lleg[oó] con [eé]xito|la plata ya est[aá] en el nequi destino/i.test(text)) return { kind: "IGNORE", ignoreReason: "Confirmación de envío" };

    // JUAN PEREZ te envió 300000, ¡lo mejor!
    m = new RegExp(`^(.+?)\\s+te envi[oó]\\s+${AMOUNT}`, "i").exec(text);
    if (m) return { ...base, kind: "TRANSFER_IN", amount: parseAmountCo(m[2]) ?? undefined, merchant: m[1] };

    // Compra exitosa con Tarjeta Nequi: Pagaste 63.490,00 en GOOGLE *Claude by Anth
    m = new RegExp(`(?:^|\\s)pagaste\\s+${AMOUNT}\\s+en\\s+(.+?)\\.?$`, "i").exec(text);
    if (m) return { ...base, kind: "PURCHASE", amount: parseAmountCo(m[1]) ?? undefined, merchant: m[2] };

    // Pago exitoso por PSE: Hiciste un pago en FONDO DE INVERSIÓN COLECTIVA ACCIVAL VISTA por $73.500 y todo salió bien.
    m = new RegExp(`hiciste un pago en\\s+(.+?)\\s+por\\s+${AMOUNT}\\s+y todo sali[oó] bien`, "i").exec(text);
    if (m) return { ...base, kind: "PURCHASE", amount: parseAmountCo(m[2]) ?? undefined, merchant: m[1] };

    // Envío de plata exitoso: Te contamos que el envío de plata por $110.000 fue exitoso. (no dice a quién)
    m = new RegExp(`el env[ií]o de plata por\\s+${AMOUNT}\\s+fue exitoso`, "i").exec(text);
    if (m) return { ...base, kind: "TRANSFER_OUT", amount: parseAmountCo(m[1]) ?? undefined, merchant: "Envío de plata" };

    return null;
  },
};
