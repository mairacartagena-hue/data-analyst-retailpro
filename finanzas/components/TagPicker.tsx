"use client";

import { useState } from "react";
import { Check, Plus, Tag as TagIcon } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Button } from "@/components/ui/button";
import { ErrorText, Input } from "@/components/ui/input";
import { findTagByName, TAG_COLORS } from "@/lib/finance/tags";
import { cn, errMsg } from "@/lib/utils";

/** Elige las etiquetas de un movimiento y permite crear una nueva al vuelo. */
export function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { tags, household, me, supabase, reload } = useFinance();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  async function create() {
    const clean = name.trim();
    if (!clean) return;
    setError(null);
    const existing = findTagByName(tags, clean);
    if (existing) {
      if (!value.includes(existing.id)) onChange([...value, existing.id]);
      return setName("");
    }
    setBusy(true);
    const { data, error } = await supabase.from("tags").insert({
      household_id: household.id, name: clean, created_by: me.user_id, color: TAG_COLORS[tags.length % TAG_COLORS.length],
    }).select("id").single();
    setBusy(false);
    if (error) {
      // otra persona (o este mismo celular) la creó un instante antes
      if ((error as { code?: string }).code === "23505") {
        await reload();
        return setError("Esa etiqueta ya existe: tócala arriba para elegirla.");
      }
      return setError(errMsg(error));
    }
    onChange([...value, data.id as string]);
    setName("");
    void reload();
  }

  return (
    <div className="space-y-2">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => {
            const on = value.includes(t.id);
            return (
              <button key={t.id} type="button" onClick={() => toggle(t.id)} aria-pressed={on}
                className={cn("flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm", on ? "border-olive bg-olive-soft font-medium" : "border-border bg-surface")}>
                {on ? <Check size={13} /> : <span className="h-2 w-2 rounded-full" style={{ background: t.color ?? "var(--muted)" }} />} {t.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Nueva etiqueta (ej. Viaje, Regalos)" aria-label="Nueva etiqueta"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } }} />
        <Button type="button" variant="outline" size="icon" onClick={create} disabled={busy || !name.trim()} aria-label="Crear etiqueta"><Plus size={18} /></Button>
      </div>
      {tags.length === 0 && <p className="flex items-center gap-1.5 text-xs text-muted"><TagIcon size={13} /> Las etiquetas sirven para filtrar movimientos y sacar informes. Las ven los dos.</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
