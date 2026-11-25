// Lectura del extracto de una tarjeta de crédito directamente del PDF, sin IA: es instantánea, gratis y no se inventa nada.
// Por ahora entiende el formato de BBVA; si el PDF es de otro banco, no cuadra o la librería no carga, devuelve null y
// la ruta usa la lectura con Gemini como siempre. Para sumar un banco: un lector nuevo en lib/capture/pdf y una línea en READERS.

import { parsedFromCardLines } from "@/lib/finance/cardLines";
import { sanitizeCardLines, sanitizeCardStatement, type CardLinesData, type CardStatementData } from "./cardStatement";
import { ADDI_NO_INSTALLMENTS, ADDI_NO_LINES, addiAsCardStatement, parseAddiCreditStatement } from "./pdf/addiCredit";
import { parseBbvaCardStatement } from "./pdf/bbvaCard";
import { extractPdfItems } from "./pdf/extract";
import type { PdfTextItem } from "./pdf/rows";

export interface LocalCardRead {
  bank: string;
  /** Totales y compras diferidas (lo mismo que `readCardStatement`). */
  statement: CardStatementData;
  /** Movimientos del periodo y totales impresos (lo mismo que `readCardStatementLines`). null si el extracto no los trae. */
  lines: CardLinesData | null;
  /** Por qué no hay movimientos (para mostrarlo en vez de mandar el archivo a la IA). */
  linesNote?: string;
}

/** El PDF tiene contraseña: ni la app ni la IA lo pueden abrir. */
export class LockedPdfError extends Error {
  constructor() {
    super("El PDF tiene contraseña. Ábrelo con la contraseña y guárdalo sin ella (o súbelo desbloqueado) y vuelve a intentarlo.");
  }
}

interface BankReader {
  bank: string;
  parse: (items: PdfTextItem[]) => { statement: Record<string, unknown>; lines: Record<string, unknown> } | null;
}

const READERS: BankReader[] = [{ bank: "BBVA", parse: parseBbvaCardStatement }];

/**
 * Lee el extracto a partir del texto del PDF. Solo devuelve algo si la lectura es de fiar: el resumen del extracto cuadra, trae
 * fecha de corte y deuda, y los movimientos suman lo que el propio extracto imprime en compras, pagos e intereses.
 */
export function readLocalCardStatement(items: PdfTextItem[], today: string): LocalCardRead | null {
  // Addi: no es una tarjeta con movimientos, pero su extracto sí trae deuda, pago mínimo y fechas (validados por el lector)
  const addi = parseAddiCreditStatement(items);
  if (addi) {
    const statement = sanitizeCardStatement(addiAsCardStatement(addi), today);
    if (!statement.statementDate || !statement.totalDebt || !statement.minimumPayment) return null;
    return { bank: "Addi", statement: { ...statement, installmentsNote: ADDI_NO_INSTALLMENTS }, lines: null, linesNote: ADDI_NO_LINES };
  }
  for (const reader of READERS) {
    const raw = reader.parse(items);
    if (!raw) continue;
    const statement = sanitizeCardStatement(raw.statement, today);
    const lines = sanitizeCardLines(raw.lines, today);
    if (!statement.statementDate || !statement.totalDebt || lines.lines.length === 0) return null;
    const checks = parsedFromCardLines(lines).totals;
    if (checks.length === 0 || !checks.every((c) => c.ok)) return null;
    return { bank: reader.bank, statement, lines };
  }
  return null;
}

/** Igual, desde el archivo (base64). null si no es un PDF, no se pudo leer o no es un formato conocido. Solo lanza `LockedPdfError`. */
export async function readCardStatementLocal(file: { data: string; mime: string }, today: string): Promise<LocalCardRead | null> {
  if (file.mime !== "application/pdf") return null;
  try {
    const items = await extractPdfItems(new Uint8Array(Buffer.from(file.data, "base64")));
    return readLocalCardStatement(items, today);
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") throw new LockedPdfError();
    // Sin esto, un fallo de la librería en el servidor pasaría desapercibido (la ruta simplemente usa Gemini): queda en los logs de Vercel
    console.warn("[card-statement] no se pudo leer el PDF directo, se usa Gemini:", e instanceof Error ? e.message : "error desconocido");
    return null;
  }
}
