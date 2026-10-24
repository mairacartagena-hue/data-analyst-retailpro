"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { CategoryOptions } from "@/components/CategoryPicker";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import type { MerchantMemory } from "@/lib/types";
import { applyChange, memoryChange, memoryMatches, memoryValues } from "@/lib/finance/memoryApply";
import { errMsg } from "@/lib/utils";

/** Cómo se muestra el identificador de una memoria cuando no tiene nombre. */
export function memoryTitle(m: MerchantMemory): string {
  if (m.label) return m.label;
  switch (m.identifier_type) {
    case "ACCOUNT": return `Llave o cuenta ${m.identifier}`;
    case "PHONE": return `Celular ${m.identifier}`;
    case "NIT": return `NIT ${m.identifier}`;
    case "KEYWORD": return `Palabra “${m.identifier}”`;
    default: return m.identifier;
  }
}

/** Editar dónde se guarda un comercio, llave o cuenta: nombre, categoría, responsable, espacio y si se aplica solo. */
export function MemorySheet({ memory, onClose, onChanged }: { memory: MerchantMemory | null; onClose: () => void; onChanged: () => void }) {
  const { categories, me, partner, supabase, reload, transactions } = useFinance();
  const [label, setLabel] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [scope, setScope] = useState<"HOUSEHOLD" | "PERSONAL">("PERSONAL");
  const [createsDebt, setCreatesDebt] = useState(true);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!memory) return;
    setResult(null);
    setLabel(memory.label ?? "");
    setCategoryId(memory.category_id ?? "");
    setResponsibleId(memory.responsible_user_id ?? me.user_id);
    setScope(memory.scope ?? "PERSONAL");
    setCreatesDebt(memory.creates_debt);
    setAuto(memory.auto_apply);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory]);

  if (!memory) return <Sheet open={false} onOpenChange={() => {}} title="Memoria">{null}</Sheet>;
  const refund = memory.movement_kind === "REFUND";
  const people = [me, partner].filter((m): m is NonNullable<typeof m> => !!m);

  async function save() {
    if (!memory) return;
    if (auto && !categoryId) return setError("Para aplicarlo solo hace falta una categoría.");
    setBusy(true);
    setError(null);
    const after = { label: label.trim() || null, categoryId: categoryId || null, responsibleId: responsibleId || me.user_id, scope, createsDebt };
    const { error } = await supabase.from("merchant_memory").update({
      label: after.label,
      category_id: after.categoryId,
      responsible_user_id: responsibleId || null,
      scope,
      creates_debt: createsDebt,
      auto_apply: auto,
    }).eq("id", memory.id);
    if (error) {
      setBusy(false);
      return setError(errMsg(error));
    }

    // Los movimientos anteriores de este origen cambian igual, solo en lo que se editó
    const change = memoryChange(memoryValues(memory, me.user_id), after);
    const matches = transactions.filter((t) => memoryMatches(t, memory));
    let updated = 0;
    let pending = 0;
    let divided = 0;
    let failed: string | null = null;
    for (const tx of matches) {
      const r = applyChange(tx, change, memory.label, me.user_id);
      if (r.skipped === "PENDING") pending++;
      else if (r.skipped === "DIVIDED") divided++;
      if (!r.payload) continue;
      const { error } = await supabase.rpc("save_transaction", { p: r.payload });
      if (error) failed = errMsg(error);
      else updated++;
    }
    setBusy(false);
    onChanged();
    void reload();
    if (Object.keys(change).length === 0 || matches.length === 0 || (updated === 0 && !failed && pending === 0 && divided === 0)) return onClose();
    setResult([
      updated > 0 ? `Actualicé ${updated} movimiento${updated === 1 ? "" : "s"} anterior${updated === 1 ? "" : "es"}.` : "",
      pending > 0 ? `${pending} por revisar no se tocan: se resuelven al revisarlos.` : "",
      divided > 0 ? `${divided} dividido${divided === 1 ? "" : "s"} no cambian de categoría ni responsable.` : "",
      failed ? `Alguno falló: ${failed}` : "",
    ].filter(Boolean).join(" "));
  }

  async function forget() {
    if (!memory || !confirm(`¿Olvidar “${memoryTitle(memory)}”? Los movimientos que ya tienes no cambian; los nuevos llegarán sin categoría.`)) return;
    setBusy(true);
    const { error } = await supabase.from("merchant_memory").delete().eq("id", memory.id);
    setBusy(false);
    if (error) return setError(errMsg(error));
    onChanged();
    onClose();
  }

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title="Editar memoria"
      description={`${memory.identifier_type === "MERCHANT" ? "Comercio" : memory.identifier_type === "ACCOUNT" ? "Llave o cuenta" : memory.identifier_type === "PHONE" ? "Celular" : memory.identifier_type === "NIT" ? "NIT" : "Palabra"}: ${memory.identifier} · ${memory.hits} uso${memory.hits === 1 ? "" : "s"}`}>
      <div className="space-y-4 pb-2">
        <Field label="Nombre" htmlFor="mem-label">
          <Input id="mem-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Ej. Heladería, Hermano, Lady uñas" />
        </Field>
        <p className="-mt-2 text-xs text-muted">Los avisos nuevos de este origen llegarán con este nombre. Sin nombre se usa el del banco.</p>

        {refund && (
          <p className="rounded-2xl bg-wood-soft px-3 py-2 text-sm">
            Regla de reembolso: los ingresos de este origen entran como <strong>reembolso</strong> de la categoría y restan del gasto.
          </p>
        )}

        <Field label={refund ? "Reembolsa la categoría" : "Categoría"}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoría">
            <option value="">Sin categoría (preguntar)</option>
            <CategoryOptions categories={categories.filter((c) => !c.archived && c.kind !== "INCOME")} />
          </Select>
        </Field>

        <Field label="¿A cargo de quién?">
          <Select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)} aria-label="Responsable">
            {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.user_id === me.user_id ? "Yo" : p.display_name}</option>)}
          </Select>
        </Field>

        <Field label="Espacio">
          <Segmented value={scope} onChange={setScope} options={[{ value: "HOUSEHOLD", label: "Hogar" }, { value: "PERSONAL", label: "Personal" }]} />
        </Field>

        <div className="rounded-2xl border border-border bg-surface px-3">
          {!refund && responsibleId && responsibleId !== me.user_id && (
            <SwitchRow label="Anotar la deuda con mi pareja" hint="Si pagas tú y le corresponde a ella o él, queda en el cruce." checked={createsDebt} onCheckedChange={setCreatesDebt} />
          )}
          <SwitchRow label="Aplicar siempre sin preguntar" hint={refund ? "El ingreso entra solo como reembolso." : "El movimiento se confirma solo cuando llegue el aviso."} checked={auto} onCheckedChange={setAuto} />
        </div>

        {(() => {
          const n = transactions.filter((t) => t.status === "CONFIRMED" && memoryMatches(t, memory)).length;
          return n > 0 && !result ? <p className="text-xs text-muted">Al guardar, lo que cambies también se aplica a los {n} movimiento{n === 1 ? "" : "s"} anterior{n === 1 ? "" : "es"} de este origen.</p> : null;
        })()}
        <ErrorText>{error}</ErrorText>
        {result && <p className="rounded-xl bg-olive-soft px-3 py-2 text-sm">{result}</p>}
        <div className="flex gap-3">
          {!result && <Button variant="danger" size="icon" onClick={forget} disabled={busy} aria-label="Olvidar"><Trash2 size={18} /></Button>}
          {result
            ? <Button className="flex-1" size="lg" onClick={onClose}>Listo</Button>
            : <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Guardando y actualizando..." : "Guardar"}</Button>}
        </div>
      </div>
    </Sheet>
  );
}
