// Montos en pesos colombianos (COP) enteros. Sin decimales ni otras monedas.

const formatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** 1250000 → "$ 1.250.000" (formato colombiano). */
export function formatCop(amount: number): string {
  return formatter.format(Math.round(amount)).replace(/ /g, " ");
}

/** Versión corta para barras y chips: 1250000 → "$1,3 M", 45000 → "$45 mil". */
export function formatCopShort(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(Math.round(amount));
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}$${m.toLocaleString("es-CO", { maximumFractionDigits: m >= 10 ? 0 : 1 })} M`;
  }
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000).toLocaleString("es-CO")} mil`;
  return `${sign}$${abs}`;
}

/**
 * Convierte lo que escribe la persona en un entero de pesos.
 * En COP no hay centavos, así que puntos, comas y espacios se toman como separadores de miles.
 * "1.250.000" → 1250000 · "45,000" → 45000 · "$ 20 000" → 20000 · "" → null
 */
export function parseCop(input: string): number | null {
  const digits = input.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isSafeInteger(n) ? n : null;
}

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
