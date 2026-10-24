"use client";

import { Plus } from "lucide-react";
import type { Category } from "@/lib/types";
import { useFinance } from "@/lib/data/FinanceProvider";
import { categoryTree, categoriesInTreeOrder, categoryPath } from "@/lib/finance/spaces";
import { cn } from "@/lib/utils";

/**
 * Elegir categoría en dos pasos: primero la principal y, si tiene subcategorías, una de ellas
 * (o quedarse con la principal).
 */
export function CategoryPicker({
  categories, value, onPick, onNew,
}: {
  categories: Category[];
  value: string;
  onPick: (c: Category) => void;
  onNew?: () => void;
}) {
  const tree = categoryTree(categories);
  const selected = categories.find((c) => c.id === value) ?? null;
  const activeRoot = selected ? (tree.find((n) => n.category.id === selected.id || n.children.some((c) => c.id === selected.id))?.category.id ?? null) : null;
  const node = tree.find((n) => n.category.id === activeRoot) ?? null;

  const chip = (c: Category, active: boolean, small = false) => (
    <button key={c.id} type="button" onClick={() => onPick(c)} aria-pressed={active}
      className={cn("flex items-center gap-1.5 rounded-full border text-sm",
        small ? "px-2.5 py-1.5" : "px-3 py-2",
        active ? "border-olive bg-olive-soft font-semibold" : "border-border bg-surface text-muted")}>
      {!small && <span>{c.icon || "•"}</span>}{c.name}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tree.map((n) => chip(n.category, n.category.id === activeRoot))}
        {onNew && (
          <button type="button" onClick={onNew}
            className="flex items-center gap-1 rounded-full border border-dashed border-olive px-3 py-2 text-sm font-medium text-olive">
            <Plus size={15} /> Nueva
          </button>
        )}
      </div>
      {node && node.children.length > 0 && (
        <div className="rounded-2xl bg-surface-2 p-2">
          <p className="mb-1.5 px-1 text-xs text-muted">Subcategoría de {node.category.name} (opcional)</p>
          <div className="flex flex-wrap gap-1.5">
            {node.children.map((c) => chip(c, c.id === value, true))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Opciones de un <select> en orden de árbol ("Principal › Sub"). */
export function CategoryOptions({ categories }: { categories: Category[] }) {
  const { categories: all } = useFinance();
  return (
    <>
      {categoriesInTreeOrder(categories).map((c) => (
        <option key={c.id} value={c.id}>{c.icon && !c.parent_id ? `${c.icon} ` : ""}{categoryPath(all, c.id)}</option>
      ))}
    </>
  );
}
