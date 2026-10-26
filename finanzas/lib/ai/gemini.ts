import "server-only";
import { geminiGenerate, geminiModels } from "./geminiCall";

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
  const contents = [
    ...history.slice(-8).map((t) => ({ role: t.role, parts: [{ text: t.text.slice(0, 4000) }] })),
    { role: "user", parts: [{ text: question.slice(0, 1000) }] },
  ];
  return geminiGenerate(geminiModels(process.env.GEMINI_ASSISTANT_MODEL || DEFAULT_MODEL, process.env.GEMINI_MODEL), {
    systemInstruction: { parts: [{ text: `${INSTRUCTIONS}\n\nDATOS:\n${context}` }] },
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
  }, { timeoutMs: 40_000, deadlineMs: 55_000 });
}
