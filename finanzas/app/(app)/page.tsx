"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightLeft, ChevronDown, Info, Settings } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { BudgetBar } from "@/components/BudgetBar";
import { MemberBadge } from "@/components/MemberBadge";
import { PendingReview } from "@/components/PendingReview";
import { BudgetDetailSheet } from "@/components/BudgetDetailSheet";
import type { CategoryLimit } from "@/lib/types";
import { CloseReminder } from "@/components/CloseReminder";
import { UpcomingList, useUpcoming } from "@/components/Upcoming";
import { Card, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cashFlow, crossNet, limitResponsible, limitsForScope, netWorth, safeToSpendFor, statusesFor, type Scope } from "@/lib/finance/derive";
import { formatCop } from "@/lib/finance/money";
import { categoryPath } from "@/lib/finance/spaces";
import { categoryLabel } from "@/lib/finance/labels";
import { cn } from "@/lib/utils";

const SCOPE_KEY = "home-scope";

export default function HomePage() {
  const state = useFinance();
  const { me, partner, period, memberById } = state;
  const { openSettle, openTransaction, openPayment } = useShell();
  const [detail, setDetail] = useState<CategoryLimit | null>(null);
  const router = useRouter();
  const [scope, setScopeState] = useState<Scope>("me");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SCOPE_KEY) as Scope | null;
      if (saved === "me" || saved === "household" || saved === "global") setScopeState(saved);
    } catch {}
  }, []);
  const setScope = (s: Scope) => {
    setScopeState(s);
    try { localStorage.setItem(SCOPE_KEY, s); } catch {}
  };

  const statuses = useMemo(() => statusesFor(state, period), [state, period]);
  const safe = useMemo(() => safeToSpendFor(state, period, statuses), [state, period, statuses]);
  const net = crossNet(state);
  const worth = netWorth(state, scope);
  const flow = cashFlow(state, period, scope);
  const [withPending, setWithPending] = useState(false);
  const [flowInfo, setFlowInfo] = useState(false);
  const cats = limitsForScope(state, scope);
  const obligations = cats.filter((l) => l.is_household_obligation);
  const others = cats.filter((l) => !l.is_household_obligation);
  const bar = (l: CategoryLimit) => {
    const category = state.categories.find((c) => c.id === l.category_id);
    if (!category) return null;
    return (
      <BudgetBar key={l.id} category={category} limit={l} status={statuses.get(l.id)} memberById={memberById} meId={me.user_id}
        label={categoryPath(state.categories, category.id)} icon={categoryLabel(state.categories, category.id).icon}
        onPay={l.scope === "PERSONAL" && l.owner_user_id !== me.user_id ? undefined
          : (amount) => openPayment({ categoryId: category.id, amount, scope: l.scope, responsibleId: limitResponsible(l, me, partner) ?? me.user_id })}
        onClick={() => setDetail(l)} />
    );
  };
  const upcoming = useUpcoming(period);
  const pendingDues = upcoming.occurrences.filter((o) => !o.paid && (scope !== "household" || o.payment.scope === "HOUSEHOLD"));
  const cardDues = scope === "household" ? [] : upcoming.cards;
  const pendingTotal = pendingDues.reduce((sum, o) => sum + Number(o.payment.amount), 0);
  const shownNet = withPending ? flow.net - pendingTotal : flow.net;

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <header className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5">
          <MemberBadge member={me} size={36} />
          <div>
            <p className="text-xs text-muted">Hola,</p>
            <p className="font-display text-xl leading-tight">{me.display_name}</p>
          </div>
        </div>
        <Link href="/ajustes" aria-label="Ajustes" className="rounded-full p-2.5 text-muted hover:bg-surface-2">
          <Settings size={22} />
        </Link>
      </header>

      <PeriodSwitcher />

      <Segmented className="mt-3" value={scope} onChange={setScope} options={[
        { value: "me", label: "Mis finanzas" },
        { value: "household", label: "Hogar" },
        { value: "global", label: "Vista global" },
      ]} />

      <SwipePeriods>
        <CloseReminder />
        <PendingReview />

        <SafeToSpendCard safe={safe} />

        {partner ? (
          <Card className="mt-3 flex items-center gap-3">
            <ArrowRightLeft className="shrink-0 text-wood" size={22} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">Cruce con {partner.display_name}</p>
              <p className={cn("num text-lg font-semibold", net < 0 ? "text-danger" : "text-text")}>
                {net === 0 ? "A paz y salvo" : net < 0 ? `Le debes ${formatCop(-net)}` : `Te debe ${formatCop(net)}`}
              </p>
            </div>
            {net < 0 ? (
              <Button size="sm" onClick={openSettle}>Liquidar</Button>
            ) : (
              <Link href="/cuentas?vista=cruce" className="text-sm font-semibold text-olive">Ver</Link>
            )}
          </Card>
        ) : (
          <Card className="mt-3 text-sm">
            Invita a tu pareja desde <Link href="/ajustes" className="font-semibold text-olive underline">Ajustes</Link> para usar el cruce de cuentas.
          </Card>
        )}

        {pendingDues.length + cardDues.length > 0 && (
          <>
            <div className="mt-5 flex items-center justify-between">
              <SectionTitle className="m-0">Próximos vencimientos</SectionTitle>
              <Link href="/presupuestos" className="text-sm font-semibold text-olive">Ver todos</Link>
            </div>
            <UpcomingList occurrences={pendingDues} cards={cardDues} today={upcoming.today} limit={3} />
          </>
        )}

        {cats.length === 0 ? (
          <Card className="mt-6 space-y-3 text-center">
            <p className="text-[15px]">Aún no hay presupuestos en esta vista.</p>
            <Link href="/presupuestos" className="inline-block font-semibold text-olive underline">Crear un presupuesto</Link>
          </Card>
        ) : (
          <>
            {obligations.length > 0 && <SectionTitle>Obligaciones del hogar</SectionTitle>}
            <div className="space-y-2.5">
              {obligations.map(bar)}
            </div>
            {others.length > 0 && <SectionTitle>{scope === "me" ? "Mis presupuestos" : "Otros presupuestos"}</SectionTitle>}
            <div className="space-y-2.5">
              {others.map(bar)}
            </div>
          </>
        )}

        <SectionTitle>Patrimonio y flujo de caja</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs text-muted">Patrimonio neto</p>
            <p className={cn("num mt-1 text-lg font-semibold", worth.total < 0 && "text-danger")}>{formatCop(worth.total)}</p>
            <p className="num mt-1 text-xs text-muted">Activos {formatCop(worth.assets)}</p>
            <p className="num text-xs text-muted">Pasivos {formatCop(worth.liabilities)}</p>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">Flujo del periodo</p>
              <button type="button" onClick={() => setFlowInfo(!flowInfo)} aria-expanded={flowInfo} aria-label="¿Qué significa cada opción?"
                className="rounded-full p-1 text-muted hover:text-text"><Info size={15} /></button>
            </div>
            <p className={cn("num mt-1 text-lg font-semibold", shownNet < 0 && "text-danger")}>{formatCop(shownNet)}</p>
            <p className="num mt-1 text-xs text-muted">Entró {formatCop(flow.income)}</p>
            <p className="num text-xs text-muted">Salió {formatCop(flow.expense)}</p>
            {withPending && <p className="num text-xs text-muted">Pendiente −{formatCop(pendingTotal)}</p>}
            <Segmented className="mt-2" value={withPending ? "PENDING" : "REAL"} onChange={(v) => setWithPending(v === "PENDING")}
              options={[{ value: "REAL", label: "Real" }, { value: "PENDING", label: "Sin pagar" }]} />
          </Card>
        </div>
        {scope !== "me" && (
          <p className="mt-2 px-1 text-xs text-muted">{scope === "household" ? "Solo movimientos del hogar, pague quien pague." : "Incluye lo del hogar y lo tuyo."} Las transferencias no cuentan.</p>
        )}
        {flowInfo && (
          <div className="mt-2 space-y-1 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">
            <p><strong className="text-text">Real:</strong> lo que entró menos lo que salió en el periodo. Solo cuenta movimientos ya registrados.</p>
            <p><strong className="text-text">Sin pagar:</strong> el mismo flujo, pero descontando además los pagos programados del periodo (gastos y pagos de deuda) que todavía no has registrado. Muestra cuánto te quedaría si los pagaras todos.</p>
          </div>
        )}

        <Button variant="outline" className="mt-6 w-full" onClick={() => openTransaction(null)}>Registrar un movimiento</Button>
      </SwipePeriods>
      <BudgetDetailSheet limit={detail} status={detail ? statuses.get(detail.id) : undefined} onClose={() => setDetail(null)}
        onEdit={(l) => router.push(`/presupuestos?limite=${l.id}`)} />
    </main>
  );
}

