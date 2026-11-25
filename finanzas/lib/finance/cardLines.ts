// Movimientos del extracto de una tarjeta leídos del PDF (o foto) con la IA, convertidos al mismo formato que el CSV
// para cruzarlos con la app con `reconcileStatement`. Funciones puras: la lectura con la IA vive en lib/capture.

import type { CardLinesData, CardPrintedTotals, CardStatementLine } from "@/lib/capture/cardStatement";
import { addDays } from "./periods";
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
  /** Aclaración cuando el resumen se comprobó de otra forma (p. ej. los intereses no vienen detallados). */
  note?: string;
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

/** Cuota de una compra diferida de antes (el extracto la repite cada mes): la revisa la validación de cuotas. Un abono nunca es una cuota. */
const isInstallmentLine = (l: CardStatementLine) => !l.credit && (l.installmentNo ?? 1) > 1;

export interface CardLinesParsed {
  parsed: ParsedStatement;
  /** Cuotas de compras diferidas: no se cruzan aquí (en la app la compra es una sola); las revisa la validación de cuotas. */
  installmentLines: CardStatementLine[];
  /** Lo leído contra los totales del resumen del extracto. Vacío si el extracto no trae resumen. */
  totals: TotalCheck[];
}

interface Sums { charges: number; fees: number; interest: number; payOnly: number; allCredits: number; hasInterest: boolean }

function sumsOf(lines: CardStatementLine[]): Sums {
  const sum = (f: (l: CardStatementLine) => boolean) => lines.filter(f).reduce((a, l) => a + l.amount, 0);
  return {
    // Compras y cargos del periodo: todo lo que sube la deuda, salvo intereses y cobros del banco, que el resumen separa
    charges: sum((l) => !l.credit && l.kind !== "INTEREST" && l.kind !== "FEE"),
    fees: sum((l) => l.kind === "FEE" && !l.credit),
    interest: sum((l) => l.kind === "INTEREST" && !l.credit),
    // Pagos del titular, y "pagos y abonos" completo: también cuenta devoluciones, reversiones y puntos redimidos
    payOnly: sum((l) => l.credit && l.kind === "PAYMENT"),
    allCredits: sum((l) => l.credit && l.kind !== "INTEREST"),
    hasInterest: lines.some((l) => l.kind === "INTEREST"),
  };
}

/**
 * Compara lo que suman los movimientos leídos con los totales que imprime el extracto. Cada banco arma su resumen a su manera, así
 * que se prueban las formas razonables de sumar y se toma la que cuadra (si ninguna, la más cercana):
 *  · Lo facturado en este extracto: sin las cuotas de compras de antes (el extracto las repite cada mes con su valor original) ni las
 *    líneas de ciclos anteriores. El día del corte anterior cuenta: lo comprado después de la hora de corte se factura aquí.
 *  · Todas las líneas leídas, por si el banco sí cuenta esas cuotas en el resumen.
 *  · Seguros y comisiones dentro de "compras y cargos" (BBVA los cuenta ahí y deja "cuotas de manejo" en $0).
 *  · "Pagos y abonos" con o sin devoluciones y puntos.
 *  · Intereses: si el extracto no los detalla en los movimientos, no hay nada que sumar; se toma el total del resumen.
 */
