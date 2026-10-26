import "server-only";

// Captura rápida con Gemini: lee una frase dictada o la foto de un recibo y propone el movimiento.
// La persona siempre revisa el formulario antes de guardar. La foto no se guarda en ningún lado.

import type { CaptureOption, CaptureResult } from "./phrase";
import { sanitizeCapture, type CaptureContext } from "./sanitize";

export type { CaptureContext };

const DEFAULT_MODEL = "gemini-flash-lite-latest";

const schema = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["EXPENSE", "INCOME", "TRANSFER"], nullable: true },
    amount: { type: "INTEGER", nullable: true },
    description: { type: "STRING", nullable: true },
    date: { type: "STRING", nullable: true },
    category_id: { type: "STRING", nullable: true },
    account_id: { type: "STRING", nullable: true },
    to_account_id: { type: "STRING", nullable: true },
  },
};


function instructions(ctx: CaptureContext, source: "text" | "image") {
  const list = (o: CaptureOption[]) => (o.length ? o.map((x) => `${x.id} = ${x.name}`).join("\n") : "(ninguna)");
  return `Ayudas a registrar movimientos de dinero en una app de finanzas de una pareja en Colombia (pesos colombianos).
${source === "image"
    ? "Recibes la foto de un recibo, factura, tirilla o comprobante de pago. Toma el TOTAL pagado (no el subtotal, ni el IVA, ni el cambio, ni la propina sugerida si no está incluida)."
    : "Recibes una frase dicha o escrita por la persona, por ejemplo \"gasté 45 mil en el Éxito con Nequi\"."}
Hoy es ${ctx.today} (AAAA-MM-DD).
Devuelve JSON con:
- kind: EXPENSE (gasto o pago), INCOME (le pagaron o recibió plata) o TRANSFER (movió plata entre sus propias cuentas o pagó su tarjeta). Un recibo es EXPENSE.
- amount: entero en pesos. En Colombia el punto separa miles: "$45.000" es 45000; "45 mil" es 45000; "1,5 millones" es 1500000; "20 lucas" es 20000.
- description: comercio o concepto corto (ej. "Éxito", "Almuerzo en Crepes"), sin el monto ni la cuenta.
- date: fecha del movimiento en AAAA-MM-DD (en recibos la fecha impresa; "ayer" es el día anterior a hoy). null si no se sabe.
- category_id: el id de la categoría que mejor encaje, SOLO de esta lista (gastos):
${list(ctx.categories)}
  o, si es un ingreso, de esta lista (ingresos):
${list(ctx.incomeCategories)}
  null si ninguna encaja claramente.
- account_id: id de la cuenta con la que se pagó o a la que entró la plata, SOLO si se menciona (en un recibo, si se ven los últimos dígitos de la tarjeta y coinciden con el nombre). Lista:
${list(ctx.accounts)}
- to_account_id: en una TRANSFER, la cuenta de destino (misma lista).
No inventes: si algo no aparece, usa null.`;
}

export async function captureWithGemini(
  input: { text: string } | { image: string; mime: string },
  ctx: CaptureContext,
): Promise<CaptureResult | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const isImage = "image" in input;
  const part = isImage ? { inlineData: { mimeType: input.mime, data: input.image } } : { text: input.text.slice(0, 1000) };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions(ctx, isImage ? "image" : "text") }] },
      contents: [{ role: "user", parts: [part] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Gemini respondió ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const out = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) return null;
  return sanitizeCapture(JSON.parse(out), ctx);
}

