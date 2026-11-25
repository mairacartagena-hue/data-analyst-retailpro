import "server-only";

// Gemini lee el extracto de una tarjeta de crédito (PDF o foto). El archivo no se guarda en ningún lado.

import { sanitizeCardLines, sanitizeCardStatement, type CardLinesData, type CardStatementData } from "./cardStatement";
import { geminiGenerate, geminiModels } from "@/lib/ai/geminiCall";

const DEFAULT_MODEL = "gemini-flash-latest";

const schema = {
  type: "OBJECT",
  properties: {
    institution: { type: "STRING", nullable: true },
    card_number: { type: "STRING", nullable: true },
    statement_date: { type: "STRING", nullable: true },
    due_date: { type: "STRING", nullable: true },
    total_debt: { type: "NUMBER", nullable: true },
    total_payment: { type: "NUMBER", nullable: true },
    minimum_payment: { type: "NUMBER", nullable: true },
    credit_limit: { type: "NUMBER", nullable: true },
    rate_ea: { type: "NUMBER", nullable: true },
    purchases: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          purchase_date: { type: "STRING", nullable: true },
          amount: { type: "NUMBER" },
          installments: { type: "INTEGER" },
          paid_installments: { type: "INTEGER" },
          remaining_balance: { type: "NUMBER" },
          monthly_charge: { type: "NUMBER", nullable: true },
          rate_ea: { type: "NUMBER", nullable: true },
        },
      },
    },
  },
};

const INSTRUCTIONS = `Lees el extracto o estado de cuenta de una tarjeta de crédito en Colombia. Devuelve JSON:
- institution: nombre del banco.
- card_number: número de la tarjeta (los dígitos visibles, aunque estén enmascarados).
- statement_date: fecha de corte o de facturación (AAAA-MM-DD).
- due_date: fecha límite de pago (AAAA-MM-DD).
- total_debt: deuda total / saldo total de la tarjeta a la fecha de corte, en pesos.
- total_payment: pago total o "para no generar intereses".
- minimum_payment: pago mínimo del mes (lo mínimo a pagar en la fecha límite).
- credit_limit: cupo total.
- rate_ea: tasa efectiva anual cobrada en porcentaje (si solo hay mensual MV, conviértela: ((1+mv/100)^12-1)*100).
- purchases: TODAS las compras diferidas a 2 o más cuotas que aún tienen saldo por pagar, una por fila, aunque sean muchas (pueden ser más de 70; revisa todas las páginas). Para cada una: description (comercio), purchase_date (AAAA-MM-DD), amount (valor original de la compra), installments (total de cuotas), paid_installments (número de la cuota que se factura en este extracto: "cuota 3 de 12" o "3/12" → 3), remaining_balance (saldo diferido pendiente después de esta cuota), monthly_charge (el cargo del mes de esa compra: lo que el extracto factura este mes por ella, capital más intereses; si trae capital e intereses en columnas separadas, súmalos; null si no aparece), rate_ea si aparece. No incluyas compras a 1 cuota ni agrupes compras.
Los montos van en pesos como número: en Colombia "2.405.745,56" o "2,405,745.56" es 2405745.56. Si algo no aparece, usa null. No inventes.`;

export async function readCardStatement(file: { data: string; mime: string }, today: string): Promise<CardStatementData> {
  const models = geminiModels(process.env.GEMINI_ASSISTANT_MODEL || DEFAULT_MODEL, process.env.GEMINI_MODEL);
  const out = await geminiGenerate(models, {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: file.mime, data: file.data } }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
  }, { timeoutMs: 40_000, deadlineMs: 55_000 });
  try {
    return sanitizeCardStatement(JSON.parse(out) as Record<string, unknown>, today);
  } catch {
    throw new Error("No se pudo leer el extracto. Prueba con una foto más nítida o el PDF del banco.");
  }
}

