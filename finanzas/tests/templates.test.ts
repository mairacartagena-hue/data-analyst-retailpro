import { describe, expect, it } from "vitest";
import { appsScript, authHeader } from "@/lib/ingest/templates";

describe("plantillas de captura automática", () => {
  it("el Apps Script sale con el token puesto cuando se le pasa", () => {
    const code = appsScript("https://app.test/api/webhook/android-ingest", "fp_abc123");
    expect(code).toContain("const TOKEN = 'fp_abc123';");
    expect(code).not.toContain("PEGA_AQUI_TU_TOKEN");
  });

  it("sin token conserva el marcador para pegarlo a mano", () => {
    expect(appsScript("https://app.test/x")).toContain("const TOKEN = 'PEGA_AQUI_TU_TOKEN';");
  });

  it("el encabezado de MacroDroid es Bearer + token", () => {
    expect(authHeader("fp_abc123")).toBe("Bearer fp_abc123");
  });
});
