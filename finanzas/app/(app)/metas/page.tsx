"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Home, Lock, Minus, Plus, Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { AmountInput } from "@/components/AmountInput";
import { MemberBadge } from "@/components/MemberBadge";
import type { SavingsGoal, Space } from "@/lib/types";
import { goalProgress } from "@/lib/finance/goals";
import { formatCop, parseCop } from "@/lib/finance/money";
import { formatDay, todayBogota } from "@/lib/finance/periods";
import { accountLabel } from "@/lib/finance/labels";
import { cn, errMsg } from "@/lib/utils";

export default function MetasPage() {
  const { goals, contributions } = useFinance();
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SavingsGoal | null>(null);
  const today = todayBogota();

  const activeGoals = goals.filter((g) => g.status === "ACTIVE");
  const doneGoals = goals.filter((g) => g.status !== "ACTIVE");
  const edit = (g: SavingsGoal | null) => { setEditing(g); setOpen(true); };

  const card = (g: SavingsGoal) => {
    const p = goalProgress(g, contributions, today);
    return (
      <button key={g.id} onClick={() => setDetail(g)} className="w-full rounded-2xl border border-border bg-surface p-3.5 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-lg">{g.icon || "🎯"}</span>
            <span className="truncate font-semibold">{g.name}</span>
            {g.scope === "HOUSEHOLD" ? <Home size={14} className="shrink-0 text-muted" /> : <Lock size={14} className="shrink-0 text-muted" />}
          </span>
          <span className="num shrink-0 text-sm font-semibold">{Math.round(p.ratio * 100)} %</span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-olive" style={{ width: `${p.ratio * 100}%` }} />
        </div>
        <p className="num mt-2 text-sm text-muted">{formatCop(p.saved)} de {formatCop(g.target_amount)}</p>
        <p className="text-xs text-muted">
          {g.target_date ? `Meta: ${formatDay(g.target_date)} ${g.target_date.slice(0, 4)}` : "Sin fecha"}
          {p.neededPerMonth ? ` · hace falta ${formatCop(p.neededPerMonth)} al mes` : ""}
          {g.planned_amount ? ` · aporte previsto ${formatCop(g.planned_amount)} por periodo` : ""}
        </p>
      </button>
    );
  };

  return (
    <main className="px-4 pb-6 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <Link href="/mas" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
          <h1 className="font-display text-3xl">Metas de ahorro</h1>
        </div>
        <Button size="sm" onClick={() => edit(null)}><Plus size={16} /> Nueva</Button>
      </div>
      <p className="px-1 text-sm text-muted">
        Las del hogar las ven los dos y ambos pueden aportar; las personales solo tú. El aporte previsto se aparta de tu Saldo Seguro mientras falte.
      </p>

      {activeGoals.length === 0 ? (
        <Card className="mt-4 space-y-2 text-center">
          <p className="text-[15px]">Fondo de emergencia, viaje, cuota inicial…</p>
          <Button onClick={() => edit(null)}><Plus size={16} /> Crear la primera</Button>
        </Card>
      ) : (
        <div className="mt-4 space-y-2.5">{activeGoals.map(card)}</div>
      )}

      {doneGoals.length > 0 && (
        <>
          <SectionTitle>Cumplidas o archivadas</SectionTitle>
          <div className="space-y-2.5 opacity-75">{doneGoals.map(card)}</div>
        </>
      )}

      <GoalSheet open={open} onOpenChange={setOpen} goal={editing} />
      <GoalDetail goal={detail} onClose={() => setDetail(null)} onEdit={(g) => { setDetail(null); edit(g); }} />
    </main>
  );
}

