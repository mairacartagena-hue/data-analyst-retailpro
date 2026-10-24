"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import type { ScheduledPayment, Space } from "@/lib/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { ChipGroup, Segmented } from "@/components/ui/segmented";
import { SwitchRow } from "@/components/ui/switch";
import { AmountInput } from "@/components/AmountInput";
import { CategoryOptions } from "@/components/CategoryPicker";
import { parseCop } from "@/lib/finance/money";
import { todayBogota } from "@/lib/finance/periods";
import { errMsg } from "@/lib/utils";

/** Crear o editar un compromiso: un pago previsto (una vez o cada mes). */
export function CommitmentSheet({ open, onOpenChange, payment }: { open: boolean; onOpenChange: (v: boolean) => void; payment: ScheduledPayment | null }) {
  const { categories, supabase, reload, me, partner, household } = useFinance();
  const [scope, setScope] = useState<Space>("HOUSEHOLD");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ScheduledPayment["kind"]>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [frequency, setFrequency] = useState<ScheduledPayment["frequency"]>("MONTHLY");
  const [day, setDay] = useState("1");
  const [dueDate, setDueDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const p = payment;
    setScope(p?.scope ?? "HOUSEHOLD");
    setName(p?.name ?? "");
    setKind(p?.kind ?? "EXPENSE");
    setAmount(p ? String(p.amount) : "");
    setCategoryId(p?.category_id ?? "");
    setResponsible(p?.responsible_user_id ?? "");
    setFrequency(p?.frequency ?? "MONTHLY");
    setDay(String(p?.day_of_month ?? 1));
    setDueDate(p?.due_date ?? todayBogota());
    setStart(p?.start_date ?? todayBogota());
    setEnd(p?.end_date ?? "");
    setActive(p?.active ?? true);
  }, [open, payment]);

  const usable = categories.filter((c) => !c.archived && c.kind !== "INCOME"
    && (c.responsibility !== "PRIVATE" || (scope === "PERSONAL" && c.owner_user_id === me.user_id)));
  const canMakePersonal = !payment || payment.owner_user_id === me.user_id;

  async function save() {
    setError(null);
    const n = parseCop(amount) ?? 0;
    if (!name.trim()) return setError("Ponle un nombre.");
    if (n <= 0) return setError("Escribe el monto.");
    const d = Number(day);
    if (frequency === "MONTHLY" && (!Number.isInteger(d) || d < 1 || d > 31)) return setError("El día va de 1 a 31.");
    if (frequency === "ONCE" && !dueDate) return setError("Elige la fecha.");
    const row = {
      scope,
      name: name.trim(),
      kind,
      amount: n,
      category_id: categoryId || null,
      responsible_user_id: responsible || null,
      frequency,
      day_of_month: frequency === "MONTHLY" ? d : null,
      due_date: frequency === "ONCE" ? dueDate : null,
      start_date: start || todayBogota(),
      end_date: end || null,
      active,
    };
    setBusy(true);
    const { error } = payment
      ? await supabase.from("scheduled_payments").update(row).eq("id", payment.id)
      : await supabase.from("scheduled_payments").insert({ ...row, household_id: household.id, owner_user_id: me.user_id });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  async function remove() {
    if (!payment || !confirm("¿Borrar este compromiso? Los pagos ya registrados se conservan.")) return;
    setBusy(true);
    const { error } = await supabase.from("scheduled_payments").delete().eq("id", payment.id);
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  const members = [me, partner].filter(Boolean).map((m) => ({ value: m!.user_id, label: m!.user_id === me.user_id ? "Yo" : m!.display_name, color: m!.color }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={payment ? "Editar compromiso" : "Nuevo compromiso"}
      description="Un pago previsto: cuenta como comprometido hasta que registres el pago real.">
      <div className="space-y-4 pb-2">
        <Field label="¿De qué espacio?">
          <Segmented value={scope} onChange={(v) => { if (v === "HOUSEHOLD" || canMakePersonal) setScope(v); }} options={[
            { value: "HOUSEHOLD", label: "Hogar" },
            { value: "PERSONAL", label: "Personal" },
          ]} />
        </Field>
        <Field label="Nombre" htmlFor="sp-name">
          <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Cuota hipoteca, administración, seguro…" />
        </Field>
        <Segmented value={kind} onChange={setKind} options={[
          { value: "EXPENSE", label: "Gasto" },
          { value: "DEBT_PAYMENT", label: "Pago de deuda" },
        ]} />
        <Field label="Monto"><AmountInput value={amount} onChange={setAmount} /></Field>
        <Field label="Categoría" hint="Con categoría, cuenta como comprometido en los presupuestos que la incluyen.">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sin categoría</option>
            <CategoryOptions categories={usable} />
          </Select>
        </Field>
        {partner && (
          <Field label="¿A quién le corresponde? (opcional)">
            <ChipGroup value={responsible} onChange={(v) => setResponsible(v === responsible ? "" : v)} options={members} />
          </Field>
        )}
        <Field label="¿Cada cuánto?">
          <Segmented value={frequency} onChange={setFrequency} options={[
            { value: "MONTHLY", label: "Cada mes" },
            { value: "ONCE", label: "Una vez" },
          ]} />
        </Field>
        {frequency === "MONTHLY" ? (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Día"><Input type="number" inputMode="numeric" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
            <Field label="Desde"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Hasta"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
        ) : (
          <Field label="Fecha"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        )}
        {payment && <SwitchRow label="Activo" hint="Si lo desactivas, deja de aparecer en los vencimientos." checked={active} onCheckedChange={setActive} />}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          {payment && (
            <Button variant="danger" size="icon" onClick={remove} disabled={busy} aria-label="Borrar">
              <Trash2 size={18} />
            </Button>
          )}
          <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</Button>
        </div>
      </div>
    </Sheet>
  );
}
