"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightLeft, ChevronDown, Info, Settings } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { MemberBadge } from "@/components/MemberBadge";
import { PendingReview } from "@/components/PendingReview";
import { BudgetDetailSheet } from "@/components/BudgetDetailSheet";
import type { CategoryLimit } from "@/lib/types";
import { CloseReminder } from "@/components/CloseReminder";
import { CreditCheck } from "@/components/CreditCheck";
import { UpcomingList, useUpcoming } from "@/components/Upcoming";
import { Card, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { cashFlow, crossNet, limitsForScope, netWorth, safeToSpendDetail, safeToSpendFor, statusesFor, type SafeToSpendDetail, type Scope } from "@/lib/finance/derive";
import { formatCop } from "@/lib/finance/money";
import { categoryPath } from "@/lib/finance/spaces";
import { categoryLabel } from "@/lib/finance/labels";
import { cn } from "@/lib/utils";

const SCOPE_KEY = "home-scope";

export default function HomePage() {
  const state = useFinance();
  const { me, partner, period } = state;
  const { openSettle } = useShell();
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
  const safeDetail = useMemo(() => safeToSpendDetail(state, period, statuses), [state, period, statuses]);
  const safe = useMemo(() => safeToSpendFor(state, period, statuses, safeDetail), [state, period, statuses, safeDetail]);
  const net = crossNet(state);
  const worth = netWorth(state, scope);
  const flow = cashFlow(state, period, scope);
  const [withPending, setWithPending] = useState(false);
  const [flowInfo, setFlowInfo] = useState(false);
  const cats = limitsForScope(state, scope);
  const upcoming = useUpcoming(period);
  const pendingDues = upcoming.occurrences.filter((o) => !o.paid && (scope !== "household" || o.payment.scope === "HOUSEHOLD"));
  const cardDues = scope === "household" ? [] : upcoming.cards.filter((c) => !c.paid);
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
        <CreditCheck />
        <PendingReview />

        <SafeToSpendCard safe={safe} detail={safeDetail} />

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
          <BudgetAlerts cats={cats} statuses={statuses} onOpen={setDetail} />
        )}

        <SectionTitle>Patrimonio y flujo</SectionTitle>
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

      </SwipePeriods>
      <BudgetDetailSheet limit={detail} status={detail ? statuses.get(detail.id) : undefined} onClose={() => setDetail(null)}
        onEdit={(l) => router.push(`/presupuestos?limite=${l.id}`)} />
    </main>
  );
}

