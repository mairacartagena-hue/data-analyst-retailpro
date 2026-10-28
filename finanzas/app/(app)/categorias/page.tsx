"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, CornerDownRight, Plus, Sparkles } from "lucide-react";
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
import { categoryTree } from "@/lib/finance/spaces";
import { errMsg } from "@/lib/utils";

/** Configuración de categorías: las mismas que usan Presupuesto y el formulario de pagos. */
export default function CategoriasPage() {
  const { categories, budgets, limits, transactions, settings, me, partner, supabase, reload } = useFinance();
  const [editing, setEditing] = useState<Category | null>(null);
  const [parentFor, setParentFor] = useState<string | null>(null);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
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

  // Monto vigente de cada presupuesto de categoría (por id de presupuesto)
  const amountOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const bc of toBudgetCategories(limits, budgets)) {
      const v = budgetVersionAt(bc.budgets, currentStart);
      if (v) m.set(bc.id, v.amount);
    }
    return m;
  }, [limits, budgets, currentStart]);

  /** Resumen de los presupuestos de una categoría: el del hogar (con quién lo asume) y el mío personal. */
  function budgetSummary(c: Category): string | null {
    const parts: string[] = [];
    for (const l of limits.filter((x) => x.category_id === c.id)) {
      const amount = amountOf.get(l.id);
      if (amount == null) continue;
      if (l.scope === "PERSONAL") parts.push(`tu presupuesto ${formatCop(amount)}`);
      else {
        const who = l.responsibility === "MEMBER_A_100" ? memberA?.display_name : l.responsibility === "MEMBER_B_100" ? memberB?.display_name : null;
        parts.push(`hogar ${formatCop(amount)}${who ? ` a cargo de ${who}` : ", montos fijos"}`);
      }
    }
    return parts.length ? parts.join(" · ") : null;
  }

  function edit(c: Category | null, k: "EXPENSE" | "INCOME" = "EXPENSE", parent: string | null = null) {
    setKind(k);
    setEditing(c);
    setParentFor(parent);
    setOpen(true);
  }

  async function addSuggested() {
    setSeeding(true);
    setSeedMsg(null);
    const { data, error } = await supabase.rpc("add_suggested_categories");
    setSeeding(false);
    if (error) return setSeedMsg(errMsg(error));
    const n = Number(data ?? 0);
    setSeedMsg(n === 0 ? "Ya tenías todas las categorías sugeridas." : `Se agregaron ${n} categorías. Quién asume cada pago se define en Presupuesto (ej. la hipoteca 100 % de una persona).`);
    void reload();
  }

  const expense = categories.filter((c) => !c.archived && c.kind !== "INCOME");
  const income = categories.filter((c) => !c.archived && c.kind === "INCOME");
  const archived = categories.filter((c) => c.archived);
  const tree = categoryTree(expense);
  const roots = tree.map((n) => n.category);
  const childrenOf = new Map(tree.map((n) => [n.category.id, n.children]));

  function row(c: Category, child = false) {
    const n = uses.get(c.id) ?? 0;
    const detail = [
      c.kind === "INCOME" ? "Ingreso" : budgetSummary(c) ?? "Sin presupuesto",
      `${n} movimiento${n === 1 ? "" : "s"}`,
    ].filter(Boolean).join(" · ");
    return (
      <button key={c.id} onClick={() => edit(c, c.kind === "INCOME" ? "INCOME" : "EXPENSE")}
        className={`flex w-full items-center gap-3 py-3 pr-4 text-left hover:bg-surface-2 ${child ? "pl-8" : "pl-4"}`}>
        {child
          ? <CornerDownRight size={16} className="shrink-0 text-muted" />
          : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg">{c.icon || "•"}</span>}
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
      {items.map((c) => (
        <div key={c.id} className="divide-y divide-border">
          {row(c)}
          {(childrenOf.get(c.id) ?? []).map((sub) => row(sub, true))}
          {c.kind !== "INCOME" && !c.archived && (
            <button onClick={() => edit(null, "EXPENSE", c.id)} className="flex w-full items-center gap-2 py-2 pl-8 text-left text-xs font-medium text-olive hover:bg-surface-2">
              <Plus size={13} /> Subcategoría en {c.name}
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <main className="px-4 pb-6 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <Link href="/mas" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
          <h1 className="font-display text-3xl">Categorías</h1>
        </div>
        <Button size="sm" onClick={() => edit(null)}><Plus size={16} /> Nueva</Button>
      </div>
      <p className="px-1 text-sm text-muted">
        Son las mismas de <Link href="/presupuestos" className="font-semibold text-olive underline">Presupuesto</Link> y
        las que eliges al registrar un pago. Las usan los dos: solo dicen en qué se gastó. Si un gasto es del hogar o personal, y quién lo asume, se define en Presupuesto y en cada movimiento.
      </p>

      <div className="mt-3 space-y-1.5 rounded-2xl bg-surface-2 p-3">
        <p className="text-sm">Estructura sugerida: Vivienda y hogar, Alimentación, Mascotas, Transporte, Salud, Deudas, Estilo de vida y Ahorro, con sus subcategorías, más las de ingresos.</p>
        <Button size="sm" variant="secondary" onClick={addSuggested} disabled={seeding}>
          <Sparkles size={15} /> {seeding ? "Agregando..." : "Agregar las que falten"}
        </Button>
        {seedMsg && <p className="text-xs text-muted">{seedMsg}</p>}
        <p className="text-xs text-muted">No duplica: si ya tienes una categoría con el mismo nombre, se deja la tuya (puedes moverla dentro de una principal).</p>
      </div>

      <SectionTitle>Gastos</SectionTitle>
      {expense.length === 0 ? (
        <Card className="space-y-2 text-center">
          <p className="text-[15px]">Crea las categorías del hogar: vivienda, servicios, mercado, mascotas, suscripciones, salidas…</p>
          <Button onClick={() => edit(null)}><Plus size={16} /> Crear la primera</Button>
        </Card>
      ) : (
        list(roots)
      )}

      <div className="mt-6 flex items-center justify-between">
        <SectionTitle className="m-0">Ingresos</SectionTitle>
        <Button size="sm" variant="ghost" onClick={() => edit(null, "INCOME")}><Plus size={16} /> Nueva</Button>
      </div>
      {income.length === 0
        ? <p className="px-1 text-sm text-muted">Salario, honorarios, rendimientos… Sirven para saber de dónde viene la plata.</p>
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

      <CategorySheet open={open} onOpenChange={setOpen} category={editing} kind={kind} parentId={parentFor} />
    </main>
  );
}
