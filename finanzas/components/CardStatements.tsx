"use client";

// Extractos de la tarjeta (corte por corte): pago mínimo, pago total y deuda total, leídos del PDF o escritos a mano.
// Cada uno se cruza con la app: la cuota proyectada para su fecha de pago contra el pago mínimo, y la deuda de la
// app al corte contra la deuda del extracto.

import { useState } from "react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { ErrorText, Field, Input } from "@/components/ui/input";
import type { Account, CardStatement } from "@/lib/types";
import { checkStatement, squares } from "@/lib/finance/cardStatements";
import { formatCop, parseCop } from "@/lib/finance/money";
import { formatDay } from "@/lib/finance/periods";
import { cn, errMsg } from "@/lib/utils";

export interface StatementDraft {
  cut: string;
  due: string;
  minimum: string;
  total: string;
  debt: string;
}

export const emptyDraft: StatementDraft = { cut: "", due: "", minimum: "", total: "", debt: "" };

export function draftOf(st: Pick<CardStatement, "cut_date" | "due_date" | "minimum_payment" | "total_payment" | "total_debt">): StatementDraft {
  const s = (v: number | null) => (v === null ? "" : String(Math.round(v)));
  return { cut: st.cut_date, due: st.due_date ?? "", minimum: s(st.minimum_payment), total: s(st.total_payment), debt: s(st.total_debt) };
}

/** Campos del extracto, editables. */
export function StatementFields({ value, onChange }: { value: StatementDraft; onChange: (v: StatementDraft) => void }) {
  const set = (k: keyof StatementDraft) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Fecha de corte"><Input type="date" value={value.cut} onChange={(e) => set("cut")(e.target.value)} /></Field>
      <Field label="Fecha de pago"><Input type="date" value={value.due} onChange={(e) => set("due")(e.target.value)} /></Field>
      <Field label="Pago mínimo"><AmountInput value={value.minimum} onChange={set("minimum")} /></Field>
      <Field label="Pago total"><AmountInput value={value.total} onChange={set("total")} /></Field>
      <div className="col-span-2"><Field label="Deuda total del extracto"><AmountInput value={value.debt} onChange={set("debt")} /></Field></div>
    </div>
  );
}

/** Guarda (o reemplaza, por fecha de corte) un extracto. Devuelve el error o null. */
export async function saveStatement(
  supabase: ReturnType<typeof useFinance>["supabase"],
  account: Pick<Account, "id" | "household_id">,
  ownerId: string,
  d: StatementDraft,
  source: "PDF" | "MANUAL",
): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.cut)) return "Escribe la fecha de corte.";
  if (d.due && d.due < d.cut) return "La fecha de pago va después del corte.";
  const { error } = await supabase.from("card_statements").upsert({
    account_id: account.id, household_id: account.household_id, owner_user_id: ownerId, cut_date: d.cut, due_date: d.due || null,
    minimum_payment: parseCop(d.minimum), total_payment: parseCop(d.total), total_debt: parseCop(d.debt), source,
    updated_at: new Date().toISOString(),
  }, { onConflict: "account_id,cut_date" });
  return error ? errMsg(error) : null;
}

function Diff({ label, diff, okText }: { label: string; diff: number | null; okText: string }) {
  if (diff === null) return null;
  const ok = squares(diff);
  return (
    <p className={cn("rounded-lg px-2 py-1", ok ? "bg-olive-soft" : "bg-warning-soft")}>
      {label}: {ok ? okText : diff > 0 ? `la app tiene ${formatCop(diff)} más` : `la app tiene ${formatCop(-diff)} menos`}
    </p>
  );
}

export function StatementRow({ account, st }: { account: Account; st: CardStatement }) {
  const { transactions, cardItems, supabase, reload, me } = useFinance();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StatementDraft>(draftOf(st));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = checkStatement(account, transactions, cardItems, st);

  async function save() {
    setBusy(true);
    setErr(null);
    // Si cambió la fecha de corte se guarda como otro extracto: el anterior se borra
    const e = await saveStatement(supabase, account, me.user_id, draft, "MANUAL");
    if (!e && draft.cut !== st.cut_date) await supabase.from("card_statements").delete().eq("id", st.id);
    setBusy(false);
    if (e) return setErr(e);
    setEditing(false);
    void reload();
  }

  async function remove() {
    if (!confirm("¿Borrar este extracto? No cambia la deuda ni las compras de la tarjeta.")) return;
    await supabase.from("card_statements").delete().eq("id", st.id);
    void reload();
  }

  return (
    <div className="space-y-1.5 px-3.5 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Corte {formatDay(st.cut_date)}{st.due_date ? <span className="text-muted"> · pago {formatDay(st.due_date)}</span> : null}</span>
        <span className="text-xs text-muted">{st.source === "PDF" ? "del PDF" : "a mano"}</span>
      </div>
      {editing ? (
        <div className="space-y-2">
          <StatementFields value={draft} onChange={setDraft} />
          <ErrorText>{err}</ErrorText>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy}>Guardar</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(draftOf(st)); }}>Cancelar</Button>
            <button className="ml-auto text-xs text-danger underline" onClick={() => void remove()}>Borrar</button>
          </div>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted">Pago mínimo</dt><dd className="num text-right">{st.minimum_payment !== null ? formatCop(st.minimum_payment) : "—"}</dd>
            <dt className="text-muted">Cuota según la app</dt><dd className="num text-right">{c.projected !== null ? formatCop(c.projected) : "—"}</dd>
            <dt className="text-muted">Pago total</dt><dd className="num text-right">{st.total_payment !== null ? formatCop(st.total_payment) : "—"}</dd>
            <dt className="text-muted">Deuda del extracto</dt><dd className="num text-right">{st.total_debt !== null ? formatCop(st.total_debt) : "—"}</dd>
            <dt className="text-muted">Deuda según la app al corte</dt><dd className="num text-right">{formatCop(c.appDebt)}</dd>
          </dl>
          <div className="space-y-1 text-xs">
            <Diff label="Cuota del mes vs. pago mínimo" diff={c.minimumDiff} okText="cuadra" />
            <Diff label="Deuda vs. extracto" diff={c.debtDiff} okText="cuadra" />
          </div>
          <button className="text-xs text-olive underline" onClick={() => setEditing(true)}>Corregir valores</button>
        </>
      )}
    </div>
  );
}