function GoalSheet({ open, onOpenChange, goal }: { open: boolean; onOpenChange: (v: boolean) => void; goal: SavingsGoal | null }) {
  const { supabase, reload, me, household, accounts, labels } = useFinance();
  const [scope, setScope] = useState<Space>("HOUSEHOLD");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [planned, setPlanned] = useState("");
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState<SavingsGoal["status"]>("ACTIVE");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setScope(goal?.scope ?? "HOUSEHOLD");
    setName(goal?.name ?? "");
    setIcon(goal?.icon ?? "");
    setTarget(goal ? String(goal.target_amount) : "");
    setDate(goal?.target_date ?? "");
    setPlanned(goal?.planned_amount ? String(goal.planned_amount) : "");
    setAccountId(goal?.account_id ?? "");
    setStatus(goal?.status ?? "ACTIVE");
  }, [open, goal]);

  const mine = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived);
  const canMakePersonal = !goal || goal.owner_user_id === me.user_id;

  async function save() {
    setError(null);
    const t = parseCop(target) ?? 0;
    if (!name.trim()) return setError("Ponle un nombre.");
    if (t <= 0) return setError("Escribe cuánto quieres ahorrar.");
    const row = {
      scope, name: name.trim(), icon: icon || null, target_amount: t, target_date: date || null,
      planned_amount: parseCop(planned) || null, account_id: accountId || null, status,
    };
    setBusy(true);
    const { error } = goal
      ? await supabase.from("savings_goals").update(row).eq("id", goal.id)
      : await supabase.from("savings_goals").insert({ ...row, household_id: household.id, owner_user_id: me.user_id });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  async function remove() {
    if (!goal || !confirm("¿Borrar esta meta y sus aportes?")) return;
    setBusy(true);
    const { error } = await supabase.from("savings_goals").delete().eq("id", goal.id);
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={goal ? "Editar meta" : "Nueva meta"}
      footer={<div className="space-y-2"><ErrorText>{error}</ErrorText><div className="flex gap-3">
          {goal && (
            <Button variant="danger" size="icon" onClick={remove} disabled={busy} aria-label="Borrar"><Trash2 size={18} /></Button>
          )}
          <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</Button>
        </div></div>}>
      <div className="space-y-4 pb-2">
        <Field label="¿De qué espacio?">
          <Segmented value={scope} onChange={(v) => { if (v === "HOUSEHOLD" || canMakePersonal) setScope(v); }} options={[
            { value: "HOUSEHOLD", label: "Hogar" },
            { value: "PERSONAL", label: "Personal" },
          ]} />
        </Field>
        <div className="grid grid-cols-[72px_1fr] gap-3">
          <Field label="Ícono"><Input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} className="text-center text-xl" placeholder="🎯" /></Field>
          <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Fondo de emergencia, viaje…" /></Field>
        </div>
        <Field label="¿Cuánto quieres ahorrar?"><AmountInput value={target} onChange={setTarget} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha objetivo (opcional)"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Aporte por periodo"><AmountInput value={planned} onChange={setPlanned} /></Field>
        </div>
        {(!goal || goal.owner_user_id === me.user_id) && (
          <Field label="¿Dónde se guarda? (opcional)">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Sin cuenta</option>
              {mine.map((a) => <option key={a.id} value={a.id}>{accountLabel(labels, a.id)}</option>)}
            </Select>
          </Field>
        )}
        {goal && (
          <Field label="Estado">
            <Select value={status} onChange={(e) => setStatus(e.target.value as SavingsGoal["status"])}>
              <option value="ACTIVE">Activa</option>
              <option value="DONE">Cumplida</option>
              <option value="ARCHIVED">Archivada</option>
            </Select>
          </Field>
        )}
      </div>
    </Sheet>
  );
}

function GoalDetail({ goal, onClose, onEdit }: { goal: SavingsGoal | null; onClose: () => void; onEdit: (g: SavingsGoal) => void }) {
  const { contributions, supabase, reload, me, memberById, household } = useFinance();
  const [amount, setAmount] = useState("");
  const [withdraw, setWithdraw] = useState(false);
  const [date, setDate] = useState(todayBogota());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!goal) return null;
  const items = contributions.filter((c) => c.goal_id === goal.id);
  const p = goalProgress(goal, contributions, todayBogota());

  async function add() {
    setError(null);
    const n = parseCop(amount) ?? 0;
    if (n <= 0) return setError("Escribe el monto.");
    setBusy(true);
    const { error } = await supabase.from("savings_contributions").insert({
      goal_id: goal!.id, household_id: household.id, user_id: me.user_id,
      amount: withdraw ? -n : n, occurred_on: date, note: note.trim() || null,
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    setAmount("");
    setNote("");
    void reload();
  }

  async function removeItem(id: string) {
    const { error } = await supabase.from("savings_contributions").delete().eq("id", id);
    if (error) setError(errMsg(error));
    else void reload();
  }

  return (
    <Sheet open={!!goal} onOpenChange={(v) => !v && onClose()} title={`${goal.icon ?? "🎯"} ${goal.name}`}
      description={`${formatCop(p.saved)} de ${formatCop(goal.target_amount)} · faltan ${formatCop(p.remaining)}`}>
      <div className="space-y-4 pb-2">
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-3">
          <Segmented value={withdraw ? "OUT" : "IN"} onChange={(v) => setWithdraw(v === "OUT")} options={[
            { value: "IN", label: "Aporte" },
            { value: "OUT", label: "Retiro" },
          ]} />
          <AmountInput value={amount} onChange={setAmount} />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Nota (opcional)" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[150px]" />
          </div>
          <p className="text-xs text-muted">Registra el aporte aquí. Si además moviste la plata entre tus cuentas, regístralo como transferencia.</p>
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" onClick={add} disabled={busy}>{withdraw ? <Minus size={16} /> : <Plus size={16} />} {withdraw ? "Registrar retiro" : "Registrar aporte"}</Button>
        </div>

        {items.length > 0 && (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {items.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <MemberBadge member={memberById(c.user_id)} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.note || (c.amount < 0 ? "Retiro" : "Aporte")}</span>
                  <span className="text-xs text-muted">{formatDay(c.occurred_on)}</span>
                </span>
                <span className={cn("num text-sm font-semibold", c.amount < 0 && "text-danger")}>{c.amount < 0 ? "−" : "+"}{formatCop(Math.abs(c.amount))}</span>
                {c.user_id === me.user_id && (
                  <button aria-label="Borrar aporte" className="p-1 text-muted" onClick={() => removeItem(c.id)}><Trash2 size={15} /></button>
                )}
              </div>
            ))}
          </div>
        )}
        <Button variant="secondary" onClick={() => onEdit(goal)}>Editar meta</Button>
      </div>
    </Sheet>
  );
}
