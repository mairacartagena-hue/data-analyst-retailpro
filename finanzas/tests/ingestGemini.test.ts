import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { extractWithGemini } from "@/lib/ingest/gemini";
import type { RawEvent } from "@/lib/ingest/types";

const aviso: RawEvent = { channel: "ANDROID_NOTIFICATION", source: "Banco X", text: "Compraste $50.000 en Éxito", receivedAt: "2026-11-22T15:00:00.000Z" };
const ok = (payload: object) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 });
const fail = (status: number) => new Response("{}", { status });

describe("Gemini en la captura de avisos", () => {
  beforeEach(() => { process.env.GEMINI_API_KEY = "k"; vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 }); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("si Gemini responde 503 reintenta y usa el modelo de respaldo en vez de perder el aviso", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => (++calls <= 2 ? fail(503) : ok({ kind: "PURCHASE", amount: 50000, merchant: "Éxito", last4: "1234" })));
    await expect(extractWithGemini(aviso)).resolves.toMatchObject({ kind: "PURCHASE", amount: 50000, merchant: "Éxito", last4: "1234" });
    expect(calls).toBe(3);
  });

  it("sin clave no llama a Gemini", async () => {
    delete process.env.GEMINI_API_KEY;
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(extractWithGemini(aviso)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("una respuesta que no es JSON se descarta sin romper", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no es json" }] } }] }), { status: 200 }));
    await expect(extractWithGemini(aviso)).resolves.toBeNull();
  });
});
