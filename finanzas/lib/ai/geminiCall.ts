import "server-only";

// Llamada a Gemini con reintentos: si un modelo está saturado (500/503) se reintenta una vez y luego se usa
// el siguiente; si no existe (404) o se acabó su cupo gratuito (429), se pasa al siguiente.

export class GeminiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Modelos a probar en orden, sin repetir: el pedido, el de respaldo y Flash-Lite. */
export function geminiModels(preferred: string | undefined, fallback: string | undefined): string[] {
  return [...new Set([preferred, fallback, "gemini-flash-latest", "gemini-flash-lite-latest"].filter((m): m is string => !!m))];
}

/** Devuelve el texto de la primera respuesta. `deadlineMs` limita el tiempo total (Vercel corta a los 60 s). */
export async function geminiGenerate(models: string[], body: unknown, opts: { timeoutMs?: number; deadlineMs?: number } = {}): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("La IA no está configurada (falta GEMINI_API_KEY).");
  const started = Date.now();
  const deadline = opts.deadlineMs ?? 50_000;
  let lastStatus: number | undefined;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - (Date.now() - started);
      if (left < 5_000) break;
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(opts.timeoutMs ?? 30_000, left)),
        });
      } catch {
        lastStatus = 504; // se demoró demasiado: probar el siguiente modelo
        break;
      }
      if (res.ok) {
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
        if (text) return text;
        lastStatus = 204;
        break;
      }
      lastStatus = res.status;
      if (res.status === 500 || res.status === 503) {
        if (attempt === 0) await sleep(1_500);
        continue;
      }
      if (res.status === 404 || res.status === 429) break;
      throw new GeminiError(`Gemini respondió ${res.status}`, res.status);
    }
  }
  if (lastStatus === 429) throw new GeminiError("La IA alcanzó el límite gratuito por ahora. Intenta de nuevo en un minuto.", 429);
  if (lastStatus === 204) throw new GeminiError("La IA no devolvió respuesta. Intenta de nuevo.", 204);
  throw new GeminiError("Gemini está saturado en este momento. Intenta de nuevo en un minuto.", lastStatus);
}