// ───────────────────── Movimientos del periodo (segunda lectura, opcional) ─────────────────────

const linesSchema = {
  type: "OBJECT",
  properties: {
    institution: { type: "STRING", nullable: true },
    card_number: { type: "STRING", nullable: true },
    period_start: { type: "STRING", nullable: true },
    period_end: { type: "STRING", nullable: true },
    printed_totals: {
      type: "OBJECT",
      nullable: true,
      properties: {
        purchases: { type: "NUMBER", nullable: true },
        payments: { type: "NUMBER", nullable: true },
        interest: { type: "NUMBER", nullable: true },
        fees: { type: "NUMBER", nullable: true },
      },
    },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          description: { type: "STRING" },
          amount: { type: "NUMBER" },
          kind: { type: "STRING" }, // PURCHASE | PAYMENT | INTEREST | FEE | OTHER (se valida al leer)
          is_credit: { type: "BOOLEAN" },
          installment_no: { type: "INTEGER", nullable: true },
        },
      },
    },
  },
};

const LINES_INSTRUCTIONS = `Lees el extracto o estado de cuenta de una tarjeta de crédito en Colombia y devuelves SOLO los movimientos del periodo facturado, en JSON:
- institution y card_number (dígitos visibles de la tarjeta).
- period_start y period_end: el periodo que cubre el extracto (AAAA-MM-DD). Si solo aparece la fecha de corte, period_end es esa y period_start es el día siguiente al corte anterior.
- printed_totals: los totales del RESUMEN del extracto, tal cual los imprime el banco (no los calcules): purchases (compras y cargos del periodo), payments (pagos y abonos), interest (intereses corrientes y de mora cobrados), fees (cuota de manejo, comisiones, seguros). Si el extracto no trae alguno, null.
- lines: UN movimiento por fila, en el orden del documento, todas las páginas. Para cada uno: date (AAAA-MM-DD; si el extracto trae solo día y mes, completa el año con el del periodo), description (comercio o concepto), amount (valor en pesos, SIEMPRE positivo), kind, is_credit, installment_no.
  kind: PURCHASE = compra o avance; PAYMENT = pago o abono que hizo el titular; INTEREST = intereses cobrados; FEE = cuota de manejo, comisión, seguro, IVA u otro cobro del banco; OTHER = ajustes y lo demás.
  is_credit: true si el movimiento BAJA la deuda (pagos, abonos, devoluciones, reversiones, notas crédito); false si la sube (compras, intereses, cobros).
  installment_no: si la línea es la cuota de una compra diferida ("cuota 3 de 12", "3/12" → 3), ese número; si es una compra nueva o no es una cuota, null.
No incluyas encabezados, subtotales, totales ni la tabla de "compras diferidas / saldo pendiente" (solo los movimientos facturados). No agrupes ni resumas movimientos, no inventes. Los montos van en pesos como número: en Colombia "2.405.745,56" o "2,405,745.56" es 2405745.56.`;

/** Lee los movimientos del extracto. Tarda más que la lectura de totales (puede ser una lista larga), por eso tiene más tiempo. */
export async function readCardStatementLines(file: { data: string; mime: string }, today: string): Promise<CardLinesData> {
  const models = geminiModels(process.env.GEMINI_ASSISTANT_MODEL || DEFAULT_MODEL, process.env.GEMINI_MODEL);
  const out = await geminiGenerate(models, {
    systemInstruction: { parts: [{ text: `${LINES_INSTRUCTIONS}\nHoy es ${today}.` }] },
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: file.mime, data: file.data } }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: linesSchema, temperature: 0 },
  }, { timeoutMs: 52_000, deadlineMs: 57_000 });
  try {
    return sanitizeCardLines(JSON.parse(out) as Record<string, unknown>, today);
  } catch {
    throw new Error("No se pudo leer la lista de movimientos del extracto (puede ser muy larga). Usa el Excel o CSV del banco.");
  }
}
