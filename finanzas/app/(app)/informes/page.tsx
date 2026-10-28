"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Sparkles } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { BarList, ChartCard, GroupedColumns, StackedRows } from "@/components/charts/Charts";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { Member } from "@/lib/types";
import { formatCop } from "@/lib/finance/money";
import { isWithin, periodFor, shiftPeriod, todayBogota } from "@/lib/finance/periods";
import { shortPeriod } from "@/lib/finance/periodLabels";
import { BudgetVsActual, FixedVsVariable, TaxSummaryCard } from "@/components/reports/ExtraReports";
import { spendingByTag } from "@/lib/finance/tags";
import { inReportSpace, pendingInPeriod, periodTrend, spendingByCategory, spendingByPerson, toCsv, type ReportSpace } from "@/lib/finance/reports";

const SERIES_1 = "var(--series-1)";
const SERIES_2 = "var(--series-2)";

export default function InformesPage() {
  const { transactions: all, consumption: allConsumption, categories, labels, period, me, partner, memberById, tags, txTags, settings } = useFinance();
  const router = useRouter();
  const members = [me, partner].filter(Boolean) as Member[];
  const [space, setSpace] = useState<ReportSpace>("all");
  const transactions = useMemo(() => all.filter((t) => inReportSpace(t, space)), [all, space]);
  // Gastos por periodo: una compra a cuotas cuenta cada cuota en su mes (el CSV lista los movimientos tal cual)
  const consumption = useMemo(() => allConsumption.filter((t) => inReportSpace(t, space)), [allConsumption, space]);

  // Primero por subcategoría (la categoría principal va al lado); con "Categoría" las subcategorías suman en su principal
  const [group, setGroup] = useState<"sub" | "parent">("sub");
  const byCategory = useMemo(() => spendingByCategory(consumption, categories, period, group === "parent"), [consumption, categories, period, group]);
  const totalExpense = byCategory.reduce((a, c) => a + c.total, 0);
  const label = (c: { key: string; name: string; icon: string }) => {
    const cat = categories.find((x) => x.id === c.key);
    const parent = cat?.parent_id ? categories.find((x) => x.id === cat.parent_id) : null;
    return group === "sub" && cat && parent ? `${parent.icon || c.icon} ${cat.name} · ${parent.name}` : `${c.icon} ${cat?.name ?? c.name}`;
  };
  const totalIncome = transactions.filter((t) => t.kind === "INCOME" && isWithin(t.occurred_on, period)).reduce((a, t) => a + t.amount, 0);

  // Tendencia por los periodos del hogar (mensual con su día de inicio, o quincenal), como “Consumo del periodo”
  const periods = useMemo(() => {
    const current = periodFor(settings, todayBogota());
    return Array.from({ length: 6 }, (_, i) => shiftPeriod(settings, current, i - 5));
  }, [settings]);
  const trend = useMemo(() => periodTrend(consumption, periods), [consumption, periods]);
  const pending = useMemo(() => pendingInPeriod(consumption, period), [consumption, period]);
  const byTag = useMemo(() => spendingByTag(consumption, txTags, tags, period), [consumption, txTags, tags, period]);
  const people = useMemo(() => spendingByPerson(consumption, categories, period, members), [consumption, categories, period, members]);

  function download() {
    // Igual que los gráficos: una compra a cuotas sale con la cuota del periodo (columna “Cuota”)
    const inPeriod = consumption.filter((t) => isWithin(t.occurred_on, period));
    const csv = toCsv(inPeriod, { categories, labels, memberById, tagsOf: (id) => (txTags[id] ?? []).map((x) => tags.find((t) => t.id === x)?.name).filter((n): n is string => !!n) });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `movimientos_${space === "household" ? "hogar_" : space === "personal" ? "personal_" : ""}${period.start}_a_${period.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }


  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between py-2">
        <h1 className="font-display text-3xl">Informes</h1>
        <div className="flex gap-2">
          <Link href="/asistente" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm"><Sparkles size={16} className="text-wood" /> IA</Link>
          <Button size="sm" variant="outline" onClick={download}><Download size={16} /> CSV</Button>
        </div>
      </div>
      <PeriodSwitcher />
      <Segmented className="mt-3" value={space} onChange={setSpace} options={[
        { value: "household", label: "Hogar" },
        { value: "personal", label: "Personal" },
        { value: "all", label: "Todo" },
      ]} />

      <SwipePeriods>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-3xl border border-border bg-surface p-4">
            <p className="text-xs text-muted">Consumo del periodo</p>
            <p className="num mt-1 font-display text-2xl">{formatCop(totalExpense)}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-4">
            <p className="text-xs text-muted">Ingresos del periodo</p>
            <p className="num mt-1 font-display text-2xl">{formatCop(totalIncome)}</p>
          </div>
        </div>
        <p className="mt-2 px-1 text-xs text-muted">
          {space === "household" ? "Solo movimientos del hogar, pague quien pague." : space === "personal" ? "Tus movimientos personales (y los de tu pareja en los que te asignó una parte)." : "Todo lo que puedes ver: lo del hogar y lo tuyo."}
          {" "}Las transferencias, liquidaciones y ajustes no cuentan; los reembolsos restan. Las compras a cuotas cuentan solo la cuota del periodo (en Movimientos salen por su valor completo).
        </p>
        {pending.count > 0 && (
          <Link href="/movimientos?filtro=pendientes" className="mt-2 block rounded-2xl bg-warning-soft px-3 py-2 text-sm">
            Incluye {formatCop(pending.amount)} de {pending.count} movimiento{pending.count === 1 ? "" : "s"} por revisar: pueden cambiar de categoría al revisarlos. <span className="font-semibold underline">Revisar</span>
          </Link>
        )}

        <div className="mt-4 space-y-4">
          <ChartCard title={group === "sub" ? "Gastos por subcategoría" : "Gastos por categoría"}
            subtitle={group === "sub" ? "Cada subcategoría con su categoría al lado. Toca una para ver sus movimientos" : "Las subcategorías suman en su principal. Toca una para ver sus movimientos"}
            table={{ columns: [group === "sub" ? "Subcategoría" : "Categoría", "Total"], rows: byCategory.map((c) => [label(c), c.total]) }}>
            <Segmented className="mb-3" value={group} onChange={setGroup} options={[
              { value: "sub", label: "Subcategoría" },
              { value: "parent", label: "Categoría" },
            ]} />
            {byCategory.length === 0 ? <p className="text-sm text-muted">No hay gastos en este periodo.</p> : (
              <BarList items={byCategory.map((c) => ({ key: c.key, label: label(c), value: c.total }))} color={SERIES_1}
                onSelect={(key) => key !== "none" && key !== "private" && router.push(`/movimientos?categoria=${key}`)} />
            )}
          </ChartCard>

          {tags.length > 0 && (
            <ChartCard title="Gastos por etiqueta" subtitle="Un movimiento con varias etiquetas cuenta en cada una. Toca una para ver sus movimientos"
              table={{ columns: ["Etiqueta", "Movimientos", "Gastos", "Ingresos"], rows: byTag.map((t) => [t.name, t.count, t.expense, t.income]) }}>
              {byTag.length === 0 ? <p className="text-sm text-muted">Ningún movimiento de este periodo tiene etiqueta.</p> : (
                <BarList items={byTag.map((t) => ({ key: t.tagId, label: `${t.name} · ${t.count}`, value: Math.max(0, t.expense) }))} color={SERIES_1}
                  onSelect={(key) => router.push(`/movimientos?etiqueta=${key}`)} />
              )}
            </ChartCard>
          )}

          <ChartCard title="Por persona y hogar" subtitle="Lo que asumió cada uno: gastos del hogar y personales"
            table={{ columns: ["Persona", "Hogar", "Personal"], rows: people.map((p) => [p.name, p.household, p.personal]) }}>
            <StackedRows rows={people.map((p) => ({ label: p.userId === me.user_id ? `${p.name} (tú)` : p.name, values: [p.household, p.personal] }))}
              series={[{ label: "Hogar", color: SERIES_1 }, { label: "Personal", color: SERIES_2 }]} />
            {partner && <p className="mt-3 text-xs text-muted">Lo personal de tu pareja solo aparece si lo compartió contigo.</p>}
          </ChartCard>

          <ChartCard title="Tendencia de 6 periodos" subtitle="Ingresos y consumo por periodo (los mismos de arriba)"
            table={{ columns: ["Periodo", "Ingresos", "Gastos"], rows: trend.map((t) => [shortPeriod(t.period), t.income, t.expense]) }}>
            <GroupedColumns data={trend.map((t) => ({ label: shortPeriod(t.period), values: [t.income, t.expense] }))}
              series={[{ label: "Ingresos", color: SERIES_1 }, { label: "Gastos", color: SERIES_2 }]} />
          </ChartCard>

          <BudgetVsActual space={space} />
          <FixedVsVariable consumption={consumption} period={period} />
          <TaxSummaryCard />
        </div>
      </SwipePeriods>
    </main>
  );
}
