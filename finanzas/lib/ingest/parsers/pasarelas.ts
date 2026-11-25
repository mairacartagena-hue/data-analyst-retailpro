// Pasarelas de pago que mandan su propio comprobante por correo. Hoy: MiPagoAmigo (portal de pagos del Banco Caja Social).
// Formato de un correo real (noviembre 2026). Los rechazos y errores los descarta detectIgnore antes de llegar aquí.

import type { BankParser } from "../types";
import { bogotaIso, eventText, fold, parseAmountCo } from "../normalize";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "Banco: BANCOLOMBIA" es el banco de donde salió la plata: ahí se ubica la cuenta. */
function payerInstitution(text: string): string | null {
  const m = /medio de pago.*?banco:\s*([a-záéíóúñ ]+?)\s+cus:/i.exec(text);
  const bank = m ? fold(m[1]) : "";
  if (bank.includes("bancolombia")) return "Bancolombia";
  if (bank.includes("nequi")) return "Nequi";
  if (bank.includes("davivienda")) return "Davivienda";
  if (bank.includes("bbva")) return "BBVA";
  return null;
}

export const pasarelasParser: BankParser = {
  id: "pasarelas",
  institution: "Pasarelas de pago",
  matches: (ev) => /mipagoamigo|notificador@bancocajasocial/i.test(`${ev.source} ${eventText(ev)}`),
  parse: (ev) => {
    const text = eventText(ev).replace(/\s+/g, " ");
    // Pago exitoso en el Portal MiPagoAmigo … Estado: Aprobada … Fecha y hora: 2 de noviembre de 2026-21:40hrs.
    // … Nombre del servicio: CREDITOS DE CONSUMO NIT de la empresa: … Valor: *$ $224.506,94*
    if (!/estado:\s*aprobada|su transacci[oó]n fue aprobada/i.test(text)) return null;
    const value = /\bvalor:\s*\**\s*\$\s*\$?\s?([\d][\d.,]*\d)/i.exec(text);
    const service = /nombre del servicio:\s*(.+?)\s+nit de la empresa/i.exec(text);
    if (!value || !service) return null;

    let occurredAt: string | null = null;
    const d = /fecha y hora:\s*(\d{1,2}) de ([a-záéíóú]+) de (\d{4})\D{0,3}(\d{1,2}):(\d{2})/i.exec(text);
    if (d) {
      const month = MONTHS.indexOf(fold(d[2])) + 1;
      if (month > 0) occurredAt = bogotaIso(+d[3], month, +d[1], +d[4], +d[5]);
    }
    return {
      kind: "PURCHASE",
      amount: parseAmountCo(value[1]) ?? undefined,
      merchant: service[1],
      institution: payerInstitution(text),
      occurredAt,
    };
  },
};
