"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { BarList, ChartCard, GroupedColumns, StackedRows } from "@/components/charts/Charts";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { Member } from "@/lib/types";
import { formatCop } from "@/lib/finance/money";
import { isWithin, monthName, todayBogota } from "@/lib/finance/periods";
import { shiftMonth } from "@/lib/finance/reconcile";
import { inReportSpace, monthlyTrend, spendingByCategory, spendingByPerson, toCsv, type ReportSpace } from "@/lib/finance/reports";

const SERIES_1 = "var(--series-1)";
const SERIES_2 = "var(--series-2)";

export default function InformesPage() {
  const { transactions: all, categories, labels, period, me, partner, memberById } = useFinance();
  const router = useRouter();
  const members = [me, partner].filter(Boolean) as Member[];
  const [space, setSpace] = useState<ReportSpace>("all");
  const transactions = useMemo(() => all.filter((t) => inReportSpace(t, space)), [all, space]);

  const byCategory = useMemo(() => spendingByCategory(transactions, categories, period, true), [transactions, categories, period]);
  const totalExpense = byCategory.reduce((a, c) => a + c.total, 0);
  const totalIncome = transactions.filter((t) => t.kind === "INCOME" && isWithin(t.occurred_on, period)).reduce((a, t) => a + t.amount, 0);

  const months = useMemo(() => {
    const current = todayBogota().slice(0, 7);
    return Array.from({ length: 6 }, (_, i) => shiftMonth(current, i - 5));
  }, []);
  const trend = useMemo(() => monthlyTrend(transactions, months), [transactions, months]);
  const people = useMemo(() => spendingByPerson(transactions, categories, period, members), [transactions, categories, period, members]);

  function download() {
    const inPeriod = transactions.filter((t) => isWithin(t.occurred_on, period));
    const csv = toCsv(inPeriod, { categories, labels, memberById });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `movimientos_${space === "household" ? "hogar_" : space === "personal" ? "personal_" : ""}${period.start}_a_${period.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const shortMonth = (m: string) => monthName(Number(m.slice(5)) - 1);

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between py-2">
        <h1 className="font-display text-3xl">Informes</h1>
        <Button size="sm" variant="outline" onClick={download}><Download size={16} /> CSV</Button>
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
            <p className="text-xs text-muted">Gastos del periodo</p>
            <p className="num mt-1 font-display text-2xl">{formatCop(totalExpense)}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-4">
            <p className="text-xs text-muted">Ingresos del periodo</p>
            <p className="num mt-1 font-display text-2xl">{formatCop(totalIncome)}</p>
          </div>
        </div>
        <p className="mt-2 px-1 text-xs text-muted">
          {space === "household" ? "Solo movimientos del hogar, pague quien pague." : space === "personal" ? "Tus movimientos personales (y los de tu pareja en los que te asignó una parte)." : "Todo lo que puedes ver: lo del hogar y lo tuyo."}
          {" "}Las transferencias, liquidaciones y ajustes no cuentan; los reembolsos restan.
        </p>

        <div className="mt-4 space-y-4">
          <ChartCard title="Gastos por categoría" subtitle="Las subcategorías suman en su principal. Toca una para ver sus movimientos"
            table={{ columns: ["Categoría", "Total"], rows: byCategory.map((c) => [`${c.icon} ${c.name}`, c.total]) }}>
            {byCategory.length === 0 ? <p className="text-sm text-muted">No hay gastos en este periodo.</p> : (
              <BarList items={byCategory.map((c) => ({ key: c.key, label: `${c.icon} ${c.name}`, value: c.total }))} color={SERIES_1}
                onSelect={(key) => key !== "none" && key !== "private" && router.push(`/movimientos?categoria=${key}`)} />
            )}
          </ChartCard>

          <ChartCard title="Por persona y hogar" subtitle="Lo que asumió cada uno: gastos del hogar y personales"
            table={{ columns: ["Persona", "Hogar", "Personal"], rows: people.map((p) => [p.name, p.household, p.personal]) }}>
            <StackedRows rows={people.map((p) => ({ label: p.userId === me.user_id ? `${p.name} (tú)` : p.name, values: [p.household, p.personal] }))}
              series={[{ label: "Hogar", color: SERIES_1 }, { label: "Personal", color: SERIES_2 }]} />
            {partner && <p className="mt-3 text-xs text-muted">Lo personal de tu pareja solo aparece si lo compartió contigo.</p>}
          </ChartCard>

          <ChartCard title="Tendencia de 6 meses" subtitle="Ingresos y gastos por mes calendario"
            table={{ columns: ["Mes", "Ingresos", "Gastos"], rows: trend.map((t) => [shortMonth(t.month), t.income, t.expense]) }}>
            <GroupedColumns data={trend.map((t) => ({ label: shortMonth(t.month), values: [t.income, t.expense] }))}
              series={[{ label: "Ingresos", color: SERIES_1 }, { label: "Gastos", color: SERIES_2 }]} />
          </ChartCard>
        </div>
      </SwipePeriods>
    </main>
  );
}
