import "server-only";

// Gemini lee el extracto de un crédito (PDF o foto). El archivo no se guarda en ningún lado.

import { sanitizeCreditStatement, type CreditStatementData } from "./creditStatement";
import { geminiGenerate, geminiModels } from "@/lib/ai/geminiCall";

const DEFAULT_MODEL = "gemini-flash-latest";

const schema = {
  type: "OBJECT",
  properties: {
    institution: { type: "STRING", nullable: true },
    credit_number: { type: "STRING", nullable: true },
    statement_date: { type: "STRING", nullable: true },
    due_date: { type: "STRING", nullable: true },
    capital_balance: { type: "NUMBER", nullable: true },
    rate_ea: { type: "NUMBER", nullable: true },
    term_months: { type: "INTEGER", nullable: true },
    installments_pending: { type: "INTEGER", nullable: true },
    installment_capital_interest: { type: "NUMBER", nullable: true },
    monthly_costs: { type: "NUMBER", nullable: true },
    amount_due: { type: "NUMBER", nullable: true },
    original_amount: { type: "NUMBER", nullable: true },
  },
};

const INSTRUCTIONS = `Lees el extracto o estado de cuenta de un crédito en Colombia (hipoteca, libre inversión, consumo, vehículo). Devuelve JSON:
- institution: nombre del banco (ej. "Banco Caja Social", "Bancolombia").
- credit_number: número del crédito u obligación, tal como aparece.
- statement_date: fecha de facturación o de corte del extracto (AAAA-MM-DD).
- due_date: fecha límite de pago, "Pague hasta" (AAAA-MM-DD).
- capital_balance: saldo a capital en pesos (no el valor a pagar ni el saldo total con intereses).
- rate_ea: tasa de interés efectiva anual en porcentaje. Si hay pactada y cobrada, usa la COBRADA. Si solo hay tasa mensual (MV), conviértela a efectiva anual: ((1+mv/100)^12-1)*100.
- term_months: plazo total en meses o número total de cuotas.
- installments_pending: cuotas pendientes, tal como aparecen.
- installment_capital_interest: de la cuota a pagar, abono a capital + intereses corrientes (sin seguros ni otros cargos, sin intereses de mora).
- monthly_costs: de la cuota a pagar, la suma de seguros (vida, incendio, terremoto, desempleo) y cargos fijos (comisiones, cuota de manejo). 0 si no hay.
- amount_due: valor total a pagar de la cuota.
- original_amount: valor inicial, monto desembolsado o valor del préstamo, SOLO si aparece así. No uses el valor asegurado.
Los montos van en pesos como número: en Colombia "2.405.745,56" o "2,405,745.56" es 2405745.56. Si algo no aparece, usa null. No inventes.`;

export async function readCreditStatement(file: { data: string; mime: string }): Promise<CreditStatementData> {
  const models = geminiModels(process.env.GEMINI_ASSISTANT_MODEL || DEFAULT_MODEL, process.env.GEMINI_MODEL);
  const out = await geminiGenerate(models, {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: file.mime, data: file.data } }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
  }, { timeoutMs: 40_000, deadlineMs: 55_000 });
  try {
    return sanitizeCreditStatement(JSON.parse(out) as Record<string, unknown>);
  } catch {
    throw new Error("No se pudo leer el extracto. Prueba con una foto más nítida o el PDF del banco.");
  }
}
