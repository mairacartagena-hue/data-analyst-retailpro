"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { BudgetBar } from "@/components/BudgetBar";
import { useShell } from "@/components/AppShell";
import { CategorySheet } from "@/components/CategorySheet";
import { BudgetDetailSheet } from "@/components/BudgetDetailSheet";
import { MemberBadge } from "@/components/MemberBadge";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import type { Category } from "@/lib/types";
import { statusesFor } from "@/lib/finance/derive";
import { formatCop } from "@/lib/finance/money";

export default function PresupuestosPage() {
  const state = useFinance();
  const { categories, period, me, partner, memberById, budgets } = state;
  const { openPayment } = useShell();
  const [detail, setDetail] = useState<Category | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const statuses = useMemo(() => statusesFor(state, period), [state, period]);

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
  const groups: { title: string; items: Category[] }[] = [
    { title: "Obligaciones del hogar", items: active.filter((c) => c.is_household_obligation) },
    { title: "Compartidas y del hogar", items: active.filter((c) => !c.is_household_obligation && c.responsibility !== "PRIVATE") },
    { title: "Personales", items: active.filter((c) => c.responsibility === "PRIVATE") },
  ];

  // Lo que cada uno tenía a su cargo en el periodo y cuánto ha ejecutado
  const perMember = [me, partner].filter(Boolean).map((m) => {
    let available = 0;
    let spent = 0;
    for (const c of active) {
      if (c.responsibility === "PRIVATE") continue;
      const a = statuses.get(c.id)?.allocations.find((x) => x.userId === m!.user_id);
      if (a) {
        available += a.available;
        spent += a.spent;
      }
    }
    return { member: m!, available, spent };
  });

  function edit(c: Category | null, kind: "EXPENSE" | "INCOME" = "EXPENSE") {
    setNewKind(kind);
    setEditing(c);
    setOpen(true);
  }

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between py-2">
        <h1 className="font-display text-3xl">Presupuestos</h1>
        <Button size="sm" onClick={() => edit(null)}><Plus size={16} /> Nueva</Button>
      </div>
      <PeriodSwitcher />

      <SwipePeriods>
        <SectionTitle>Lo que cada uno tiene a su cargo</SectionTitle>
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
        <p className="mt-2 px-1 text-xs text-muted">Solo cuenta lo que puedes ver: si una categoría de tu pareja no tiene progreso compartido, no aparece aquí.</p>

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
                budgets.some((b) => b.category_id === c.id) ? (
                  <BudgetBar key={c.id} category={c} status={statuses.get(c.id)} memberById={memberById} meId={me.user_id}
                  onPay={(amount) => openPayment({ categoryId: c.id, amount })} onClick={() => setDetail(c)} />
                ) : (
                  <button key={c.id} onClick={() => edit(c)} className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface p-3.5 text-left">
                    <span className="flex items-center gap-2"><span className="text-lg">{c.icon || "•"}</span><span className="font-semibold">{c.name}</span></span>
                    <span className="text-xs text-muted">Progreso privado</span>
                  </button>
                )
              ))}
            </div>
          </section>
        ))}

        <div className="mt-6 flex items-center justify-between">
          <SectionTitle className="m-0">Categorías de ingresos</SectionTitle>
          <Button size="sm" variant="ghost" onClick={() => edit(null, "INCOME")}><Plus size={16} /> Nueva</Button>
        </div>
        {incomeCats.length === 0 ? (
          <p className="px-1 text-sm text-muted">Salario, ventas, reembolsos… Son personales y no tienen presupuesto.</p>
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
    </main>
  );
}