/** Lista de extractos de la tarjeta, con el cruce y la opción de escribirlos o corregirlos a mano. */
export function CardStatementsSection({ account }: { account: Account }) {
  const { cardStatements, supabase, reload, me } = useFinance();
  const mine = cardStatements.filter((s) => s.account_id === account.id);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<StatementDraft>(emptyDraft);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = mine[0];
  const lastCheck = useLastCheck(account, last);

  async function add() {
    setBusy(true);
    setErr(null);
    const e = await saveStatement(supabase, account, me.user_id, draft, "MANUAL");
    setBusy(false);
    if (e) return setErr(e);
    setAdding(false);
    setDraft(emptyDraft);
    void reload();
  }

  const summary = !last ? "sin extractos"
    : lastCheck && (lastCheck.minimumDiff !== null || lastCheck.debtDiff !== null)
      ? (squares(lastCheck.minimumDiff ?? 0) && squares(lastCheck.debtDiff ?? 0) ? "cuadra" : "con diferencia")
      : `corte ${formatDay(last.cut_date)}`;

  return (
    <Collapsible title="Extractos y cruce con la app" summary={summary}>
      <p className="text-xs text-muted">
        La cuota que proyecta la app para cada fecha de pago se compara con el pago mínimo, y la deuda de la app al corte con la deuda total del extracto.
        Se llenan al cargar el PDF y puedes corregirlos o escribirlos a mano.
      </p>
      {mine.length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {mine.map((s) => <StatementRow key={`${s.id}-${s.cut_date}`} account={account} st={s} />)}
        </div>
      )}
      {adding ? (
        <div className="space-y-2 rounded-2xl border border-border p-3">
          <StatementFields value={draft} onChange={setDraft} />
          <ErrorText>{err}</ErrorText>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void add()} disabled={busy}>Guardar extracto</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>+ Escribir un extracto a mano</Button>
      )}
    </Collapsible>
  );
}

function useLastCheck(account: Account, st: CardStatement | undefined) {
  const { transactions, cardItems } = useFinance();
  return st ? checkStatement(account, transactions, cardItems, st) : null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Día `day` del mes AAAA-MM (si el mes es más corto, el último día). */
function dayIn(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${pad2(Math.min(day, last))}`;
}

/**
 * Cierre del mes de una tarjeta: el extracto cuyo corte cae en ese mes, con su cruce (cuota vs. pago mínimo y deuda vs.
 * extracto). Si aún no está, se escribe a mano (o se llena al cargar el PDF arriba).
 */
export function CardCloseCheck({ account, month }: { account: Account; month: string }) {
  const { cardStatements, supabase, reload, me } = useFinance();
  const st = cardStatements.find((s) => s.account_id === account.id && s.cut_date.slice(0, 7) === month);
  const cut = account.statement_day ? dayIn(month, account.statement_day) : "";
  const due = (() => {
    if (!cut || !account.due_day) return "";
    let d = dayIn(month, account.due_day);
    if (d <= cut) {
      const [y, m] = month.split("-").map(Number);
      d = dayIn(m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`, account.due_day);
    }
    return d;
  })();
  const [draft, setDraft] = useState<StatementDraft>({ ...emptyDraft, cut, due });
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setErr(null);
    const e = await saveStatement(supabase, account, me.user_id, draft, "MANUAL");
    setBusy(false);
    if (e) return setErr(e);
    setOpen(false);
    void reload();
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted">Extracto del mes y cruce con la app</p>
      {st ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <StatementRow account={account} st={st} />
        </div>
      ) : open ? (
        <div className="space-y-2 rounded-2xl border border-border p-3">
          <StatementFields value={draft} onChange={setDraft} />
          <ErrorText>{err}</ErrorText>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void add()} disabled={busy}>Guardar extracto</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted">
            Carga el PDF arriba o escribe el pago mínimo, el pago total y la deuda del extracto{cut ? ` del corte del ${formatDay(cut)}` : ""}: la app los cruza con su cuota del mes y su deuda.
          </p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Escribir el extracto a mano</Button>
        </>
      )}
    </div>
  );
}
