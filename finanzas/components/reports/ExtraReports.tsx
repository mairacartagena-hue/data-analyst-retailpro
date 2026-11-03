"use client";
// Informes de la etapa 4: presupuesto frente a gasto real, gastos fijos y variables, y resumen para la renta.

import { useMemo, useState } from "react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { BarList, ChartCard } from "@/components/charts/Charts";
import { Segmented } from "@/components/ui/segmented";
import type { Transaction } from "@/lib/types";
import { statusesFor } from "@/lib/finance/derive";
import { formatCop, formatCopShort } from "@/lib/finance/money";
import { addDays, formatDay, periodFor, shiftPeriod, todayBogota, type Period } from "@/lib/finance/periods";
import { creditChargeIds, fixedVariableItems, taxSummary, type FixedKind, type ReportSpace } from "@/lib/finance/reports";
import { useShell } from "@/components/AppShell";
import { Sheet } from "@/components/ui/sheet";

import { isKnownSubscription } from "@/lib/finance/subscriptions";
import { categoryPath } from "@/lib/finance/spaces";
import { shortPeriod } from "@/lib/finance/periodLabels";
import { cn } from "@/lib/utils";

/** Cuánto se usó de cada presupuesto de categoría en los últimos 3 periodos (más de 100 % = se pasó). */
export function BudgetVsActual({ space }: { space: ReportSpace }) {
  const state = useFinance();
  const { limits, categories, settings, me } = state;
  const periods = useMemo(() => {
    const cur = periodFor(settings, todayBogota());
    return Array.from({ length: 3 }, (_, i) => shiftPeriod(settings, cur, i - 2));
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
    <ChartCard id="presupuesto-real" defaultOpen={false} summary={(() => { const n = rows.filter((r) => (r.cells[r.cells.length - 1]?.pct ?? 0) > 100).length; return n ? `${n} pasado${n === 1 ? "" : "s"} este periodo` : `${rows.length} presupuesto${rows.length === 1 ? "" : "s"}, ninguno pasado este periodo`; })()} title="Presupuesto frente a gasto real" subtitle="Cuánto usaste de cada presupuesto en los últimos 3 periodos. Más de 100 % es que te pasaste"
      table={{ columns: ["Presupuesto", ...periods.map(shortPeriod)], rows: rows.map((r) => [r.name, ...r.cells.map((c) => (c ? `${formatCop(c.spent)} de ${formatCop(c.budget)}` : "—"))]) }}>
      {rows.length === 0 ? <p className="text-sm text-muted">No hay presupuestos de categoría en esta vista.</p> : (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_repeat(3,3.5rem)] gap-1 text-[11px] text-muted">
            <span />{periods.map((p) => <span key={p.start} className="text-center">{shortPeriod(p)}</span>)}
          </div>
          {rows.map((r) => (
            <div key={r.name} className="grid grid-cols-[1fr_repeat(3,3.5rem)] items-center gap-1 text-sm">
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

/** Gastos fijos (vencimientos, suscripciones, cuotas de créditos) frente a variables, y las suscripciones activas. */
export function FixedVsVariable({ consumption, period }: { consumption: Transaction[]; period: Period }) {
  const { categories, accounts, transactions, me } = useFinance();
  const creditIds = useMemo(() => new Set(accounts.filter((a) => (a.kind === "CREDIT" || a.kind === "LOAN") && a.household_id === me.household_id).map((a) => a.id)), [accounts]);
  // Intereses y seguros de las cuotas pagados desde una cuenta: también son cuota del crédito
  const chargeIds = useMemo(() => creditChargeIds(accounts.filter((a) => creditIds.has(a.id)), transactions), [accounts, creditIds, transactions]);
  const all = useMemo(() => fixedVariableItems(consumption, period, { categories, creditIds, chargeIds }), [consumption, period, categories, creditIds, chargeIds]);
  const r = useMemo(() => {
    const out: Record<FixedKind, number> = { scheduled: 0, subscriptions: 0, creditCharges: 0, variable: 0 };
    for (const i of all) out[i.kind] += i.amount;
    return out;
  }, [all]);
  // Al tocar Fijos, Variables o un tipo de fijo: la lista de los gastos que lo componen
  const [shown, setShown] = useState<"fixed" | FixedKind | null>(null);
  // Suscripciones activas: cobros de los últimos 45 días marcados como suscripción, en una categoría de suscripciones
  // o de un servicio conocido (Netflix, Spotify…). Un mercado que se repite cada mes no es una suscripción.
  const list = useMemo(() => {
    const since = addDays(todayBogota(), -45);
    const subsCats = new Set(categories.filter((c) => /suscrip/i.test(c.name)).map((c) => c.id));
    const map = new Map<string, { name: string; amount: number; last: string }>();
    for (const t of transactions) {
      if (t.kind !== "EXPENSE" || t.payer_user_id !== me.user_id || t.occurred_on < since) continue;
      // Solo compras: una transferencia que se repite cada mes (a un familiar) no es una suscripción
      if (t.movement_type && t.movement_type !== "PURCHASE") continue;
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
  // Detalle de lo fijo (lo variable es un solo total)
  const items = [
    { key: "scheduled", label: FIXED_LABELS.scheduled, value: r.scheduled },
    { key: "subscriptions", label: FIXED_LABELS.subscriptions, value: r.subscriptions },
    { key: "creditCharges", label: FIXED_LABELS.creditCharges, value: r.creditCharges },
  ].filter((i) => i.value > 0);
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  return (
    <ChartCard id="fijos" defaultOpen={false} summary={total > 0 ? `Fijos ${formatCopShort(fixed)} (${Math.round((fixed / total) * 100)} %) · variables ${formatCopShort(r.variable)}` : "Sin gastos en el periodo"} title="Gastos fijos y variables" subtitle="Fijos: vencimientos programados, suscripciones y cuotas de créditos (capital, intereses y seguros). Variables: todo lo demás"
      table={{ columns: ["Tipo", "Total"], rows: [["Fijos", fixed], ...items.map((i) => [`  ${i.label}`, i.value] as [string, number]), ["Variables", r.variable]] }}>
      {total === 0 ? <p className="text-sm text-muted">No hay gastos en este periodo.</p> : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setShown("fixed")} className="rounded-2xl bg-surface-2 px-3 py-2.5 text-left hover:bg-border/40">
              <p className="text-xs text-muted">Fijos · {pct(fixed)} %</p>
              <p className="num font-display text-xl">{formatCop(fixed)}</p>
              <p className="text-xs font-semibold text-olive">Ver qué son</p>
            </button>
            <button type="button" onClick={() => setShown("variable")} className="rounded-2xl bg-surface-2 px-3 py-2.5 text-left hover:bg-border/40">
              <p className="text-xs text-muted">Variables · {pct(r.variable)} %</p>
              <p className="num font-display text-xl">{formatCop(r.variable)}</p>
              <p className="text-xs font-semibold text-olive">Ver qué son</p>
            </button>
          </div>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <span className="h-full" style={{ width: `${pct(fixed)}%`, background: "var(--series-1)" }} />
            <span className="h-full" style={{ width: `${pct(r.variable)}%`, background: "var(--series-2)" }} />
          </div>
          {items.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-sm font-medium">De qué son los fijos</p>
              <BarList items={items} color="var(--series-1)" onSelect={(k) => setShown(k as FixedKind)} />
            </div>
          )}
        </>
      )}
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
      <FixedVariableSheet shown={shown} items={all} onClose={() => setShown(null)} />
    </ChartCard>
  );
}

const FIXED_LABELS: Record<FixedKind, string> = {
  scheduled: "Vencimientos programados",
  subscriptions: "Suscripciones",
  creditCharges: "Cuotas de créditos",
  variable: "Gastos variables",
};

/** Los gastos que componen los fijos (por tipo) o los variables; cada uno abre su movimiento. */
function FixedVariableSheet({ shown, items, onClose }: {
  shown: "fixed" | FixedKind | null;
  items: ReturnType<typeof fixedVariableItems>;
  onClose: () => void;
}) {
  const { transactions, categories } = useFinance();
  const { openTransaction } = useShell();
  const kinds: FixedKind[] = shown === "fixed" ? ["scheduled", "subscriptions", "creditCharges"] : shown ? [shown] : [];
  const groups = kinds
    .map((k) => ({
      kind: k,
      rows: items.filter((i) => i.kind === k).sort((a, b) => b.t.occurred_on.localeCompare(a.t.occurred_on) || b.amount - a.amount),
    }))
    .filter((g) => g.rows.length > 0);
  const total = groups.reduce((s, g) => s + g.rows.reduce((a, i) => a + i.amount, 0), 0);
  const title = shown === "fixed" ? "Gastos fijos" : shown ? FIXED_LABELS[shown] : "";
  // El abono a capital de una cuota es un renglón armado para el informe: abre la transferencia al crédito
  const original = (t: Transaction) => t.installment_of
    ?? (t.id.startsWith("capital:") ? transactions.find((x) => x.id === t.id.slice("capital:".length)) ?? null : t);

  return (
    <Sheet open={!!shown} onOpenChange={(v) => !v && onClose()} title={title} description={`${formatCop(total)} en el periodo`}>
      <div className="space-y-4 pb-2">
        {groups.length === 0 && <p className="text-sm text-muted">No hay gastos de este tipo en el periodo.</p>}
        {groups.map((g) => (
          <div key={g.kind}>
            {kinds.length > 1 && (
              <div className="mb-1.5 flex items-baseline justify-between px-1 text-sm">
                <span className="font-medium">{FIXED_LABELS[g.kind]}</span>
                <span className="num text-muted">{formatCop(g.rows.reduce((a, i) => a + i.amount, 0))}</span>
              </div>
            )}
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {g.rows.map(({ t, amount }) => {
                const cat = t.splits.find((s) => s.category_id)?.category_id;
                const open = original(t);
                return (
                  <button key={`${t.id}:${t.installment_no ?? 0}`} type="button" disabled={!open}
                    onClick={() => { if (!open) return; onClose(); openTransaction(open); }}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.merchant || t.description || (cat ? categoryPath(categories, cat) : "Gasto")}</span>
                      <span className="block truncate text-xs text-muted">
                        {formatDay(t.occurred_on)}{cat ? ` · ${categoryPath(categories, cat)}` : ""}{t.installment_no ? ` · cuota ${t.installment_no} de ${t.installments}` : ""}
                      </span>
                    </span>
                    <span className="num shrink-0 font-semibold">{amount < 0 ? "−" : ""}{formatCop(Math.abs(amount))}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
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
    <ChartCard id="renta" defaultOpen={false} summary={`${year}: ingresos ${formatCopShort(s.income)} · 4x1000 ${formatCopShort(s.gmf)}`} title="Resumen para la renta" subtitle="Lo tuyo del año según lo registrado en la app. Es una guía: los valores oficiales salen de los certificados de tus bancos"
      table={{ columns: ["Concepto", "Valor"], rows: [["Ingresos", s.income], ...s.incomeByCategory.map((i) => [`  ${i.name}`, i.total] as [string, number]), ["4x1000 pagado", s.gmf], ...s.credits.flatMap((c) => [[`${c.name}: intereses`, c.interest], [`${c.name}: seguros y otros cargos`, c.insurance], [`${c.name}: abono a capital`, c.capital]] as [string, number][])] }}>
      <Segmented className="mb-2" value={String(year)} onChange={(v) => setYear(Number(v))}
        options={[{ value: String(thisYear - 1), label: String(thisYear - 1) }, { value: String(thisYear), label: `${thisYear} (en curso)` }]} />
      <div className="divide-y divide-border">
        {row("Ingresos del año", s.income, s.incomeByCategory.length ? s.incomeByCategory.slice(0, 4).map((i) => `${i.name} ${formatCopShort(i.total)}`).join(" · ") : "Ninguno registrado")}
        {row("4x1000 (GMF) pagado", s.gmf, "La mitad es deducible con el certificado del banco.")}
        {s.credits.map((c) => row(`${c.name}: intereses`, c.interest, `${c.payments} cuota${c.payments === 1 ? "" : "s"} · sin seguros y otros cargos (${formatCop(c.insurance)}, según el valor mensual del crédito) · abono a capital ${formatCop(c.capital)}. Los intereses de un crédito de vivienda son deducibles; confírmalos con el certificado del banco.`))}
        {s.credits.length === 0 && <p className="py-2 text-xs text-muted">No hay cuotas de créditos registradas en {year}.</p>}
      </div>
      {year === thisYear && <p className="mt-2 text-xs text-muted">El año va en curso: los valores crecen hasta el 31 de diciembre.</p>}
    </ChartCard>
  );
}
