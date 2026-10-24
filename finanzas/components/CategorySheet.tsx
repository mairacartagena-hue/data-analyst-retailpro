"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import type { Category } from "@/lib/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { errMsg } from "@/lib/utils";

const SUGGESTED_ICONS = ["🏠", "💡", "🛒", "🐾", "📺", "🍽️", "🚗", "💊", "🎓", "🎁", "✈️", "👕", "💳", "🧾"];

const INCOME_ICONS = ["💼", "💰", "🏦", "🧾", "🎁", "🏠", "📈", "🛍️", "🔁"];

/**
 * Categoría: solo dice en qué se gastó o de dónde vino la plata (nombre, ícono y categoría principal).
 * La usan los dos. Si un gasto es del hogar o personal, y quién lo asume, se define en el presupuesto
 * y en cada movimiento.
 */
export function CategorySheet({
  open, onOpenChange, category, kind = "EXPENSE", onSaved, parentId = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  category: Category | null;
  /** Tipo de la categoría nueva (al editar se usa el de la categoría). */
  kind?: "EXPENSE" | "INCOME";
  /** Se llama con el id guardado (ej. para elegirla en el formulario de un movimiento). */
  onSaved?: (id: string) => void;
  /** Categoría principal sugerida para una nueva (crear una subcategoría). */
  parentId?: string | null;
}) {
  const { supabase, reload, categories } = useFinance();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(category?.name ?? "");
    setIcon(category?.icon ?? "");
    setParent(category ? (category.parent_id ?? "") : (parentId ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category]);

  const isIncome = (category?.kind ?? kind) === "INCOME";
  const hasChildren = !!category && categories.some((c) => c.parent_id === category.id);
  // Principales posibles: del mismo tipo, sin principal propia y distintas de esta
  const parentOptions = categories.filter((c) => !c.archived && !c.parent_id && c.id !== category?.id
    && (c.kind ?? "EXPENSE") === (isIncome ? "INCOME" : "EXPENSE"));

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Ponle un nombre.");
    setBusy(true);
    const { data: savedId, error } = await supabase.rpc("save_category", {
      p: { id: category?.id ?? null, kind: isIncome ? "INCOME" : "EXPENSE", parent_id: parent || null, name, icon },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    if (savedId) onSaved?.(savedId as string);
    void reload();
  }

  async function toggleArchive() {
    if (!category) return;
    setBusy(true);
    const { error } = await supabase.rpc("archive_category", { p_id: category.id, p_archived: !category.archived });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={category ? "Editar categoría" : isIncome ? "Nueva categoría de ingreso" : "Nueva categoría"}
      description="Las categorías las usan los dos. Si es del hogar o personal, y quién lo asume, se define en el presupuesto y en cada movimiento.">
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-[72px_1fr] gap-3">
          <Field label="Ícono" htmlFor="icon">
            <Input id="icon" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} className="text-center text-xl" placeholder="🛒" />
          </Field>
          <Field label="Nombre" htmlFor="cat-name">
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder={isIncome ? "Salario, ventas, reembolsos…" : "Mercado, arriendo, salidas…"} />
          </Field>
        </div>
        <div className="no-scrollbar -mt-1 flex gap-1.5 overflow-x-auto">
          {(isIncome ? INCOME_ICONS : SUGGESTED_ICONS).map((i) => (
            <button key={i} type="button" onClick={() => setIcon(i)} className="rounded-xl bg-surface-2 px-2 py-1 text-lg">{i}</button>
          ))}
        </div>

        {hasChildren ? (
          <p className="text-xs text-muted">Es una categoría principal: sus subcategorías suman en sus presupuestos.</p>
        ) : (
          <Field label="Dentro de" hint="Elige una categoría principal para que esta sea una subcategoría (ej. Vivienda › Crédito hipotecario).">
            <Select value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Categoría principal">
              <option value="">Ninguna (es una categoría principal)</option>
              {parentOptions.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>)}
            </Select>
          </Field>
        )}

        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          {category && (
            <Button variant="secondary" size="icon" onClick={toggleArchive} disabled={busy} aria-label={category.archived ? "Restaurar" : "Archivar"}>
              {category.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
            </Button>
          )}
          <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</Button>
        </div>
      </div>
    </Sheet>
  );
}
