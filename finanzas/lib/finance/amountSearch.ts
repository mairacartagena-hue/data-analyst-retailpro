/**
 * Búsqueda por valor en Movimientos: si lo que se escribe es un monto ("45000", "$45.000", "45 mil", "45k",
 * "1,5 millones"), se buscan los movimientos con ese valor exacto, con un valor aproximado (±10 %) o con
 * un valor parecido (mismas primeras cifras en otra escala, ej. 4.500 o 450.000 al buscar 45.000).
 */

export type AmountMatch = "exact" | "approx" | "similar";

/** Margen de "aproximado": 10 % del valor buscado. */
export const APPROX_RATIO = 0.1;

/** Lee un monto en pesos de lo escrito en la búsqueda; null si no parece un monto. */
export function parseAmountQuery(raw: string): number | null {
  const q = raw.trim().toLowerCase().replace(/^\$\s*/, "").replace(/\s+/g, " ");
  if (!q) return null;
  const m = q.match(/^(\d[\d.,]*)\s*(k|mil|m|mill[oó]n|millones|mm)?$/);
  if (!m) return null;
  const [, numText, unit] = m;
  let value: number;
  if (unit) {
    // Con unidad se admiten decimales: "1,5 millones", "2.5k"
    const normalized = numText.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    value = Number(normalized);
    value *= unit === "k" || unit === "mil" ? 1_000 : 1_000_000;
  } else {
    // Sin unidad: los puntos y comas son separadores de miles (en pesos no se usan decimales)
    value = Number(numText.replace(/[.,]/g, ""));
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/** Cifras con las que se compara un valor "parecido": las significativas, al menos dos. */
function leadingDigits(target: number): string {
  const digits = String(target);
  const sig = digits.replace(/0+$/, "");
  return sig.length >= 2 ? sig : digits.slice(0, 2);
}

/** Qué tan cerca está un valor del buscado, o null si no se parece. */
export function amountMatch(amount: number, target: number): AmountMatch | null {
  const a = Math.round(Math.abs(amount));
  if (a === target) return "exact";
  if (Math.abs(a - target) <= target * APPROX_RATIO) return "approx";
  const lead = leadingDigits(target);
  if (a > 0 && String(a).startsWith(lead)) return "similar";
  return null;
}
