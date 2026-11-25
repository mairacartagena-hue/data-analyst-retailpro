"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Card, SectionTitle } from "@/components/ui/card";
import { FoldSection } from "@/components/ui/fold-section";
import { InfoNote } from "@/components/ui/info-note";
import { Field } from "@/components/ui/input";
import { AmountInput } from "@/components/AmountInput";
import { Segmented } from "@/components/ui/segmented";
import { buttonVariants } from "@/components/ui/button";
import type { Account } from "@/lib/types";
import { formatCop, formatCopShort, parseCop } from "@/lib/finance/money";
import { todayBogota } from "@/lib/finance/periods";
import {
  milestones,
  monthYear,
  nextDueDate,
  planInstallment,
  projectCredit,
  savingsVs,
  yearEndBalances,
  type PlanInput,
} from "@/lib/finance/creditPlan";

/** Escenarios de abonos para comparar (a capital, reduciendo plazo). */
const SCENARIOS: { id: string; label: string; extraMonthly?: number; extraByMonth?: Record<number, number> }[] = [
  { id: "m200", label: "$200.000 cada mes", extraMonthly: 200_000 },
  { id: "m500", label: "$500.000 cada mes", extraMonthly: 500_000 },
  { id: "m1000", label: "$1.000.000 cada mes", extraMonthly: 1_000_000 },
  { id: "d5", label: "$5.000.000 cada diciembre", extraByMonth: { 12: 5_000_000 } },
  { id: "jd5", label: "$5.000.000 en junio y diciembre", extraByMonth: { 6: 5_000_000, 12: 5_000_000 } },
  { id: "mix", label: "$500.000 al mes + $5.000.000 en diciembre", extraMonthly: 500_000, extraByMonth: { 12: 5_000_000 } },
];

export default function RutaCreditoPage() {
  const { accounts, balances, me } = useFinance();
  const [selected, setSelected] = useState("");

  // Créditos con cuotas propios y con saldo visible (hipoteca, libre inversión…)
  const credits = accounts.filter((a) => a.kind === "CREDIT" && !a.archived && a.owner_user_id === me.user_id && balances[a.id] !== undefined);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("cuenta");
    if (id) setSelected(id);
  }, []);

  const credit = credits.find((a) => a.id === selected) ?? credits[0];

  return (
    <main className="px-4 pb-6 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2 py-2">
        <Link href="/cuentas?vista=creditos" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
        <h1 className="font-display text-3xl">Ruta del crédito</h1>
      </div>

      {!credit ? (
        <Card className="mt-2 space-y-2 text-center">
          <p className="text-[15px]">Agrega tu hipoteca o crédito con cuotas para ver hasta cuándo lo pagas y cuánto ahorras abonando a capital.</p>
          <Link href="/cuentas?vista=creditos" className={buttonVariants()}>Ir a Créditos</Link>
        </Card>
      ) : (
        <>
          {credits.length > 1 && (
            <Segmented
              className="mb-3"
              value={credit.id}
              onChange={setSelected}
              options={credits.map((a) => ({ value: a.id, label: a.name }))}
            />
          )}
          <Ruta key={credit.id} account={credit} owed={Math.max(0, -(balances[credit.id] ?? 0))} />
        </>
      )}
    </main>
  );
}