function SafeToSpendCard({ safe }: { safe: ReturnType<typeof safeToSpendFor> }) {
  const [open, setOpen] = useState(false);
  const rows = [
    { label: "Saldo en cuentas y billeteras", value: safe.realBalance, sign: "" },
    { label: "Obligaciones del hogar pendientes", value: safe.householdObligationsPending, sign: "−" },
    { label: "Ahorros programados pendientes", value: safe.scheduledSavingsPending, sign: "−" },
    { label: "Tarjetas: extracto que vence este periodo", value: safe.creditCardDebt, sign: "−" },
    { label: "Lo que le debes a tu pareja", value: safe.owedToPartner, sign: "−" },
  ];
  return (
    <Card className="mt-4 bg-olive text-on-olive">
      <button className="w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <p className="text-sm opacity-80">Saldo Seguro para Gastar</p>
        <motion.p key={safe.total} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="num mt-1 font-display text-[40px] leading-tight">
          {formatCop(safe.total)}
        </motion.p>
        <span className="mt-1 flex items-center gap-1 text-xs opacity-80">
          ¿De dónde sale? <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 space-y-1.5 border-t border-on-olive/20 pt-3 text-sm">
              {rows.map((r) => (
                <div key={r.label} className="flex justify-between gap-3">
                  <span className="opacity-85">{r.label}</span>
                  <span className="num font-medium">{r.sign}{formatCop(r.value)}</span>
                </div>
              ))}
              <p className="pt-1 text-xs opacity-70">Lo que tu pareja te debe no suma: no es dinero disponible hasta que te pague.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
