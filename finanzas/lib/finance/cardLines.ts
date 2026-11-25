// Movimientos del extracto de una tarjeta leídos del PDF (o foto) con la IA, convertidos al mismo formato que el CSV
// para cruzarlos con la app con `reconcileStatement`. Funciones puras: la lectura con la IA vive en lib/capture.

import type { CardLinesData, CardPrintedTotals, CardStatementLine } from "@/lib/capture/cardStatement";
import { classifyLine, groupMonthly, type LineKind, type ParsedStatement, type StatementLine } from "./statement";

/** Diferencia aceptada entre lo que suman los movimientos leídos y el total que imprime el extracto (redondeos del banco). */
export const TOTALS_TOLERANCE = 1_000;

export type TotalsKey = keyof CardPrintedTotals;

export interface TotalCheck {
  key: TotalsKey;
  label: string;
  /** Lo que suman los movimientos leídos. */
  read: number;
  /** Lo que imprime el extracto. */
  printed: number;
  ok: boolean;
}

const TOTAL_LABEL: Record<TotalsKey, string> = { purchases: "Compras y cargos", payments: "Pagos y abonos", interest: "Intereses", fees: "Cuotas de manejo y comisiones" };

function lineKind(l: CardStatementLine, effect: number): LineKind {
  if (l.kind === "INTEREST") return effect > 0 ? "INTEREST_IN" : "INTEREST_OUT";
  if (l.kind === "FEE") return effect < 0 ? "FEE" : "OTHER"; // la reversión de un cobro no suma como cobro del banco
  if (l.kind === "PURCHASE" || l.kind === "PAYMENT") return "OTHER";
  return classifyLine(l.description, effect);
}

/** Efecto sobre el saldo de la tarjeta: abonos entran (+), compras y cobros salen (−). */
const effectOf = (l: CardStatementLine) => (l.credit ? l.amount : -l.amount);

export interface CardLinesParsed {
  parsed: ParsedStatement;
  /** Cuotas de compras diferidas: no se cruzan aquí (en la app la compra es una sola); las revisa la validación de cuotas. */
  installmentLines: CardStatementLine[];
  /** Lo leído contra los totales del resumen del extracto. Vacío si el extracto no trae resumen. */
  totals: TotalCheck[];
}

/** Compara lo que suman los movimientos leídos con los totales que imprime el extracto. */
export function checkPrintedTotals(lines: CardStatementLine[], printed: CardPrintedTotals): TotalCheck[] {
  const sum = (f: (l: CardStatementLine) => boolean) => lines.filter(f).reduce((a, l) => a + l.amount, 0);
  const read: Record<TotalsKey, number> = {
    // Compras y cargos del periodo: todo lo que sube la deuda, salvo intereses y cobros del banco, que el resumen separa
    purchases: sum((l) => !l.credit && l.kind !== "INTEREST" && l.kind !== "FEE"),
    payments: sum((l) => l.credit && l.kind === "PAYMENT"),
    interest: sum((l) => l.kind === "INTEREST" && !l.credit),
    fees: sum((l) => l.kind === "FEE" && !l.credit),
  };
  return (Object.keys(TOTAL_LABEL) as TotalsKey[])
    .filter((k) => printed[k] !== undefined)
    .map((k) => ({ key: k, label: TOTAL_LABEL[k], read: read[k], printed: printed[k] as number, ok: Math.abs(read[k] - (printed[k] as number)) <= TOTALS_TOLERANCE }));
}

export function parsedFromCardLines(data: CardLinesData): CardLinesParsed {
  const installmentLines = data.lines.filter((l) => (l.installmentNo ?? 1) > 1);
  const lines: StatementLine[] = [];
  data.lines.forEach((l, i) => {
    if ((l.installmentNo ?? 1) > 1) return;
    const amount = effectOf(l);
    lines.push({ id: `P${i + 1}`, date: l.date, description: l.description, amount, exact: amount, balance: null, kind: lineKind(l, amount) });
  });
  const warnings: string[] = [];
  if (lines.length === 0) {
    // Decir POR QUÉ no hay movimientos: no es lo mismo que la IA devuelva la lista vacía, que no pudiera leer ninguno o que todo sean cuotas
    const why = installmentLines.length > 0
      ? `Todo lo que leí (${installmentLines.length}) son cuotas de compras diferidas: esas se revisan en la comparación de cuotas, no aquí. ¿El archivo trae el detalle de movimientos del periodo?`
      : data.dropped > 0
        ? `Leí ${data.dropped} filas pero sin una fecha o un valor que pudiera usar (revisa que las fechas sean del año del extracto).`
        : "La lectura no devolvió ninguna fila: revisa que el archivo tenga el detalle de movimientos (no solo el resumen), que no esté protegido con contraseña y, si es foto, que se lea nítida.";
    warnings.push(`No encontré movimientos en el extracto. ${why} Prueba con otro archivo, vuelve a intentarlo o usa el Excel o CSV del banco.`);
  }
  const dates = data.lines.map((l) => l.date).sort();
  const period = data.periodStart && data.periodEnd ? { start: data.periodStart, end: data.periodEnd } : null;
  const parsed: ParsedStatement = {
    lines: groupMonthly(lines),
    map: { date: null, description: null, amount: null, debit: null, credit: null, balance: null },
    headers: [], headerRow: -1, dateOrder: "DMY", skipped: data.dropped, warnings,
    period: period ?? (dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null),
    raw: lines,
  };
  return { parsed, installmentLines, totals: checkPrintedTotals(data.lines, data.totals) };
}