/** Inicio: solo los presupuestos que pasan del 80 % (los demás están en Presupuesto). */
function BudgetAlerts({ cats, statuses, onOpen }: { cats: CategoryLimit[]; statuses: ReturnType<typeof statusesFor>; onOpen: (l: CategoryLimit) => void }) {
  const { categories } = useFinance();
  const watch = cats
    .map((l) => ({ l, st: statuses.get(l.id) }))
    .filter((x) => x.st && categories.some((c) => c.id === x.l.category_id) && x.st.ratio >= 0.8)
    .sort((x, y) => y.st!.ratio - x.st!.ratio);
  return (
    <>
      <div className="mt-5 flex items-center justify-between">
        <SectionTitle className="m-0">Presupuestos en alerta</SectionTitle>
        <Link href="/presupuestos" className="text-sm font-semibold text-olive">Ver todos ({cats.length})</Link>
      </div>
      {watch.length === 0 ? (
        <Card className="text-sm text-muted">Todos tus presupuestos van bien este periodo.</Card>
      ) : (
        <Card className="divide-y divide-border p-0">
          {watch.slice(0, 3).map(({ l, st }) => {
            const left = st!.totalAvailable - st!.totalSpent;
            const icon = categoryLabel(categories, l.category_id).icon;
            return (
              <button key={l.id} type="button" onClick={() => onOpen(l)} className="block w-full px-4 py-3 text-left">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{icon} {categoryPath(categories, l.category_id)}</span>
                  <span className={cn("num shrink-0 text-sm font-semibold", left < 0 ? "text-danger" : "text-warning")}>
                    {left < 0 ? `Te pasaste ${formatCop(-left)}` : `Quedan ${formatCop(left)}`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className={cn("h-full rounded-full", left < 0 ? "bg-danger" : "bg-warning")} style={{ width: `${Math.min(100, Math.round(st!.ratio * 100))}%` }} />
                </div>
                <p className="num mt-1 text-xs text-muted">{Math.round(st!.ratio * 100)} % de {formatCop(st!.totalAvailable)}</p>
              </button>
            );
          })}
          {watch.length > 3 && <Link href="/presupuestos" className="block px-4 py-2.5 text-center text-sm font-semibold text-olive">Y {watch.length - 3} más en alerta</Link>}
        </Card>
      )}
    </>
  );
}

type SafeSection = "accounts" | "obligations" | "savings" | "debts";

const SECTION_INFO: Record<SafeSection, { title: string; description: string; empty: string; href: string; linkLabel: string }> = {
  accounts: {
    title: "Saldo en cuentas y billeteras",
    description: "Tus cuentas de ahorro, billeteras y efectivo. Las tarjetas y créditos no suman aquí.",
    empty: "No tienes cuentas de depósito, billeteras ni efectivo con saldo.",
    href: "/cuentas", linkLabel: "Ver cuentas",
  },
  obligations: {
    title: "Obligaciones del hogar pendientes",
    description: "Lo que te falta pagar este periodo en los presupuestos del hogar marcados como obligación. Puedes quitar la marca desde el presupuesto.",
    empty: "No tienes obligaciones del hogar pendientes este periodo.",
    href: "/presupuestos", linkLabel: "Ver presupuestos",
  },
  savings: {
    title: "Ahorros programados pendientes",
    description: "Lo que te falta aportar este periodo a tus metas con aporte por periodo.",
    empty: "No tienes aportes a metas pendientes este periodo.",
    href: "/metas", linkLabel: "Ver metas",
  },
  debts: {
    title: "Tarjetas y créditos: lo que vence este periodo",
    description: "Tarjetas: el extracto que vence en el periodo. Créditos: la próxima cuota. Préstamos: todo lo que debes.",
    empty: "No tienes pagos de tarjetas ni créditos este periodo.",
    href: "/cuentas", linkLabel: "Ver cuentas",
  },
};

function SafeToSpendCard({ safe, detail }: { safe: ReturnType<typeof safeToSpendFor>; detail: SafeToSpendDetail }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SafeSection | null>(null);
  const rows: { label: string; value: number; sign: string; section?: SafeSection; href?: string }[] = [
    { label: SECTION_INFO.accounts.title, value: safe.realBalance, sign: "", section: "accounts" },
    { label: SECTION_INFO.obligations.title, value: safe.householdObligationsPending, sign: "−", section: "obligations" },
    { label: SECTION_INFO.savings.title, value: safe.scheduledSavingsPending, sign: "−", section: "savings" },
    { label: SECTION_INFO.debts.title, value: safe.creditCardDebt, sign: "−", section: "debts" },
    { label: "Lo que le debes a tu pareja", value: safe.owedToPartner, sign: "−", href: "/cuentas?vista=cruce" },
  ];
  const info = section ? SECTION_INFO[section] : null;
  const lines = section ? detail[section] : [];
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
              {rows.map((r) => {
                const content = (
                  <>
                    <span className="opacity-85">
                      {r.label}
                      {(r.section || r.href) && <span className="ml-1 whitespace-nowrap text-xs font-semibold underline underline-offset-2">Ver detalle</span>}
                    </span>
                    <span className="num shrink-0 font-medium">{r.sign}{formatCop(r.value)}</span>
                  </>
                );
                const cls = "flex w-full justify-between gap-3 text-left";
                if (r.section) {
                  const sec = r.section;
                  return <button key={r.label} type="button" className={cls} onClick={() => setSection(sec)}>{content}</button>;
                }
                if (r.href) return <Link key={r.label} href={r.href} className={cls}>{content}</Link>;
                return <div key={r.label} className={cls}>{content}</div>;
              })}
              <p className="pt-1 text-xs opacity-70">Lo que tu pareja te debe no suma: no es dinero disponible hasta que te pague.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Sheet open={section !== null} onOpenChange={(v) => !v && setSection(null)}
        title={info?.title ?? ""} description={info?.description}>
        <div className="space-y-2 pb-2">
          {lines.length === 0 ? (
            <p className="text-sm text-muted">{info?.empty}</p>
          ) : (
            <>
              {lines.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{l.label}</p>
                    {l.note && <p className="text-xs text-muted">{l.note}</p>}
                  </div>
                  <p className="num shrink-0 font-semibold">{formatCop(l.amount)}</p>
                </div>
              ))}
              <div className="flex justify-between px-4 pt-1 text-sm">
                <span className="text-muted">Total</span>
                <span className="num font-semibold">{formatCop(lines.reduce((a, l) => a + l.amount, 0))}</span>
              </div>
            </>
          )}
          {info && <Link href={info.href} className="block pt-2 text-center text-sm font-semibold text-olive">{info.linkLabel}</Link>}
        </div>
      </Sheet>
    </Card>
  );
}
