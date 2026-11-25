import "server-only";

// Respaldo con Gemini (nivel gratuito) cuando las reglas no reconocen un texto.
// Solo se envía el texto enmascarado: nunca números completos de cuenta, tarjeta o celular.

import type { MovementKind, ParsedEvent, RawEvent } from "./types";
import { eventText, maskSensitive } from "./normalize";
import { geminiGenerate, geminiModels } from "@/lib/ai/geminiCall";

// Modelo configurable por variable de entorno; por defecto el alias del Flash-Lite vigente.
const DEFAULT_MODEL = "gemini-flash-lite-latest";

const KINDS: MovementKind[] = ["PURCHASE", "TRANSFER_OUT", "TRANSFER_IN", "WITHDRAWAL", "CARD_PAYMENT", "INCOME", "IGNORE"];

const schema = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: KINDS },
    amount: { type: "INTEGER", nullable: true },
    merchant: { type: "STRING", nullable: true },
    last4: { type: "STRING", nullable: true },
  },
  required: ["kind"],
};

const instructions = `Eres un extractor de datos de alertas bancarias colombianas (notificaciones, SMS o correos).
Devuelve JSON con:
- kind: PURCHASE (compra o pago a un comercio), TRANSFER_OUT (transferencia o envío de dinero a otra persona o cuenta),
  TRANSFER_IN (te enviaron o recibiste dinero), WITHDRAWAL (retiro en cajero o corresponsal), CARD_PAYMENT (pago de una
  tarjeta de crédito), INCOME (abono de nómina u otro ingreso), IGNORE (si no es un movimiento: códigos, publicidad,
  avisos de seguridad o transacciones rechazadas).
- amount: monto en pesos colombianos como entero (sin centavos). En Colombia el punto separa miles: "$45.000" es 45000.
- merchant: comercio, destinatario o remitente, sin códigos de pasarela (PAYU*, MP*, etc.). null si no aparece.
- last4: últimos 4 dígitos de tu tarjeta o cuenta solo si aparecen enmascarados (ej. "*1234", "****1234",
  "terminada en 1234"). No uses referencias, CUS, comprobantes ni números de PSE. null si no.
No inventes datos: si algo no aparece, usa null.`;

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export async function extractWithGemini(ev: RawEvent): Promise<ParsedEvent | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const text = maskSensitive(eventText(ev)).slice(0, 3000);

  // Con reintentos y modelo de respaldo (500/503 y cupo agotado), pero sin pasar el límite de la función en Vercel
  const out = await geminiGenerate(geminiModels(process.env.GEMINI_MODEL, DEFAULT_MODEL), {
    systemInstruction: { parts: [{ text: instructions }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
  }, { timeoutMs: 10_000, deadlineMs: 25_000 });

  let json: { kind?: string; amount?: number | null; merchant?: string | null; last4?: string | null };
  try {
    json = JSON.parse(out);
  } catch {
    return null;
  }
  if (!json.kind || !KINDS.includes(json.kind as MovementKind)) return null;
  if (json.kind === "IGNORE") return { kind: "IGNORE", ignoreReason: "Gemini: no es un movimiento" };
  const amount = typeof json.amount === "number" && json.amount > 0 ? Math.round(json.amount) : undefined;
  if (!amount) return null;
  return {
    kind: json.kind as MovementKind,
    amount,
    merchant: json.merchant ?? null,
    last4: json.last4 && /^\d{4}$/.test(json.last4) ? json.last4 : null,
  };
}
