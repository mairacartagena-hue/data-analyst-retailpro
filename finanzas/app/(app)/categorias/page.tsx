"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { CategorySheet } from "@/components/CategorySheet";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import type { Category } from "@/lib/types";
import { budgetVersionAt } from "@/lib/finance/budget";
import { toBudgetCategories } from "@/lib/finance/derive";
import { formatCop } from "@/lib/finance/money";
import { periodFor, todayBogota } from "@/lib/finance/periods";
import { memberBySlot } from "@/lib/finance/labels";

/** Configuración de categorías: las mismas que usan Presupuesto y el formulario de pagos. */
export default function CategoriasPage() {
  const { categories, budgets, transactions, settings, me, partner } = useFinance();
  const [editing, setEditing] = useState<Category | null>(null);
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const currentStart = periodFor(settings, todayBogota()).start;
  const memberA = memberBySlot(me, partner, "A");
  const memberB = memberBySlot(me, partner, "B");

  // Cuántos movimientos usan cada categoría (gastos por sus partes, ingresos por su categoría)
  const uses = useMemo(() => {
    const m = new Map<string, number>();
    const add = (id: string | null | undefined) => id && m.set(id, (m.get(id) ?? 0) + 1);
    for (const t of transactions) {
      add(t.income_category_id);
      for (const id of new Set(t.splits.map((s) => s.category_id))) add(id);
    }
    return m;
  }, [transactions]);

  const budgetOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const bc of toBudgetCategories(categories, budgets)) {
      const v = budgetVersionAt(bc.budgets, currentStart);
      if (v) m.set(bc.id, v.amount);
    }
    return m;
  }, [categories, budgets, currentStart]);

  function whoLabel(c: Category): string {
    switch (c.responsibility) {
      case "MEMBER_A_100": return `100 % ${memberA?.display_name ?? "A"}`;
      case "MEMBER_B_100": return `100 % ${memberB?.display_name ?? "B"}`;
      case "FIXED_AMOUNTS": return "Montos fijos";
      default: return "Personal";
    }
  }

  function edit(c: Category | null, k: "EXPENSE" | "INCOME" = "EXPENSE") {
    setKind(k);
    setEditing(c);
    setOpen(true);
  }

  const expense = categories.filter((c) => !c.archived && c.kind !== "INCOME");
  const income = categories.filter((c) => !c.archived && c.kind === "INCOME");
  const archived = categories.filter((c) => c.archived);
  const groups: { title: string; items: Category[] }[] = [
    { title: "Obligaciones del hogar", items: expense.filter((c) => c.is_household_obligation) },
    { title: "Compartidas y del hogar", items: expense.filter((c) => !c.is_household_obligation && c.responsibility !== "PRIVATE") },
    { title: "Personales", items: expense.filter((c) => c.responsibility === "PRIVATE") },
  ];

  function row(c: Category) {
    const amount = budgetOf.get(c.id);
    const n = uses.get(c.id) ?? 0;
    const detail = [
      c.kind === "INCOME" ? "Ingreso" : whoLabel(c),
      c.kind !== "INCOME" && amount != null ? `${formatCop(amount)} por periodo` : null,
      `${n} movimiento${n === 1 ? "" : "s"}`,
    ].filter(Boolean).join(" · ");
    return (
      <button key={c.id} onClick={() => edit(c, c.kind === "INCOME" ? "INCOME" : "EXPENSE")}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg">{c.icon || "•"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{c.name}</span>
          <span className="block truncate text-xs text-muted">{detail}</span>
        </span>
        <ChevronRight size={18} className="text-muted" />
      </button>
    );
  }

  const list = (items: Category[]) => (
    <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface">
      {items.map(row)}
    </div>
  );

  return (
    <main className="px-4 pb-6 pt-[calc(12px+env(safe-area-inset-top))]">
      <Link href="/mas" className="-ml-1 inline-flex items-center gap-1 py-1 text-sm text-muted"><ChevronLeft size={16} /> Más</Link>
      <div className="flex items-center justify-between py-2">
        <h1 className="font-display text-3xl">Categorías</h1>
        <Button size="sm" onClick={() => edit(null)}><Plus size={16} /> Nueva</Button>
      </div>
      <p className="px-1 text-sm text-muted">
        Son las mismas de <Link href="/presupuestos" className="font-semibold text-olive underline">Presupuesto</Link> y
        las que eliges al registrar un pago. Toca una para cambiar nombre, ícono, quién la asume o el monto.
      </p>

      <SectionTitle>Gastos</SectionTitle>
      {expense.length === 0 ? (
        <Card className="space-y-2 text-center">
          <p className="text-[15px]">Crea las categorías del hogar: vivienda, servicios, mercado, mascotas, suscripciones, salidas…</p>
          <Button onClick={() => edit(null)}><Plus size={16} /> Crear la primera</Button>
        </Card>
      ) : (
        groups.map((g) => g.items.length > 0 && (
          <section key={g.title} className="mt-3">
            <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</p>
            {list(g.items)}
          </section>
        ))
      )}

      <div className="mt-6 flex items-center justify-between">
        <SectionTitle className="m-0">Ingresos</SectionTitle>
        <Button size="sm" variant="ghost" onClick={() => edit(null, "INCOME")}><Plus size={16} /> Nueva</Button>
      </div>
      {income.length === 0
        ? <p className="px-1 text-sm text-muted">Salario, ventas, reembolsos… Son personales y no tienen presupuesto.</p>
        : list(income)}

      {archived.length > 0 && (
        <div className="mt-6">
          <button className="px-1 text-sm text-muted underline" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Ocultar" : "Ver"} archivadas ({archived.length})
          </button>
          {showArchived && <div className="mt-2 opacity-70">{list(archived)}</div>}
          <p className="mt-1 px-1 text-xs text-muted">Las archivadas no aparecen en Presupuesto ni al registrar pagos; sus movimientos se conservan.</p>
        </div>
      )}

      <CategorySheet open={open} onOpenChange={setOpen} category={editing} kind={kind} />
    </main>
  );
}