export function checkPrintedTotals(lines: CardStatementLine[], printed: CardPrintedTotals, period?: { start: string; end: string } | null): TotalCheck[] {
  const from = period ? addDays(period.start, -1) : null;
  const billed = lines.filter((l) => !isInstallmentLine(l) && (!period || (l.date >= (from as string) && l.date <= period.end)));
  const sets = [sumsOf(billed), sumsOf(lines)];
  const near = (a: number, b: number) => Math.abs(a - b) <= TOTALS_TOLERANCE;
  /** La primera suma que cuadra con lo impreso; si ninguna, la más cercana de las candidatas. */
  const pickRead = (reads: number[], target: number, fallback: number[] = reads) => reads.find((r) => near(r, target)) ?? fallback.reduce((best, r) => (Math.abs(r - target) < Math.abs(best - target) ? r : best));
  const out: TotalCheck[] = [];

  // Compras y cargos (y comisiones, que algunos bancos cuentan dentro)
  let feesDone = false;
  if (printed.purchases !== undefined) {
    const pr = printed.purchases;
    const tries = sets.flatMap((x) => [
      { merged: false, read: x.charges, ok: near(x.charges, pr) && (printed.fees === undefined || near(x.fees, printed.fees)) },
      { merged: true, read: x.charges + x.fees, ok: near(x.charges + x.fees, pr + (printed.fees ?? 0)) },
    ]);
    const good = tries.find((t) => t.ok);
    if (good?.merged && printed.fees !== undefined) {
      // BBVA: los seguros y comisiones van dentro de "compras y cargos" y "cuotas de manejo" queda en $0
      out.push({ key: "purchases", label: "Compras, cargos y comisiones", read: good.read, printed: pr + printed.fees, ok: true });
      feesDone = true;
    } else if (good) {
      out.push({ key: "purchases", label: TOTAL_LABEL.purchases, read: good.read, printed: pr, ok: true });
    } else {
      out.push({ key: "purchases", label: TOTAL_LABEL.purchases, read: pickRead([], pr, sets.map((x) => x.charges)), printed: pr, ok: false });
    }
  }

  if (printed.payments !== undefined) {
    const pr = printed.payments;
    const read = pickRead([sets[0].allCredits, sets[0].payOnly, sets[1].payOnly, sets[1].allCredits], pr, [sets[0].allCredits, sets[1].payOnly]);
    out.push({ key: "payments", label: TOTAL_LABEL.payments, read, printed: pr, ok: near(read, pr) });
  }

  if (printed.interest !== undefined) {
    const pr = printed.interest;
    if (pr > 0 && !sets[1].hasInterest) {
      out.push({ key: "interest", label: TOTAL_LABEL.interest, read: pr, printed: pr, ok: true, note: "El extracto no los detalla en los movimientos: tomé el total del resumen." });
    } else {
      const read = pickRead(sets.map((x) => x.interest), pr, [sets[0].interest]);
      out.push({ key: "interest", label: TOTAL_LABEL.interest, read, printed: pr, ok: near(read, pr) });
    }
  }

  if (printed.fees !== undefined && !feesDone) {
    const pr = printed.fees;
    const read = pickRead(sets.map((x) => x.fees), pr, [sets[0].fees]);
    out.push({ key: "fees", label: TOTAL_LABEL.fees, read, printed: pr, ok: near(read, pr) });
  }
  return out;
}

export function parsedFromCardLines(data: CardLinesData): CardLinesParsed {
  const installmentLines = data.lines.filter(isInstallmentLine);
  const lines: StatementLine[] = [];
  data.lines.forEach((l, i) => {
    if (isInstallmentLine(l)) return;
    const amount = effectOf(l);
    lines.push({ id: `P${i + 1}`, date: l.date, description: l.description, amount, exact: amount, balance: null, kind: lineKind(l, amount) });
  });
  const read = lines.length;
  // Hay extractos (BBVA) que solo imprimen el total de intereses en el resumen y no lo detallan en los movimientos: sin esa línea la app
  // diría "intereses cobrados $0" y no se podrían registrar. Se toma el total del resumen, con la fecha del corte.
  const interest = data.totals.interest ?? 0;
  const cut = data.periodEnd ?? data.lines.map((l) => l.date).sort().pop();
  if (interest > 0 && cut && !data.lines.some((l) => l.kind === "INTEREST")) {
    lines.push({ id: "S:interest", date: cut, description: "Intereses del extracto (total del resumen)", amount: -interest, exact: -interest, balance: null, kind: "INTEREST_OUT" });
  }
  const warnings: string[] = [];
  if (read === 0) {
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
  return { parsed, installmentLines, totals: checkPrintedTotals(data.lines, data.totals, period) };
}
