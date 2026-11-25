// Lectura del extracto de un crédito directamente del PDF, sin IA: instantánea, gratis y no se inventa nada.
// Por ahora entiende el extracto de Addi; si el PDF es de otra entidad, no cuadra o la librería no carga, devuelve null y
// la ruta usa la lectura con Gemini como siempre. Para sumar una entidad: un lector nuevo en lib/capture/pdf y una línea en READERS.

import { sanitizeCreditStatement, type CreditStatementData } from "./creditStatement";
import { parseAddiCreditStatement } from "./pdf/addiCredit";
import { extractPdfItems } from "./pdf/extract";
import type { PdfTextItem } from "./pdf/rows";
import { LockedPdfError } from "./cardStatementLocal";

export interface LocalCreditRead {
  institution: string;
  statement: CreditStatementData;
}

interface CreditReader {
  institution: string;
  parse: (items: PdfTextItem[]) => { statement: Record<string, unknown> } | null;
}

const READERS: CreditReader[] = [{ institution: "Addi", parse: parseAddiCreditStatement }];

/** Solo devuelve algo si la lectura es de fiar: el lector validó sus totales y quedan fecha del extracto, fecha de pago y valor a pagar. */
export function readLocalCreditStatement(items: PdfTextItem[]): LocalCreditRead | null {
  for (const reader of READERS) {
    const raw = reader.parse(items);
    if (!raw) continue;
    const statement = sanitizeCreditStatement(raw.statement);
    if (!statement.statementDate || !statement.dueDate || !statement.amountDue) return null;
    return { institution: reader.institution, statement };
  }
  return null;
}

/** Igual, desde el archivo (base64). null si no es un PDF, no se pudo leer o no es un formato conocido. Solo lanza `LockedPdfError`. */
export async function readCreditStatementLocal(file: { data: string; mime: string }): Promise<LocalCreditRead | null> {
  if (file.mime !== "application/pdf") return null;
  try {
    const items = await extractPdfItems(new Uint8Array(Buffer.from(file.data, "base64")));
    return readLocalCreditStatement(items);
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") throw new LockedPdfError();
    console.warn("[credit-statement] no se pudo leer el PDF directo, se usa Gemini:", e instanceof Error ? e.message : "error desconocido");
    return null;
  }
}
