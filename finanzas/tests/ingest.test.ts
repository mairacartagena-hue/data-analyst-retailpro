import { describe, expect, it } from "vitest";
import {
  MAX_MERCHANT, cleanMerchant, detectIgnore, findAmount, findIdentifiers, findLast4, guessInstitution, maskSensitive, normalizeMerchant, parseAmountCo,
} from "@/lib/ingest/normalize";
import { parseWithRules } from "@/lib/ingest/registry";
import type { RawEvent } from "@/lib/ingest/types";

const ev = (text: string, source = "Bancolombia"): RawEvent => ({ channel: "ANDROID_NOTIFICATION", source, text, receivedAt: "2026-10-24T15:00:00.000Z" });

describe("montos colombianos", () => {
  it("separadores de miles y centavos", () => {
    expect(parseAmountCo("1.250.000")).toBe(1250000);
    expect(parseAmountCo("45,000.00")).toBe(45000);
    expect(parseAmountCo("20.000,50")).toBe(20001);
    expect(parseAmountCo("1.234")).toBe(1234);
    expect(parseAmountCo("$ 300")).toBe(300);
    expect(parseAmountCo("abc")).toBeNull();
  });

  it("encuentra el monto en un texto", () => {
    expect(findAmount("Pagaste $45.000 en ÉXITO")).toBe(45000);
    expect(findAmount("valor COP 1.200.000,00")).toBe(1200000);
    expect(findAmount("sin monto")).toBeNull();
  });
});

describe("comercios", () => {
  it("quita pasarelas, ciudad y códigos", () => {
    expect(cleanMerchant("PAYU*RAPPI COLOMBIA")).toBe("Rappi Colombia");
    expect(cleanMerchant("MERCADOPAGO*TIENDA XYZ BOGOTA CO")).toBe("Tienda Xyz");
    expect(cleanMerchant("GOOGLE *YouTube")).toBe("YouTube");
    expect(cleanMerchant("  ")).toBeNull();
    expect(cleanMerchant("Wompi SAS")).toBe("Wompi");
    expect(cleanMerchant("S.A.S")).toBe("S.A.S");
  });

  it("normaliza para comparar", () => {
    expect(normalizeMerchant("PAYU*Éxito Colina")).toBe("exito colina");
    expect(normalizeMerchant("Éxito colina")).toBe("exito colina");
  });
});

describe("tarjeta, identificadores y privacidad", () => {
  it("últimos 4 dígitos", () => {
    expect(findLast4("tarjeta *1234 por")).toBe("1234");
    expect(findLast4("terminada en 9876")).toBe("9876");
    expect(findLast4("sin tarjeta")).toBeNull();
  });

  it("celular y NIT", () => {
    expect(findIdentifiers("Enviaste a 3001234567")).toEqual([{ type: "PHONE", value: "3001234567" }]);
    expect(findIdentifiers("NIT 900.123.456-7")).toEqual([{ type: "NIT", value: "900123456-7" }]);
  });

  it("nunca envía números completos a Gemini", () => {
    const masked = maskSensitive("Cuenta 1234567890123 celular 3001234567 por $45.000 a juan@correo.com");
    expect(masked).not.toMatch(/1234567890123|3001234567|juan@/);
    expect(masked).toContain("****0123");
    expect(masked).toContain("$45.000");
  });
});

describe("reglas de ignorar", () => {
  it("códigos, rechazos y publicidad", () => {
    expect(detectIgnore("Tu código de verificación es 123456")).toBe("Código o clave");
    expect(detectIgnore("La compra por $20.000 fue rechazada")).toBe("Transacción no aprobada");
    expect(detectIgnore("Aprovecha 30% de descuento este fin de semana")).toBe("Publicidad");
    expect(detectIgnore("Compraste $45.000 en Éxito")).toBeNull();
    // Promoción de Nequi: no es una compra de $45.000 aunque traiga monto y "compras"
    expect(detectIgnore("Haz 5 compras con tu Tarjeta Nequi Visa, mantén tu racha y participa por hasta $45.000 COP. ¡Que no se corte! Aplican TyC. Válido hasta el 01/11/2026.")).toBe("Publicidad");
    expect(detectIgnore("Compraste $45.000 en Éxito. Aplican TyC")).toBeNull();
    // Avisos de inicio de sesión (BBVA por correo, Nequi, banca virtual)
    for (const msg of [
      "Importante: Confirmación de ingreso en nuestros canales digitales. Acabas de ingresar a tu App BBVA el 26/10/2026",
      "¿Iniciaste otra sesión en tu App BBVA?, confirma esta información. Has ingresado nuevamente a la App BBVA. Tipo de operación: Ingreso App BBVA",
      "Iniciaste sesión en tu Nequi desde la web",
      "Inicio de sesión Banca Virtual",
    ]) expect(detectIgnore(msg)).toBe("Aviso de inicio de sesión");
    expect(detectIgnore("Recibiste un ingreso de $1.200.000 en tu cuenta")).toBeNull();
    expect(detectIgnore("BBVA te informa que ingresaste a la Net el 2026-10-26 a las 09:57")).toBe("Aviso de inicio de sesión");
    expect(detectIgnore("BBVA te informa que estas intentando realizar un Olvido de Contraseña, el 2026-10-26 a las 09:56")).toBe("Aviso de seguridad");
  });

  it("la entidad sale de la app o el remitente", () => {
    expect(guessInstitution(ev("x", "Nequi"))).toBe("Nequi");
    expect(guessInstitution(ev("x", "com.google.android.apps.walletnfcrel"))).toBe("Google Wallet");
  });

  it("sin parser del banco todavía: queda para Gemini o como no reconocido", () => {
    expect(parseWithRules(ev("Compraste $45.000 en Éxito")).parsed).toBeNull();
    expect(parseWithRules(ev("Tu clave dinámica es 1234")).parsed?.kind).toBe("IGNORE");
  });
});

describe("nombres de comercio desmedidos", () => {
  it("se cortan a 60 caracteres sin partir palabras (ej. el lector de respaldo copió medio correo)", () => {
    const junk = "Davivienda Cartera Creditos " + "otros servicios ".repeat(60);
    const out = cleanMerchant(junk)!;
    expect(out.length).toBeLessThanOrEqual(MAX_MERCHANT);
    expect(out.startsWith("Davivienda Cartera Creditos")).toBe(true);
    expect(out.endsWith(" ")).toBe(false);
  });

  it("un nombre normal no cambia", () => {
    expect(cleanMerchant("Banco De Bogotá - Crédito Hipotecario")).toBe("Banco De Bogotá - Crédito Hipotecario");
  });
});
