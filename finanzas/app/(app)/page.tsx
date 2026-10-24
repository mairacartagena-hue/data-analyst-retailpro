"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightLeft, ChevronDown, Inbox, Settings } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { BudgetBar } from "@/components/BudgetBar";
import { MemberBadge } from "@/components/MemberBadge";
import { Card, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cashFlow, categoriesForScope, crossNet, netWorth, safeToSpendFor, statusesFor, type Scope } from "@/lib/finance/derive";
import { formatCop } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

const SCOPE_KEY = "home-scope";

export default function HomePage() {
  const state = useFinance();
  const { me, partner, period, memberById, transactions } = state;
  const { openSettle, openTransaction } = useShell();
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
  const cats = categoriesForScope(state, scope);
  const obligations = cats.filter((c) => c.is_household_obligation);
  const others = cats.filter((c) => !c.is_household_obligation);
  const pending = transactions.filter((t) => t.status === "PENDING_REVIEW" && t.payer_user_id === me.user_id);

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
        {pending.length > 0 && (
          <Link href="/movimientos?filtro=pendientes" className="mt-4 flex items-center gap-3 rounded-2xl bg-warning-soft px-4 py-3 text-sm">
            <Inbox size={18} className="text-warning" />
            <span className="flex-1">Tienes {pending.length} movimiento{pending.length === 1 ? "" : "s"} por revisar</span>
          </Link>
        )}

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
              <Link href="/cruce" className="text-sm font-semibold text-olive">Ver</Link>
            )}
          </Card>
        ) : (
          <Card className="mt-3 text-sm">
            Invita a tu pareja desde <Link href="/ajustes" className="font-semibold text-olive underline">Ajustes</Link> para usar el cruce de cuentas.
          </Card>
        )}

        {cats.length === 0 ? (
          <Card className="mt-6 space-y-3 text-center">
            <p className="text-[15px]">Aún no hay presupuestos en esta vista.</p>
            <Link href="/presupuestos" className="inline-block font-semibold text-olive underline">Crear categorías</Link>
          </Card>
        ) : (
          <>
            {obligations.length > 0 && <SectionTitle>Obligaciones del hogar</SectionTitle>}
            <div className="space-y-2.5">
              {obligations.map((c) => (
                <BudgetBar key={c.id} category={c} status={statuses.get(c.id)} memberById={memberById}
                  onClick={() => (window.location.href = `/presupuestos?categoria=${c.id}`)} />
              ))}
            </div>
            {others.length > 0 && <SectionTitle>{scope === "me" ? "Mis categorías" : "Otras categorías"}</SectionTitle>}
            <div className="space-y-2.5">
              {others.map((c) => (
                <BudgetBar key={c.id} category={c} status={statuses.get(c.id)} memberById={memberById}
                  onClick={() => (window.location.href = `/presupuestos?categoria=${c.id}`)} />
              ))}
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
            <p className="text-xs text-muted">Flujo del periodo</p>
            <p className={cn("num mt-1 text-lg font-semibold", flow.net < 0 && "text-danger")}>{formatCop(flow.net)}</p>
            <p className="num mt-1 text-xs text-muted">Entró {formatCop(flow.income)}</p>
            <p className="num text-xs text-muted">Salió {formatCop(flow.expense)}</p>
          </Card>
        </div>
        {scope !== "me" && (
          <p className="mt-2 px-1 text-xs text-muted">Incluye solo lo que cada uno decidió compartir.</p>
        )}

        <Button variant="outline" className="mt-6 w-full" onClick={() => openTransaction(null)}>Registrar un movimiento</Button>
      </SwipePeriods>
    </main>
  );
}

function SafeToSpendCard({ safe }: { safe: ReturnType<typeof safeToSpendFor> }) {
  const [open, setOpen] = useState(false);
  const rows = [
    { label: "Saldo en cuentas y billeteras", value: safe.realBalance, sign: "" },
    { label: "Obligaciones del hogar pendientes", value: safe.householdObligationsPending, sign: "−" },
    { label: "Ahorros programados pendientes", value: safe.scheduledSavingsPending, sign: "−" },
    { label: "Deuda de tarjetas de crédito", value: safe.creditCardDebt, sign: "−" },
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
