// Contexto para el asistente de IA: un resumen en texto de lo que la persona puede ver en la app
// (la base de datos ya filtró lo privado de la pareja). Se arma en el celular y se envía con la pregunta.

import { creditBudgetMap } from "@/lib/finance/spaces";
import { cardBudgetMap } from "@/lib/finance/cardBudget";
import type { FinanceState } from "@/lib/data/FinanceProvider";
import { ACCOUNT_KIND_LABEL, TX_KIND_LABEL } from "@/lib/types";
import { accountLabel } from "@/lib/finance/labels";
import { categoryPath } from "@/lib/finance/spaces";
import { monthlyTrend, spendingByCategory } from "@/lib/finance/reports";
import { safeToSpendFor, statusesFor, crossNet, netWorth } from "@/lib/finance/derive";
import { capitalPaidRatio, installmentLabel, nextCuota } from "@/lib/finance/credit";
import { goalProgress } from "@/lib/finance/goals";
import { occurrencesIn } from "@/lib/finance/commitments";
import { addDays } from "@/lib/finance/periods";

/** Tamaño máximo del contexto (caracteres). Los movimientos más viejos se recortan primero. */
export const MAX_CONTEXT = 90_000;

const cop = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function buildAiContext(s: FinanceState, today: string): string {
  const name = (uid: string | null | undefined) => s.memberById(uid)?.display_name ?? "otra persona";
  const cat = (id: string | null | undefined) => (id ? categoryPath(s.categories, id) || "Categoría privada" : "Sin categoría");
  const lines: string[] = [];
  const add = (...l: string[]) => lines.push(...l);

  add(
    `Hoy: ${today}. Moneda: pesos colombianos (COP).`,
    `Persona que pregunta: ${s.me.display_name}.${s.partner ? ` Pareja: ${s.partner.display_name}.` : " Sin pareja en el hogar todavía."}`,
    `Periodo actual: ${s.period.start} a ${s.period.end}.`,
  );

  // Saldo seguro, patrimonio y cruce
  try {
    const statuses = statusesFor(s, s.period);
    const safe = safeToSpendFor(s, s.period, statuses);
    add("", "## Resumen", `Saldo seguro para gastar de ${s.me.display_name} en el periodo: ${cop(safe.total)}.`);
    const nw = netWorth(s, "me");
    add(`Patrimonio neto de ${s.me.display_name}: ${cop(nw.total)} (activos ${cop(nw.assets)}, deudas ${cop(nw.liabilities)}).`);
    if (s.partner) {
      const net = crossNet(s);
      add(net === 0 ? "Cruce con la pareja: a paz y salvo." : net < 0 ? `Cruce: ${s.me.display_name} le debe ${cop(-net)} a ${s.partner.display_name}.` : `Cruce: ${s.partner.display_name} le debe ${cop(net)} a ${s.me.display_name}.`);
    }

    // Presupuestos del periodo
    const limits = s.limits.map((l) => ({ l, st: statuses.get(l.id) })).filter((x) => x.st);
    if (limits.length) {
      add("", "## Presupuestos del periodo actual (categoría · ámbito · disponible · gastado)");
      for (const { l, st } of limits) {
        add(`- ${cat(l.category_id)} · ${l.scope === "HOUSEHOLD" ? "hogar" : "personal"} · ${cop(st!.totalAvailable)} · ${cop(st!.totalSpent)}`);
      }
    }
  } catch {
    // Si algún cálculo falla, el resto del contexto sigue siendo útil
  }

  // Cuentas y créditos visibles
  add("", "## Cuentas (nombre · tipo · dueño · saldo)");
  for (const a of s.accounts.filter((x) => !x.archived)) {
    const bal = s.balances[a.id];
    const owner = a.owner_user_id === s.me.user_id ? s.me.display_name : name(a.owner_user_id);
    add(`- ${accountLabel(s.labels, a.id) || a.name} · ${ACCOUNT_KIND_LABEL[a.kind]} · ${owner} · ${bal === undefined ? "saldo oculto" : cop(bal)}`);
    if (a.kind === "CREDIT" && bal !== undefined && bal < 0) {
      const owed = -bal;
      const parts = [`  crédito: debe ${cop(owed)}`, `cuota estimada ${cop(nextCuota(owed, a, today))}`];
      const inst = installmentLabel(a, today);
      if (inst) parts.push(inst.toLowerCase());
      if (a.interest_rate_ea) parts.push(`tasa ${a.interest_rate_ea} % EA`);
      if (a.due_day) parts.push(`paga el día ${a.due_day}`);
      const r = capitalPaidRatio(a.original_amount, owed);
      if (r !== null) parts.push(`valor inicial ${cop(a.original_amount!)}, pagado ${Math.round(r * 100)} % del capital`);
      add(parts.join(" · "));
    }
    if (a.kind === "CREDIT_CARD" && a.due_day) add(`  tarjeta: corte el ${a.statement_day ?? "?"}, pago el ${a.due_day}${a.credit_limit ? `, cupo ${cop(a.credit_limit)}` : ""}`);
  }
  for (const m of s.assets) add(`- ${m.name} · ${m.kind === "LIABILITY" ? "pasivo manual" : "activo manual"} · ${name(m.owner_user_id)} · ${cop(m.value)}`);

  // Metas de ahorro
  const goals = (s.goals ?? []).filter((g) => g.status === "ACTIVE");
  if (goals.length) {
    add("", "## Metas de ahorro activas");
    for (const g of goals) {
      const p = goalProgress(g, s.contributions ?? [], today);
      add(`- ${g.name}: ahorrado ${cop(p.saved)} de ${cop(g.target_amount)}${g.target_date ? `, fecha ${g.target_date}` : ""}${p.neededPerMonth ? `, faltan ${cop(p.neededPerMonth)} al mes` : ""}`);
    }
  }

  // Próximos pagos programados
  const occ = occurrencesIn(s.commitments, s.transactions, { start: addDays(today, -7), end: addDays(today, 30) }, today, new Map([...creditBudgetMap(s.accounts), ...cardBudgetMap(s.accounts)]));
  if (occ.length) {
    add("", "## Pagos programados (últimos 7 días y próximos 30)");
    for (const o of occ) add(`- ${o.due} · ${o.payment.name} · ${cop(o.payment.amount)} · ${o.paid ? "pagado" : o.overdue ? "vencido sin pagar" : "pendiente"}`);
  }

  // Ingresos y gastos por mes (12 meses) y gasto por categoría (6 meses)
  const consumption = s.consumption ?? s.transactions;
  const months = lastMonths(today, 12);
  add("", "## Ingresos y gastos por mes (mes · ingresos · gastos)");
  for (const r of monthlyTrend(consumption, months)) add(`- ${r.month} · ${cop(r.income)} · ${cop(r.expense)}`);
  add("", "## Gasto por categoría y mes (últimos 6 meses; las compras a cuotas cuentan su cuota de cada mes)");
  for (const m of months.slice(-6)) {
    const rows = spendingByCategory(consumption, s.categories, { start: `${m}-01`, end: monthEnd(m) });
    if (rows.length) add(`${m}: ${rows.map((r) => `${r.name || "Sin categoría"} ${cop(r.total)}`).join("; ")}`);
  }

  // Movimientos recientes (los más nuevos primero; se recortan si no caben)
  const head = lines.join("\n");
  const txLines: string[] = [];
  const since = addDays(today, -180);
  const recent = s.transactions
    .filter((t) => t.occurred_on >= since)
    .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0));
  let size = head.length + 200;
  for (const t of recent) {
    const cats = t.splits.length ? [...new Set(t.splits.map((x) => cat(x.category_id)))].join(" + ") : "";
    const line = [
      t.occurred_on,
      TX_KIND_LABEL[t.kind],
      cop(t.amount),
      t.description || t.merchant || "",
      cats,
      t.scope === "HOUSEHOLD" ? "hogar" : "personal",
      `pagó ${t.payer_user_id === s.me.user_id ? s.me.display_name : name(t.payer_user_id)}`,
      t.account_id ? accountLabel(s.labels, t.account_id) : "",
      (t.installments ?? 1) > 1 ? `${t.installments} cuotas` : "",
      t.status === "PENDING_REVIEW" ? "por revisar" : "",
    ].filter(Boolean).join(" · ");
    if (size + line.length + 3 > MAX_CONTEXT) break;
    size += line.length + 3;
    txLines.push(`- ${line}`);
  }
  const shownFrom = txLines.length ? recent[txLines.length - 1].occurred_on : today;
  return `${head}\n\n## Movimientos desde ${shownFrom} (fecha · tipo · valor · descripción · categoría · ámbito · quién pagó · cuenta)\n${txLines.join("\n")}`;
}
