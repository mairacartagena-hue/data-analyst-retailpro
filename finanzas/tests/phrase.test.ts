import { describe, expect, it } from "vitest";
import { findSpokenAmount, parsePhrase } from "@/lib/capture/phrase";
import { sanitizeCapture } from "@/lib/capture/sanitize";

const ctx = {
  today: "2026-10-26",
  accounts: [{ id: "nequi", name: "Nequi" }, { id: "ahorros", name: "Ahorros Bancolombia" }, { id: "efe", name: "Efectivo" }, { id: "visa", name: "Tarjeta Visa" }],
  categories: [{ id: "mer", name: "Mercado" }, { id: "rest", name: "Restaurantes" }, { id: "tr", name: "Transporte" }],
  incomeCategories: [{ id: "sal", name: "Salario" }],
};

describe("montos dichos en voz alta", () => {
  it.each([
    ["45 mil", 45_000],
    ["$45.000", 45_000],
    ["45000 pesos", 45_000],
    ["1,5 millones", 1_500_000],
    ["1 millón 200 mil", 1_200_000],
    ["un millón", 1_000_000],
    ["20 lucas", 20_000],
    ["cincuenta mil", 50_000],
    ["12k", 12_000],
    ["$1.250.000", 1_250_000],
  ])("%s → %d", (txt, n) => {
    expect(findSpokenAmount(txt)?.amount).toBe(n);
  });

  it("un número suelto pequeño no es un monto", () => {
    expect(findSpokenAmount("compré 3 cosas el 15")).toBeNull();
  });
});

describe("frase completa", () => {
  it("gasto con comercio, cuenta y categoría", () => {
    const r = parsePhrase("Gasté 45 mil en el Éxito con Nequi, mercado", ctx);
    expect(r).toMatchObject({ kind: "EXPENSE", amount: 45_000, accountId: "nequi", categoryId: "mer", date: "2026-10-26" });
    expect(r.description).toMatch(/Éxito/);
  });

  it("ayer y la cuenta por una palabra de su nombre", () => {
    const r = parsePhrase("ayer pagué 18.500 de transporte con bancolombia", ctx);
    expect(r).toMatchObject({ amount: 18_500, date: "2026-10-25", accountId: "ahorros", categoryId: "tr" });
  });

  it("ingreso", () => {
    const r = parsePhrase("me pagaron el salario 3 millones en ahorros", ctx);
    expect(r).toMatchObject({ kind: "INCOME", amount: 3_000_000, accountId: "ahorros", categoryId: "sal" });
  });

  it("transferencia entre cuentas", () => {
    const r = parsePhrase("pasé 200 mil de nequi a ahorros bancolombia", ctx);
    expect(r).toMatchObject({ kind: "TRANSFER", amount: 200_000, accountId: "nequi", toAccountId: "ahorros" });
  });

  it("compra a cuotas", () => {
    const r = parsePhrase("compré un televisor de 2 millones con la tarjeta visa a 12 cuotas", ctx);
    expect(r).toMatchObject({ amount: 2_000_000, accountId: "visa", installments: 12 });
    expect(r.description).not.toMatch(/cuotas/);
  });

  it("frase vacía", () => {
    expect(parsePhrase("  ", ctx)).toEqual({});
  });
});

describe("respuesta de Gemini", () => {
  const g = { ...ctx, incomeCategories: ctx.incomeCategories };

  it("descarta ids que no están en las listas y fechas futuras", () => {
    const r = sanitizeCapture({ kind: "EXPENSE", amount: 45000.4, category_id: "inventada", account_id: "nequi", date: "2026-12-01", description: " Éxito " }, g);
    expect(r).toEqual({ kind: "EXPENSE", amount: 45000, accountId: "nequi", description: "Éxito" });
  });

  it("la categoría de un ingreso sale de la lista de ingresos", () => {
    expect(sanitizeCapture({ kind: "INCOME", category_id: "sal" }, g).categoryId).toBe("sal");
    expect(sanitizeCapture({ kind: "INCOME", category_id: "mer" }, g).categoryId).toBeUndefined();
  });
});
