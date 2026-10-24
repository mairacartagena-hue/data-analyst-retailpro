"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Home, Lock, Pause, Plus } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { BudgetBar } from "@/components/BudgetBar";
import { useShell } from "@/components/AppShell";
import { CategorySheet } from "@/components/CategorySheet";
import { BudgetDetailSheet } from "@/components/BudgetDetailSheet";
import { PlanSheet } from "@/components/PlanSheet";
import { CommitmentSheet } from "@/components/CommitmentSheet";
import { UpcomingList, useUpcoming } from "@/components/Upcoming";
import { MemberBadge } from "@/components/MemberBadge";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import type { BudgetPlan, Category, ScheduledPayment } from "@/lib/types";
import { statusesFor } from "@/lib/finance/derive";
import { formatCop, formatCopShort } from "@/lib/finance/money";
import { committedTotal, occurrencesOfSpace } from "@/lib/finance/commitments";
import { planAppliesTo, planMetrics, type PlanMetrics } from "@/lib/finance/plans";
import { categoryPath, categoryTree } from "@/lib/finance/spaces";
import { formatDay } from "@/lib/finance/periods";
import { cn } from "@/lib/utils";

export default function PresupuestosPage() {
  const state = useFinance();
  const { categories, period, me, partner, memberById, budgets, plans, planCategories, transactions } = state;
  const { openPayment } = useShell();
  const [detail, setDetail] = useState<Category | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [commitment, setCommitment] = useState<ScheduledPayment | null>(null);
  const [commitmentOpen, setCommitmentOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const statuses = useMemo(() => statusesFor(state, period), [state, period]);
  const upcoming = useUpcoming(period);

  // Abrir una categoría desde el inicio (?categoria=id)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("categoria");
    const c = id ? categories.find((x) => x.id === id) : null;
    if (c) {
      setEditing(c);
      setOpen(true);
      window.history.replaceState(null, "", "/presupuestos");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = categories.filter((c) => !c.archived && c.kind !== "INCOME");
  const archived = categories.filter((c) => c.archived);
  const incomeCats = categories.filter((c) => !c.archived && c.kind === "INCOME");
  const [newKind, setNewKind] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  // Barras en orden de árbol: cada principal seguida de sus subcategorías
  const hasBudget = (id: string | null | undefined) => !!id && budgets.some((b) => b.category_id === id);
  const ordered = categoryTree(active).flatMap((n) => [n.category, ...n.children]);
  // Solo las categorías con límite visible; las demás se ven en Más → Categorías
  const withLimit = ordered.filter((c) => hasBudget(c.id));
  const withoutLimit = ordered.length - withLimit.length;
  const groups: { title: string; items: Category[] }[] = [
    { title: "Obligaciones del hogar", items: withLimit.filter((c) => c.is_household_obligation) },
    { title: "Del hogar", items: withLimit.filter((c) => !c.is_household_obligation && c.responsibility !== "PRIVATE") },
    { title: "Personales", items: withLimit.filter((c) => c.responsibility === "PRIVATE") },
  ];

  // Lo que cada uno tenía a su cargo en el periodo y cuánto ha ejecutado
  // (una subcategoría con presupuesto no se suma otra vez si su principal ya tiene uno)
  const perMember = [me, partner].filter(Boolean).map((m) => {
    let available = 0;
    let spent = 0;
    for (const c of active) {
      if (c.responsibility === "PRIVATE" || hasBudget(c.parent_id)) continue;
      const a = statuses.get(c.id)?.allocations.find((x) => x.userId === m!.user_id);
      if (a) {
        available += a.available;
        spent += a.spent;
      }
    }
    return { member: m!, available, spent };
  });

  const visiblePlans = plans.filter((p) => planAppliesTo(p, period));
  const closedPlans = plans.filter((p) => !planAppliesTo(p, period));
  const metrics = useMemo(() => new Map(plans.map((p) => [p.id, planMetrics(p, planCategories, categories, transactions, upcoming.occurrences, period, upcoming.today)])),
    [plans, planCategories, categories, transactions, upcoming, period]);
  const householdCommitted = committedTotal(occurrencesOfSpace(upcoming.occurrences, "HOUSEHOLD"));
  const myCommitted = committedTotal(occurrencesOfSpace(upcoming.occurrences, "PERSONAL", me.user_id));

  function edit(c: Category | null, kind: "EXPENSE" | "INCOME" = "EXPENSE") {
    setNewKind(kind);
    setEditing(c);
    setOpen(true);
  }
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
            {visiblePlans.map((p) => <PlanCard key={p.id} plan={p} m={metrics.get(p.id)!} onEdit={() => editPlan(p)} />)}
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
              <button key={p.id} onClick={() => editPlan(p)} className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-border p-3 text-left text-muted">
                <span>{p.icon || "•"}</span>{p.name}
                <span className="ml-auto text-xs">{p.status === "CLOSED" ? "Cerrado" : `${formatDay(p.start_date)}${p.end_date ? ` – ${formatDay(p.end_date)}` : ""}`}</span>
              </button>
            ))}
          </div>
        )}

        {/* Compromisos */}
        <div className="mt-6 flex items-center justify-between">
          <SectionTitle className="m-0">Próximos vencimientos</SectionTitle>
          <Button size="sm" variant="ghost" onClick={() => editCommitment(null)}><Plus size={16} /> Compromiso</Button>
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

        {/* Límites por categoría */}
        <SectionTitle>Límites por categoría</SectionTitle>
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
        <p className="mt-2 px-1 text-xs text-muted">Lo que cada uno tiene a su cargo en las categorías del hogar. Las barras compartidas solo suman movimientos del hogar.</p>

        {active.length === 0 && (
          <Card className="mt-6 space-y-2 text-center">
            <p className="text-[15px]">Crea las categorías del hogar: vivienda, servicios, mercado, mascotas, suscripciones, salidas…</p>
            <Button onClick={() => edit(null)}><Plus size={16} /> Crear la primera</Button>
          </Card>
        )}

        {groups.map((g) => g.items.length > 0 && (
          <section key={g.title}>
            <SectionTitle>{g.title}</SectionTitle>
            <div className="space-y-2.5">
              {g.items.map((c) => (
                <div key={c.id} className={cn(c.parent_id && "ml-4")}>
                  <BudgetBar category={c} status={statuses.get(c.id)} memberById={memberById} meId={me.user_id}
                    label={c.parent_id ? categoryPath(categories, c.id) : undefined}
                    onPay={(amount) => openPayment({ categoryId: c.id, amount })} onClick={() => setDetail(c)} />
                </div>
              ))}
            </div>
          </section>
        ))}

        {withoutLimit > 0 && (
          <p className="mt-3 px-1 text-sm text-muted">
            {withoutLimit} categoría{withoutLimit === 1 ? "" : "s"} sin límite (o con progreso privado de tu pareja).{" "}
            <Link href="/categorias" className="font-semibold text-olive underline">Ver categorías</Link> para ponerles un monto.
          </p>
        )}

        <div className="mt-6 flex items-center justify-between">
          <SectionTitle className="m-0">Categorías de ingresos</SectionTitle>
          <Button size="sm" variant="ghost" onClick={() => edit(null, "INCOME")}><Plus size={16} /> Nueva</Button>
        </div>
        {incomeCats.length === 0 ? (
          <p className="px-1 text-sm text-muted">Salario, honorarios, rendimientos… Son personales y no tienen presupuesto.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {incomeCats.map((c) => (
              <button key={c.id} onClick={() => edit(c, "INCOME")} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-sm">
                <span>{c.icon || "•"}</span>{c.name}
              </button>
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <div className="mt-6">
            <button className="px-1 text-sm text-muted underline" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? "Ocultar" : "Ver"} archivadas ({archived.length})
            </button>
            {showArchived && (
              <div className="mt-2 space-y-2">
                {archived.map((c) => (
                  <button key={c.id} onClick={() => edit(c)} className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-border p-3 text-left text-muted">
                    <span>{c.icon || "•"}</span>{c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </SwipePeriods>

      <CategorySheet open={open} onOpenChange={setOpen} category={editing} kind={newKind} />
      <BudgetDetailSheet category={detail} status={detail ? statuses.get(detail.id) : undefined} onClose={() => setDetail(null)} onEdit={(c) => edit(c)} />
      <PlanSheet open={planOpen} onOpenChange={setPlanOpen} plan={plan} />
      <CommitmentSheet open={commitmentOpen} onOpenChange={setCommitmentOpen} payment={commitment} />
    </main>
  );
}

/** Tarjeta de un presupuesto: gastado, comprometido, disponible y proyección; al tocarla muestra sus categorías. */
function PlanCard({ plan, m, onEdit }: { plan: BudgetPlan; m: PlanMetrics; onEdit: () => void }) {
  const { categories } = useFinance();
  const [open, setOpen] = useState(false);
  const scale = Math.max(plan.amount, m.spent + m.committed, 1);
  const paused = plan.status === "PAUSED";

  return (
    <div className={cn("rounded-2xl border border-border bg-surface", paused && "opacity-70")}>
      <button className="w-full p-3.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-lg">{plan.icon || "•"}</span>
            <span className="truncate font-semibold">{plan.name}</span>
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
          <Button size="sm" variant="secondary" onClick={onEdit}>Editar</Button>
        </div>
      )}
    </div>
  );
}
