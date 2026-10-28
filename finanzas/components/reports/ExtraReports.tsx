"use client";
// Informes de la etapa 4: presupuesto frente a gasto real, gastos fijos y variables, y resumen para la renta.

import { useMemo, useState } from "react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { BarList, ChartCard } from "@/components/charts/Charts";
import { Segmented } from "@/components/ui/segmented";
import type { Transaction } from "@/lib/types";
import { statusesFor } from "@/lib/finance/derive";
import { formatCop, formatCopShort } from "@/lib/finance/money";
import { addDays, periodFor, shiftPeriod, todayBogota, type Period } from "@/lib/finance/periods";
import { fixedVsVariable, taxSummary, type ReportSpace } from "@/lib/finance/reports";
import { isKnownSubscription } from "@/lib/finance/subscriptions";
import { categoryPath } from "@/lib/finance/spaces";
import { shortPeriod } from "@/lib/finance/periodLabels";
import { cn } from "@/lib/utils";

/** Cuánto se usó de cada presupuesto de categoría en los últimos 4 periodos (más de 100 % = se pasó). */
export function BudgetVsActual({ space }: { space: ReportSpace }) {
  const state = useFinance();
  const { limits, categories, settings, me } = state;
  const periods = useMemo(() => {
    const cur = periodFor(settings, todayBogota());
    return Array.from({ length: 4 }, (_, i) => shiftPeriod(settings, cur, i - 3));
  }, [settings]);
  const statuses = useMemo(() => periods.map((p) => statusesFor(state, p)), [state, periods]);
  const shown = limits.filter((l) => categories.some((c) => c.id === l.category_id && !c.archived)
    && (space === "all" || (space === "household" ? l.scope === "HOUSEHOLD" : l.scope === "PERSONAL" && l.owner_user_id === me.user_id)));
  const rows = shown.map((l) => ({
    name: categoryPath(categories, l.category_id),
    cells: statuses.map((m) => {
      const st = m.get(l.id);
      return st && st.totalAvailable > 0 ? { pct: Math.round((st.totalSpent / st.totalAvailable) * 100), spent: st.totalSpent, budget: st.totalAvailable } : null;
    }),
  })).filter((r) => r.cells.some(Boolean));
  const over = rows.filter((r) => r.cells.filter((c) => c && c.pct > 100).length >= 2);

  return (
    <ChartCard title="Presupuesto frente a gasto real" subtitle="Cuánto usaste de cada presupuesto en los últimos 4 periodos. Más de 100 % es que te pasaste"
      table={{ columns: ["Presupuesto", ...periods.map(shortPeriod)], rows: rows.map((r) => [r.name, ...r.cells.map((c) => (c ? `${formatCop(c.spent)} de ${formatCop(c.budget)}` : "—"))]) }}>
      {rows.length === 0 ? <p className="text-sm text-muted">No hay presupuestos de categoría en esta vista.</p> : (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_repeat(4,3rem)] gap-1 text-[11px] text-muted">
            <span />{periods.map((p) => <span key={p.start} className="text-center">{shortPeriod(p)}</span>)}
          </div>
          {rows.map((r) => (
            <div key={r.name} className="grid grid-cols-[1fr_repeat(4,3rem)] items-center gap-1 text-sm">
              <span className="truncate">{r.name}</span>
              {r.cells.map((c, i) => (
                <span key={i} className={cn("num rounded-lg py-1 text-center text-xs font-semibold",
                  !c ? "text-muted" : c.pct > 100 ? "bg-danger-soft text-danger" : c.pct >= 80 ? "bg-warning-soft text-warning" : "bg-olive-soft text-text")}>
                  {c ? `${c.pct} %` : "—"}
                </span>
              ))}
            </div>
          ))}
          {over.length > 0 && (
            <p className="pt-2 text-xs text-muted">Te pasaste en 2 o más periodos en: <strong className="text-text">{over.map((r) => r.name).join(", ")}</strong>. Quizás conviene subir ese presupuesto o recortar ahí.</p>
          )}
        </div>
      )}
    </ChartCard>
  );
}

