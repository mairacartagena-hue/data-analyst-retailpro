"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Button } from "@/components/ui/button";
import { ErrorText, Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { findTagByName, TAG_COLORS, tagKey, tagUsage } from "@/lib/finance/tags";
import { cn, errMsg } from "@/lib/utils";

/** Crear, renombrar, cambiar de color y borrar las etiquetas del hogar. */
export function TagManager({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { tags, txTags, transactions, household, me, supabase, reload } = useFinance();
  const usage = useMemo(() => tagUsage(transactions, txTags), [transactions, txTags]);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setError((error as { code?: string }).code === "23505" ? "Ya hay una etiqueta con ese nombre." : errMsg(error));
      return false;
    }
    void reload();
    return true;
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    if (findTagByName(tags, name)) return setError("Ya hay una etiqueta con ese nombre.");
    if (await run(() => supabase.from("tags").insert({ household_id: household.id, name, created_by: me.user_id, color: TAG_COLORS[tags.length % TAG_COLORS.length] }))) setNewName("");
  }

  async function rename(id: string) {
    const name = draft.trim();
    if (!name) return setError("Escribe un nombre.");
    const clash = findTagByName(tags, name);
    if (clash && clash.id !== id && tagKey(clash.name) === tagKey(name)) return setError("Ya hay una etiqueta con ese nombre.");
    if (await run(() => supabase.from("tags").update({ name }).eq("id", id))) setEditing(null);
  }

  async function remove(id: string, name: string) {
    const n = usage.get(id) ?? 0;
    if (!confirm(`¿Borrar la etiqueta “${name}”? ${n > 0 ? `Se quita de ${n} movimiento${n === 1 ? "" : "s"}; los movimientos se quedan.` : ""}`)) return;
    await run(() => supabase.from("tags").delete().eq("id", id));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Etiquetas" description="Las ven y las editan los dos. Sirven para filtrar movimientos y para los informes.">
      <div className="space-y-4 pb-2">
        <div className="flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} placeholder="Nueva etiqueta" aria-label="Nueva etiqueta"
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
          <Button onClick={create} disabled={busy || !newName.trim()}><Plus size={16} /> Crear</Button>
        </div>
        <ErrorText>{error}</ErrorText>

        {tags.length === 0 ? (
          <p className="text-sm text-muted">Aún no hay etiquetas. Crea la primera, por ejemplo “Viaje”, “Regalos” o “Reparaciones”, y úsala al registrar o editar un movimiento.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {tags.map((t) => (
              <li key={t.id} className="space-y-2 px-3 py-2.5">
                {editing === t.id ? (
                  <div className="flex items-center gap-2">
                    <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} autoFocus aria-label="Nombre de la etiqueta"
                      onKeyDown={(e) => { if (e.key === "Enter") void rename(t.id); if (e.key === "Escape") setEditing(null); }} />
                    <Button size="icon" onClick={() => rename(t.id)} disabled={busy} aria-label="Guardar nombre"><Check size={18} /></Button>
                    <Button size="icon" variant="outline" onClick={() => setEditing(null)} aria-label="Cancelar"><X size={18} /></Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color ?? "var(--muted)" }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="block text-xs text-muted">{usage.get(t.id) ?? 0} movimiento{(usage.get(t.id) ?? 0) === 1 ? "" : "s"}</span>
                    </span>
                    <button className="p-2 text-muted" onClick={() => { setEditing(t.id); setDraft(t.name); setError(null); }} aria-label={`Renombrar ${t.name}`}><Pencil size={16} /></button>
                    <button className="p-2 text-muted" onClick={() => remove(t.id, t.name)} aria-label={`Borrar ${t.name}`}><Trash2 size={16} /></button>
                  </div>
                )}
                <div className="flex gap-1.5" role="group" aria-label={`Color de ${t.name}`}>
                  {TAG_COLORS.map((c) => (
                    <button key={c} onClick={() => run(() => supabase.from("tags").update({ color: c }).eq("id", t.id))} aria-label={`Color ${c}`}
                      className={cn("h-5 w-5 rounded-full border-2", t.color === c ? "border-text" : "border-transparent")} style={{ background: c }} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Solo cuentan los movimientos que tú puedes ver. Si una etiqueta se usa en cosas personales de tu pareja, esos no los ves.</p>
      </div>
    </Sheet>
  );
}