function Ruta({ account, owed }: { account: Account; owed: number }) {
  const today = todayBogota();
  const [monthly, setMonthly] = useState("");
  const [june, setJune] = useState("");
  const [december, setDecember] = useState("");

  const installment = planInstallment(owed, account, today);
  const input: PlanInput = useMemo(() => ({
    owed,
    eaPercent: account.interest_rate_ea,
    installment,
    costs: account.monthly_costs ?? 0,
    firstDue: nextDueDate(account.due_day, today),
  }), [owed, account.interest_rate_ea, installment, account.monthly_costs, account.due_day, today]);

  const base = useMemo(() => projectCredit(input), [input]);
  const mine = useMemo(() => projectCredit({
    ...input,
    extraMonthly: parseCop(monthly) ?? 0,
    extraByMonth: { 6: parseCop(june) ?? 0, 12: parseCop(december) ?? 0 },
  }), [input, monthly, june, december]);
  const scenarios = useMemo(
    () => SCENARIOS.map((s) => ({ ...s, plan: projectCredit({ ...input, extraMonthly: s.extraMonthly, extraByMonth: s.extraByMonth }) })),
    [input],
  );

  const editHref = `/cuentas?vista=creditos&cuenta=${account.id}`;

  if (owed <= 0) {
    return <Card className="mt-2 text-center text-[15px]">Este crédito no tiene deuda de capital registrada.</Card>;
  }
  if (!account.interest_rate_ea) {
    return (
      <Card className="mt-2 space-y-2 text-center">
        <p className="text-[15px]">Falta la tasa de interés de este crédito para proyectar la ruta. Sale del extracto como “tasa cobrada E.A.”.</p>
        <Link href={editHref} className={buttonVariants()}>Completar el crédito</Link>
      </Card>
    );
  }
  if (!base.amortizes) {
    return (
      <Card className="mt-2 space-y-2 text-center">
        <p className="text-[15px]">
          La cuota ({formatCop(installment)}) no alcanza a cubrir los intereses del mes ({formatCop(base.rows[0]?.interest ?? 0)}), así que el saldo no baja.
          Revisa el valor de la cuota en el crédito.
        </p>
        <Link href={editHref} className={buttonVariants()}>Revisar el crédito</Link>
      </Card>
    );
  }

  const hayExtra = mine.extras > 0;
  const mineSaving = savingsVs(base, mine);
  const firstYear = base.rows.slice(0, 12);
  const firstYearInterest = firstYear.reduce((s, r) => s + r.interest, 0);
  const firstYearTotal = firstYear.reduce((s, r) => s + r.interest + r.capital, 0);
  const interestShare = firstYearTotal > 0 ? Math.round((firstYearInterest / firstYearTotal) * 100) : 0;
  const shown = hayExtra ? mine : base;

  return (
    <>
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="text-xs text-muted">Debes hoy</p>
            <p className="num font-display text-2xl text-danger">{formatCop(owed)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Cuota ≈ (con seguros)</p>
            <p className="num font-display text-2xl">{formatCop(installment + (account.monthly_costs ?? 0))}</p>
          </div>
        </div>
        <div className="divide-y divide-border text-sm">
          <Line label="Tasa" value={`${account.interest_rate_ea} % E.A.`} />
          <Line label="Termina sin abonos" value={`${monthYear(base.endDate)} · ${base.payments} cuotas`} />
          <Line label="Intereses por pagar" value={formatCop(base.interest)} />
          <Line label="Seguros por pagar" value={formatCop(base.costs)} />
        </div>
        <p className="text-sm text-muted">
          {base.interest >= owed
            ? `Los intereses que faltan (${formatCopShort(base.interest)}) superan lo que debes. `
            : ""}
          En los próximos 12 pagos, {interestShare} % de la cuota (sin seguros) son intereses.
        </p>
      </Card>

      <SectionTitle>Simula tus abonos a capital</SectionTitle>
      <Card className="space-y-3">
        <Field label="Abono extra cada mes" htmlFor="rc-mensual"><AmountInput id="rc-mensual" value={monthly} onChange={setMonthly} /></Field>
        <Field label="Abono extra en junio" htmlFor="rc-junio"><AmountInput id="rc-junio" value={june} onChange={setJune} /></Field>
        <Field label="Abono extra en diciembre" htmlFor="rc-diciembre"><AmountInput id="rc-diciembre" value={december} onChange={setDecember} /></Field>
        {hayExtra ? (
          <p className="text-[15px]">
            Terminarías en <strong>{monthYear(mine.endDate)}</strong> ({mineSaving.monthsSaved} cuotas menos) y ahorrarías{" "}
            <strong className="num">{formatCop(mineSaving.interestSaved)}</strong> en intereses, poniendo de más {formatCop(mine.extras)} en total.
          </p>
        ) : (
          <p className="text-sm text-muted">Escribe un valor para ver cuánto acortas el plazo y cuánto ahorras.</p>
        )}
        <InfoNote>
          Todo el abono se aplica a capital y la cuota no cambia. En el banco, marca el pago como “Abono extraordinario → Reducir plazo”.
          Los pagos hechos después de la fecha de corte aparecen en el siguiente extracto.
        </InfoNote>
      </Card>

      <SectionTitle>Escenarios</SectionTitle>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3.5 py-2 text-xs text-muted">
          <span>Abono</span><span className="text-right">Termina</span><span className="w-20 text-right">Ahorras</span>
        </div>
        <div className="divide-y divide-border">
          {scenarios.map((s) => {
            const sv = savingsVs(base, s.plan);
            return (
              <div key={s.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-3.5 py-2.5 text-sm">
                <span>{s.label}<span className="block text-xs text-muted">{sv.monthsSaved} cuotas menos</span></span>
                <span className="num text-right">{monthYear(s.plan.endDate)}</span>
                <span className="num w-20 text-right font-semibold">{formatCopShort(sv.interestSaved)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <SectionTitle>{hayExtra ? "Hitos con tu simulación" : "Hitos sin abonos"}</SectionTitle>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface text-sm">
        {milestones(shown, owed).map((h) => (
          <div key={h.left} className="flex items-center justify-between px-3.5 py-2.5">
            <span>Debes menos de {formatCop(h.balance)} <span className="text-xs text-muted">({Math.round(h.left * 100)} % de hoy)</span></span>
            <span className="num font-semibold">{monthYear(h.date)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span>Crédito pagado</span>
          <span className="num font-semibold">{monthYear(shown.endDate)}</span>
        </div>
      </div>

      <FoldSection id="ruta-credito-anual" title="Saldo al cierre de cada año" summary={hayExtra ? "Con tu simulación" : "Sin abonos"} className="mt-4">
        <div className="divide-y divide-border text-sm">
          {yearEndBalances(shown).map((y) => (
            <Line key={y.year} label={y.year} value={formatCop(y.balance)} />
          ))}
        </div>
      </FoldSection>

      <p className="mt-4 px-1 text-xs text-muted">
        Estimación con pagos al día, tasa y seguros constantes: no reemplaza la tabla del banco. Después de cada extracto, confirma el saldo en Cierre del mes.
      </p>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-muted">{label}</span>
      <span className="num font-medium">{value}</span>
    </div>
  );
}
