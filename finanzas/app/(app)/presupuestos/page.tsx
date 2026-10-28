"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Home, Lock, Pause, Plus, Users } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { BudgetBar } from "@/components/BudgetBar";
import { useShell } from "@/components/AppShell";
import { LimitSheet } from "@/components/LimitSheet";
import { BudgetDetailSheet } from "@/components/BudgetDetailSheet";
import { PlanSheet } from "@/components/PlanSheet";
import { CommitmentSheet } from "@/components/CommitmentSheet";
import { UpcomingList, useUpcoming } from "@/components/Upcoming";
import { MemberBadge } from "@/components/MemberBadge";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import type { BudgetPlan, CategoryLimit, ScheduledPayment } from "@/lib/types";
import { limitResponsible, statusesFor } from "@/lib/finance/derive";
import { formatCop, formatCopShort } from "@/lib/finance/money";
import { committedTotal, occurrencesOfSpace } from "@/lib/finance/commitments";
import { planAppliesTo, planMetrics, sharedAsTransactions, type PlanMetrics } from "@/lib/finance/plans";
import { categoryPath, categoryTree } from "@/lib/finance/spaces";
import { formatDay } from "@/lib/finance/periods";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/lib/finance/labels";

export default function PresupuestosPage() {
  const state = useFinance();
  const { categories, period, me, partner, memberById, limits, plans, planCategories } = state;
  const { openPayment } = useShell();
  const [detail, setDetail] = useState<CategoryLimit | null>(null);
  const [limit, setLimit] = useState<CategoryLimit | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [commitment, setCommitment] = useState<ScheduledPayment | null>(null);
  const [commitmentOpen, setCommitmentOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const statuses = useMemo(() => statusesFor(state, period), [state, period]);
  const upcoming = useUpcoming(period);

  // Abrir un presupuesto de categoría desde el inicio (?limite=id)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("limite");
    const l = id ? limits.find((x) => x.id === id) : null;
    if (l) {
      setLimit(l);
      setLimitOpen(true);
      window.history.replaceState(null, "", "/presupuestos");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Presupuestos de categoría en orden de árbol de sus categorías
  const order = new Map(categoryTree(categories.filter((c) => !c.archived)).flatMap((n) => [n.category, ...n.children]).map((c, i) => [c.id, i]));
  const shown = limits
    .filter((l) => order.has(l.category_id))
    .sort((x, y) => (order.get(x.category_id)! - order.get(y.category_id)!));
  const groups: { title: string; items: CategoryLimit[] }[] = [
    { title: "Obligaciones del hogar", items: shown.filter((l) => l.is_household_obligation) },
    { title: "Del hogar", items: shown.filter((l) => l.scope === "HOUSEHOLD" && !l.is_household_obligation) },
    { title: "Personales", items: shown.filter((l) => l.scope === "PERSONAL" && l.owner_user_id === me.user_id) },
    { title: partner ? `Compartidos por ${partner.display_name}` : "Compartidos", items: shown.filter((l) => l.scope === "PERSONAL" && l.owner_user_id !== me.user_id) },
  ];

  // Lo que cada uno tenía a su cargo en los presupuestos del hogar y cuánto ha ejecutado
  // (el de una subcategoría no se suma otra vez si su principal ya tiene presupuesto del hogar)
  const householdCats = new Set(shown.filter((l) => l.scope === "HOUSEHOLD").map((l) => l.category_id));
  const perMember = [me, partner].filter(Boolean).map((m) => {
    let available = 0;
    let spent = 0;
    for (const l of shown) {
      if (l.scope !== "HOUSEHOLD") continue;
      const parent = categories.find((c) => c.id === l.category_id)?.parent_id;
      if (parent && householdCats.has(parent)) continue;
      const a = statuses.get(l.id)?.allocations.find((x) => x.userId === m!.user_id);
      if (a) {
        available += a.available;
        spent += a.spent;
      }
    }
    return { member: m!, available, spent };
  });

  const visiblePlans = plans.filter((p) => planAppliesTo(p, period));
  const closedPlans = plans.filter((p) => !planAppliesTo(p, period));
  // Un presupuesto personal que comparte la pareja se mide con sus totales compartidos (no veo sus movimientos)
  const metrics = useMemo(() => {
    // Compras a cuotas: cada cuota cuenta en su mes
    const own = state.consumption;
    const withShared = [...own, ...sharedAsTransactions(state.sharedSpending)];
    return new Map(plans.map((p) => [p.id, planMetrics(p, planCategories, categories,
      p.owner_user_id === me.user_id || p.scope === "HOUSEHOLD" ? own : withShared, upcoming.occurrences, period, upcoming.today)]));
  }, [plans, planCategories, categories, state.consumption, state.sharedSpending, upcoming, period, me.user_id]);
  const householdCommitted = committedTotal(occurrencesOfSpace(upcoming.occurrences, "HOUSEHOLD"));
  const myCommitted = committedTotal(occurrencesOfSpace(upcoming.occurrences, "PERSONAL", me.user_id));

  const editLimit = (l: CategoryLimit | null) => { setLimit(l); setLimitOpen(true); };
  /** Presupuesto personal de la pareja que ella comparte conmigo: solo se mira. */
  const isPartners = (l: CategoryLimit) => l.scope === "PERSONAL" && l.owner_user_id !== me.user_id;
  const editPlan = (p: BudgetPlan | null) => { setPlan(p); setPlanOpen(true); };
  const editCommitment = (p: ScheduledPayment | null) => { setCommitment(p); setCommitmentOpen(true); };

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between py-2">
        <h1 className="font-display text-3xl">Presupuesto</h1>
        <Button size="sm" onClick={() => editPlan(null)}><Plus size={16} /> Presupuesto</Button>
      </div>
      <PeriodSwitcher />

      <SwipePeriods>
        {/* Presupuestos con nombre */}
        <SectionTitle>Presupuestos</SectionTitle>
        {visiblePlans.length === 0 ? (
          <Card className="space-y-2 text-sm">
            <p>Agrupa categorías con un límite: “Comida” (Alimentación), “Casa” (Vivienda y hogar) o uno personal como “Mis gustos”.</p>
            <Button size="sm" variant="secondary" onClick={() => editPlan(null)}><Plus size={15} /> Crear presupuesto</Button>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {visiblePlans.map((p) => <PlanCard key={p.id} plan={p} m={metrics.get(p.id)!}
              onEdit={p.scope === "PERSONAL" && p.owner_user_id !== me.user_id ? undefined : () => editPlan(p)} />)}
          </div>
        )}
        {closedPlans.length > 0 && (
          <button className="mt-2 px-1 text-sm text-muted underline" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? "Ocultar" : "Ver"} cerrados o fuera de fecha ({closedPlans.length})
          </button>
        )}
        {showClosed && (
          <div className="mt-2 space-y-2">
            {closedPlans.map((p) => (
              <button key={p.id} onClick={() => (p.scope === "HOUSEHOLD" || p.owner_user_id === me.user_id) && editPlan(p)} className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-border p-3 text-left text-muted">
                <span>{p.icon || "•"}</span>{p.name}
                <span className="ml-auto text-xs">{p.status === "CLOSED" ? "Cerrado" : `${formatDay(p.start_date)}${p.end_date ? ` – ${formatDay(p.end_date)}` : ""}`}</span>
              </button>
            ))}
          </div>
        )}

        {/* Próximos vencimientos */}
        <div className="mt-6 flex items-center justify-between">
          <SectionTitle className="m-0">Próximos vencimientos</SectionTitle>
          <Button size="sm" variant="ghost" onClick={() => editCommitment(null)}><Plus size={16} /> Vencimiento</Button>
        </div>
        {(householdCommitted > 0 || myCommitted > 0) && (
          <p className="mb-2 px-1 text-xs text-muted">
            Comprometido sin pagar: <span className="num font-semibold text-text">{formatCop(householdCommitted)}</span> del hogar
            {myCommitted > 0 && <> · <span className="num font-semibold text-text">{formatCop(myCommitted)}</span> tuyos</>}.
            No es gasto hasta que lo pagues.
          </p>
        )}
        {upcoming.occurrences.length + upcoming.cards.length === 0 ? (
          <p className="px-1 text-sm text-muted">Agrega cuotas, administración, seguros o pagos de una sola vez para verlos aquí antes de que venzan.</p>
        ) : (
          <UpcomingList occurrences={upcoming.occurrences} cards={upcoming.cards} today={upcoming.today} onEdit={editCommitment} />
        )}

        {/* Presupuestos por categoría */}
        <div className="mt-6 flex items-center justify-between">
          <SectionTitle className="m-0">Presupuestos por categoría</SectionTitle>
          <Button size="sm" variant="ghost" onClick={() => editLimit(null)}><Plus size={16} /> Categoría</Button>
        </div>
        <p className="mb-2 px-1 text-xs text-muted">
          Aquí se define si el presupuesto es del hogar o personal y quién lo asume. Las categorías las usan los dos
          (<Link href="/categorias" className="font-semibold text-olive underline">ver categorías</Link>).
        </p>
        {shown.some((l) => l.scope === "HOUSEHOLD") && (
          <div className="grid grid-cols-2 gap-3">
            {perMember.map(({ member, available, spent }) => (
              <Card key={member.user_id} className="p-3.5">
                <div className="flex items-center gap-2">
                  <MemberBadge member={member} size={24} />
                  <span className="truncate text-sm font-semibold">{member.user_id === me.user_id ? "Yo" : member.display_name}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, available ? (spent / available) * 100 : 0)}%`, background: member.color }} />
                </div>
                <p className="num mt-1.5 text-xs text-muted">{formatCop(spent)} de {formatCop(available)}</p>
              </Card>
            ))}
          </div>
        )}

        {shown.length === 0 && (
          <Card className="space-y-2 text-sm">
            <p>Ponle un límite a una categoría (ej. Mercado del hogar con montos fijos, o tu Ropa personal) y define quién lo asume.</p>
            <Button size="sm" variant="secondary" onClick={() => editLimit(null)}><Plus size={15} /> Crear presupuesto de categoría</Button>
          </Card>
        )}

        {groups.map((g) => g.items.length > 0 && (
          <section key={g.title}>
            <SectionTitle>{g.title}</SectionTitle>
            <div className="space-y-2.5">
              {g.items.map((l) => {
                const c = categories.find((x) => x.id === l.category_id)!;
                return (
                  <div key={l.id} className={cn(c.parent_id && "ml-4")}>
                    <BudgetBar category={c} limit={l} status={statuses.get(l.id)} memberById={memberById} meId={me.user_id}
                      label={categoryPath(categories, c.id) + (isPartners(l) ? ` (de ${partner?.display_name ?? "tu pareja"})` : "")} icon={categoryLabel(categories, c.id).icon}
                      onPay={isPartners(l) ? undefined : (amount) => openPayment({ categoryId: c.id, amount, scope: l.scope, responsibleId: limitResponsible(l, me, partner) ?? me.user_id })}
                      onClick={() => setDetail(l)} />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </SwipePeriods>

      <LimitSheet open={limitOpen} onOpenChange={setLimitOpen} limit={limit} />
      <BudgetDetailSheet limit={detail} status={detail ? statuses.get(detail.id) : undefined} onClose={() => setDetail(null)} onEdit={(l) => !isPartners(l) && editLimit(l)} />
      <PlanSheet open={planOpen} onOpenChange={setPlanOpen} plan={plan} />
      <CommitmentSheet open={commitmentOpen} onOpenChange={setCommitmentOpen} payment={commitment} />
    </main>
  );
}

/** Tarjeta de un presupuesto: gastado, comprometido, disponible y proyección; al tocarla muestra sus categorías. */
function PlanCard({ plan, m, onEdit }: { plan: BudgetPlan; m: PlanMetrics; onEdit?: () => void }) {
  const { categories, me, memberById } = useFinance();
  const [open, setOpen] = useState(false);
  const scale = Math.max(plan.amount, m.spent + m.committed, 1);
  const owner = plan.owner_user_id !== me.user_id ? memberById(plan.owner_user_id) : null;
  const paused = plan.status === "PAUSED";

  return (
    <div className={cn("rounded-2xl border border-border bg-surface", paused && "opacity-70")}>
      <button className="w-full p-3.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-lg">{plan.icon || "•"}</span>
            <span className="truncate font-semibold">{plan.name}{plan.scope === "PERSONAL" && owner ? ` (de ${owner.display_name})` : ""}</span>
            {plan.scope === "PERSONAL" && plan.shared_with_partner && !owner && <Users size={14} className="shrink-0 text-muted" aria-label="Compartido con tu pareja" />}
            {plan.scope === "HOUSEHOLD" ? <Home size={14} className="shrink-0 text-muted" aria-label="Del hogar" /> : <Lock size={14} className="shrink-0 text-muted" aria-label="Personal" />}
            {paused && <Pause size={14} className="shrink-0 text-muted" aria-label="En pausa" />}
            {m.level !== "ok" && <AlertTriangle size={15} className={cn("shrink-0", m.level === "over" ? "text-danger" : "text-warning")} aria-label="Alerta" />}
          </span>
          <ChevronDown size={16} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />
        </div>
        <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
          <span className="h-full" style={{ width: `${(Math.max(0, m.spent) / scale) * 100}%`, background: m.level === "over" ? "var(--danger)" : "var(--household)" }} />
          <span className="h-full opacity-40" style={{ width: `${(m.committed / scale) * 100}%`, background: "var(--household)" }} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
          <span><span className="block text-muted">Gastado</span><span className="num font-semibold">{formatCopShort(m.spent)}</span></span>
          <span><span className="block text-muted">Comprometido</span><span className="num font-semibold">{formatCopShort(m.committed)}</span></span>
          <span className="text-right"><span className="block text-muted">Disponible</span>
            <span className={cn("num font-semibold", m.available < 0 && "text-danger")}>{formatCopShort(m.available)}</span></span>
        </div>
        <p className={cn("mt-1.5 text-xs", m.projectedOver ? "text-warning" : "text-muted")}>
          Límite {formatCop(plan.amount)} · proyección de cierre {formatCop(m.projection)}{m.projectedOver ? " (se pasaría)" : ""}
          {plan.periodicity === "RANGE" ? ` · ${formatDay(m.window.start)} – ${formatDay(m.window.end)}` : ""}
        </p>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3.5 py-3">
          {m.byCategory.map((c) => {
            const over = c.limit != null && c.spent > c.limit;
            return (
              <div key={c.categoryId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{categoryPath(categories, c.categoryId) || "Categoría"}</span>
                <span className={cn("num shrink-0", over && "font-semibold text-danger")}>
                  {formatCop(c.spent)}{c.limit != null ? ` de ${formatCop(c.limit)}` : ""}
                </span>
              </div>
            );
          })}
          {m.occurrences.length > 0 && (
            <p className="text-xs text-muted">
              Vencimientos incluidos: {m.occurrences.map((o) => `${o.payment.name} (${formatDay(o.due)}${o.paid ? ", pagado" : ""})`).join(" · ")}
            </p>
          )}
          <p className="text-xs text-muted">Alerta al {plan.alert_pct} %. Cada parte de un movimiento cuenta una sola vez.</p>
          {onEdit
            ? <Button size="sm" variant="secondary" onClick={onEdit}>Editar</Button>
            : <p className="text-xs text-muted">Compartido por tu pareja: ves el avance, no sus movimientos.</p>}
        </div>
      )}
    </div>
  );
}