/** Gastos fijos (vencimientos, suscripciones, intereses de créditos) frente a variables, y las suscripciones activas. */
export function FixedVsVariable({ consumption, period }: { consumption: Transaction[]; period: Period }) {
  const { categories, accounts, transactions, me } = useFinance();
  const creditIds = useMemo(() => new Set(accounts.filter((a) => a.kind === "CREDIT").map((a) => a.id)), [accounts]);
  const r = useMemo(() => fixedVsVariable(consumption, period, { categories, creditIds }), [consumption, period, categories, creditIds]);
  // Suscripciones activas: cobros de los últimos 45 días marcados como suscripción, en una categoría de suscripciones
  // o de un servicio conocido (Netflix, Spotify…). Un mercado que se repite cada mes no es una suscripción.
  const list = useMemo(() => {
    const since = addDays(todayBogota(), -45);
    const subsCats = new Set(categories.filter((c) => /suscrip/i.test(c.name)).map((c) => c.id));
    const map = new Map<string, { name: string; amount: number; last: string }>();
    for (const t of transactions) {
      if (t.kind !== "EXPENSE" || t.payer_user_id !== me.user_id || t.occurred_on < since) continue;
      const isSub = t.tags.includes("#suscripcion") || t.splits.some((x) => x.category_id && subsCats.has(x.category_id)) || isKnownSubscription(t.merchant_norm);
      if (!isSub) continue;
      const k = (t.merchant_norm ?? t.merchant ?? t.description ?? "").toLowerCase();
      const cur = map.get(k);
      if (!cur || cur.last < t.occurred_on) map.set(k, { name: t.merchant ?? t.description ?? k, amount: t.amount, last: t.occurred_on });
    }
    return [...map.values()].sort((x, y) => y.amount - x.amount);
  }, [transactions, categories, me.user_id]);
  const fixed = r.scheduled + r.subscriptions + r.creditCharges;
  const total = fixed + r.variable;
  const items = [
    { key: "sch", label: "Vencimientos programados", value: r.scheduled },
    { key: "sub", label: "Suscripciones", value: r.subscriptions },
    { key: "cred", label: "Intereses y seguros de créditos", value: r.creditCharges },
    { key: "var", label: "Variables (el resto)", value: r.variable },
  ].filter((i) => i.value > 0);

  return (
    <ChartCard title="Gastos fijos y variables" subtitle={total > 0 ? `Fijos: ${Math.round((fixed / total) * 100)} % de lo gastado en el periodo` : "Lo que se repite cada periodo frente a lo que cambia"}
      table={{ columns: ["Tipo", "Total"], rows: items.map((i) => [i.label, i.value]) }}>
      {items.length === 0 ? <p className="text-sm text-muted">No hay gastos en este periodo.</p> : <BarList items={items} color="var(--series-1)" />}
      {r.creditCapital > 0 && <p className="mt-2 text-xs text-muted">Además abonaste {formatCop(r.creditCapital)} a capital de tus créditos (no es gasto: baja la deuda).</p>}
      {list.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-1.5 text-sm font-medium">Tus suscripciones activas · {formatCop(list.reduce((s, x) => s + x.amount, 0))} al mes</p>
          <div className="divide-y divide-border">
            {list.slice(0, 8).map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="truncate">{s.name}</span><span className="num shrink-0">{formatCop(s.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

/** Resumen del año para la declaración de renta (de la persona que mira). */
export function TaxSummaryCard() {
  const { transactions, categories, accounts, me } = useFinance();
  const thisYear = Number(todayBogota().slice(0, 4));
  const [year, setYear] = useState(thisYear - (Number(todayBogota().slice(5, 7)) <= 8 ? 1 : 0));
  const s = useMemo(() => taxSummary(transactions, { userId: me.user_id, year, categories, accounts }), [transactions, me.user_id, year, categories, accounts]);
  const row = (label: string, value: number, hint?: string) => (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="min-w-0"><span className="block">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
      <span className="num shrink-0 font-semibold">{formatCop(value)}</span>
    </div>
  );
  return (
    <ChartCard title="Resumen para la renta" subtitle="Lo tuyo del año según lo registrado en la app. Es una guía: los valores oficiales salen de los certificados de tus bancos"
      table={{ columns: ["Concepto", "Valor"], rows: [["Ingresos", s.income], ...s.incomeByCategory.map((i) => [`  ${i.name}`, i.total] as [string, number]), ["4x1000 pagado", s.gmf], ...s.credits.flatMap((c) => [[`${c.name}: intereses y seguros`, c.charges], [`${c.name}: abono a capital`, c.capital]] as [string, number][])] }}>
      <Segmented className="mb-2" value={String(year)} onChange={(v) => setYear(Number(v))}
        options={[{ value: String(thisYear - 1), label: String(thisYear - 1) }, { value: String(thisYear), label: `${thisYear} (en curso)` }]} />
      <div className="divide-y divide-border">
        {row("Ingresos del año", s.income, s.incomeByCategory.length ? s.incomeByCategory.slice(0, 4).map((i) => `${i.name} ${formatCopShort(i.total)}`).join(" · ") : "Ninguno registrado")}
        {row("4x1000 (GMF) pagado", s.gmf, "La mitad es deducible con el certificado del banco.")}
        {s.credits.map((c) => row(`${c.name}: intereses y seguros`, c.charges, `${c.payments} cuota${c.payments === 1 ? "" : "s"} · abono a capital ${formatCop(c.capital)}. Los intereses de un crédito de vivienda son deducibles; el certificado del banco los separa de los seguros.`))}
        {s.credits.length === 0 && <p className="py-2 text-xs text-muted">No hay cuotas de créditos registradas en {year}.</p>}
      </div>
      {year === thisYear && <p className="mt-2 text-xs text-muted">El año va en curso: los valores crecen hasta el 31 de diciembre.</p>}
    </ChartCard>
  );
}
