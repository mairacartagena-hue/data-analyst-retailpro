import "server-only";

// Asistente de finanzas con Gemini (nivel gratuito). Responde solo con los datos que envía la app.

const DEFAULT_MODEL = "gemini-flash-latest";

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

const INSTRUCTIONS = `Eres el asistente de una app de finanzas personales y en pareja en Colombia. Respondes en español de Colombia, claro y corto (máximo unas 12 líneas, salvo que pidan detalle).
Reglas:
- Usa SOLO los datos del bloque DATOS. Si algo no está ahí, dilo y sugiere dónde verlo en la app (Movimientos, Presupuesto, Informes, Cuentas, Cierre del mes). No inventes cifras.
- Montos en pesos con separador de miles con punto: $1.250.000.
- Cuando sumes o compares, haz las cuentas con cuidado y di de dónde salen (meses, categorías, movimientos).
- "Gastamos" o "el hogar" se refiere a los movimientos del hogar; "gasté" o "mis" a la persona que pregunta.
- Puedes dar consejos prácticos de presupuesto y ahorro basados en los datos; no recomiendes productos financieros específicos.
- Formato: texto plano con viñetas "- " si ayudan. Sin tablas ni encabezados.`;

export async function askGemini(question: string, context: string, history: ChatTurn[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("La IA no está configurada (falta GEMINI_API_KEY).");
  const model = process.env.GEMINI_ASSISTANT_MODEL || DEFAULT_MODEL;
  try {
    return await ask(key, model, question, context, history);
  } catch (e) {
    // Si el modelo no está disponible en el plan gratuito, se usa el de la captura (Flash-Lite)
    const fallback = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
    if ((e as { status?: number }).status === 404 && fallback !== model) return ask(key, fallback, question, context, history);
    throw e;
  }
}

async function ask(key: string, model: string, question: string, context: string, history: ChatTurn[]): Promise<string> {
  const contents = [
    ...history.slice(-8).map((t) => ({ role: t.role, parts: [{ text: t.text.slice(0, 4000) }] })),
    { role: "user", parts: [{ text: question.slice(0, 1000) }] },
  ];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${INSTRUCTIONS}\n\nDATOS:\n${context}` }] },
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (res.status === 429) throw new Error("La IA alcanzó el límite gratuito por ahora. Intenta en un minuto.");
  if (!res.ok) throw Object.assign(new Error(`Gemini respondió ${res.status}`), { status: res.status });
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("La IA no devolvió respuesta. Intenta con otra pregunta.");
  return text;
}
