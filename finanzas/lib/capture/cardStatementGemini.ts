import "server-only";

// Gemini lee el extracto de una tarjeta de crédito (PDF o foto). El archivo no se guarda en ningún lado.

import { sanitizeCardStatement, type CardStatementData } from "./cardStatement";
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
- minimum_payment: pago mínimo.
- credit_limit: cupo total.
- rate_ea: tasa efectiva anual cobrada en porcentaje (si solo hay mensual MV, conviértela: ((1+mv/100)^12-1)*100).
- purchases: SOLO las compras diferidas a 2 o más cuotas que aún tienen saldo por pagar (sección de "compras a cuotas", "saldo diferido"). Para cada una: description (comercio), purchase_date (AAAA-MM-DD), amount (valor original de la compra), installments (total de cuotas), paid_installments (cuotas ya facturadas/pagadas, sin contar las que faltan), remaining_balance (saldo diferido pendiente), rate_ea si aparece. No incluyas compras a 1 cuota.
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
