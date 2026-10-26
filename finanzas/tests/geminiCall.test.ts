import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { geminiGenerate, geminiModels } from "@/lib/ai/geminiCall";

const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const fail = (status: number) => new Response("{}", { status });

describe("llamada a Gemini con reintentos", () => {
  beforeEach(() => { process.env.GEMINI_API_KEY = "k"; vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 }); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("si el modelo está saturado (503) reintenta y luego usa el de respaldo", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      calls.push(String(url).includes("lite") ? "lite" : "flash");
      return String(url).includes("lite") ? ok("listo") : fail(503);
    });
    await expect(geminiGenerate(geminiModels("gemini-flash-latest", "gemini-flash-lite-latest"), {})).resolves.toBe("listo");
    expect(calls).toEqual(["flash", "flash", "lite"]);
  });

  it("si todos están saturados, da un mensaje claro", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail(503));
    await expect(geminiGenerate(["a", "b"], {})).rejects.toThrow(/saturado/);
  });

  it("un error que no es temporal no se reintenta", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail(400));
    await expect(geminiGenerate(["a", "b"], {})).rejects.toThrow("Gemini respondió 400");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("lista de modelos sin repetir", () => {
    expect(geminiModels("gemini-flash-latest", undefined)).toEqual(["gemini-flash-latest", "gemini-flash-lite-latest"]);
  });
});
