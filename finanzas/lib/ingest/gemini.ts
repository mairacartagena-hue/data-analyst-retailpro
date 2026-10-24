import "server-only";

// Respaldo con Gemini (nivel gratuito) cuando las reglas no reconocen un texto.
// Solo se envía el texto enmascarado: nunca números completos de cuenta, tarjeta o celular.

import type { MovementKind, ParsedEvent, RawEvent } from "./types";
import { eventText, maskSensitive } from "./normalize";

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
- last4: últimos 4 dígitos de la tarjeta o cuenta si aparecen (ej. "****1234"). null si no.
No inventes datos: si algo no aparece, usa null.`;

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export async function extractWithGemini(ev: RawEvent): Promise<ParsedEvent | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const text = maskSensitive(eventText(ev)).slice(0, 3000);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Gemini respondió ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const out = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) return null;

  const json = JSON.parse(out) as { kind?: string; amount?: number | null; merchant?: string | null; last4?: string | null };
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
