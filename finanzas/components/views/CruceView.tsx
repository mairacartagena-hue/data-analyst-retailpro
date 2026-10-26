"use client";

// Cruce de cuentas: quién le debe a quién, historial, préstamos/encargos y liquidación.

import { useEffect, useState } from "react";
import { HandCoins, Trash2, Undo2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { MemberBadge } from "@/components/MemberBadge";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import type { LedgerRow } from "@/lib/types";
import { openDebtsInFavor, type OpenDebt } from "@/lib/finance/crossLedger";
import { ChipGroup } from "@/components/ui/segmented";
import { accountLabel } from "@/lib/finance/labels";
import { crossNet } from "@/lib/finance/derive";
import { formatCop, parseCop } from "@/lib/finance/money";
import { formatDay, todayBogota } from "@/lib/finance/periods";
import { cn, errMsg } from "@/lib/utils";

const KIND_LABEL: Record<LedgerRow["kind"], string> = {
  CROSS_PAYMENT: "Pago cruzado",
  SPLIT: "Compra dividida",
  FIXED_EXCESS: "Excedente de monto fijo",
  LOAN: "Préstamo",
  ERRAND: "Encargo",
  SETTLEMENT: "Liquidación",
  REFUND: "Reembolso de su parte",
  PAYMENT: "Pago recibido",
  FORGIVEN: "Deuda condonada",
};

export function CruceView() {
  const state = useFinance();
  const { ledger, me, partner, memberById, supabase, reload, transactions } = state;
  const { openSettle, openTransaction } = useShell();
  const [addOpen, setAddOpen] = useState(false);
  const [resolving, setResolving] = useState<{ debt: OpenDebt; mode: "PAID" | "FORGIVEN" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const net = crossNet(state);
  const debts = partner ? openDebtsInFavor(ledger, me.user_id) : [];

  async function remove(id: string) {
    if (!confirm("¿Borrar este asiento?")) return;
    const { error } = await supabase.rpc("delete_ledger_entry", { p_id: id });
    if (error) setError(errMsg(error));
    else void reload();
  }

  async function undoPayment(txId: string) {
    if (!confirm("¿Deshacer este pago? El dinero sale de tu cuenta y la deuda vuelve a quedar abierta.")) return;
    const { error } = await supabase.rpc("delete_transaction", { p_id: txId });
    if (error) setError(errMsg(error));
    else void reload();
  }

  return (
    <div>

      {!partner ? (
        <Card className="text-[15px]">Cuando tu pareja se una al hogar, aquí verán quién le debe a quién.</Card>
      ) : (
        <>
          <Card className="text-center">
            <div className="flex items-center justify-center gap-3">
              <MemberBadge member={me} size={40} />
              <span className="text-2xl text-muted">⇄</span>
              <MemberBadge member={partner} size={40} />
            </div>
            <p className={cn("num mt-3 font-display text-3xl", net < 0 && "text-danger")}>
              {net === 0 ? "A paz y salvo" : net < 0 ? `Le debes ${formatCop(-net)}` : `Te debe ${formatCop(net)}`}
            </p>
            {net !== 0 && (
              <p className="mt-1 text-sm text-muted">
                {net < 0 ? `a ${partner.display_name}` : `${partner.display_name} te lo debe`}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => setAddOpen(true)}><HandCoins size={18} /> Préstamo o encargo</Button>
              <Button onClick={openSettle} disabled={net >= 0}>Liquidar</Button>
            </div>
            {net > 0 && <p className="mt-2 text-xs text-muted">La liquidación la registra quien paga.</p>}
          </Card>

          <ErrorText>{error}</ErrorText>

          {debts.length > 0 && (
            <>
              <SectionTitle>Deudas a tu favor</SectionTitle>
              <div className="space-y-2.5">
                {debts.map((d) => <DebtRow key={d.id} debt={d} partnerName={partner.display_name} onResolve={(mode) => setResolving({ debt: d, mode })} />)}
              </div>
              <p className="mt-2 px-1 text-xs text-muted">
                Cada deuda se resuelve de dos formas: <strong>cobrar</strong> (entra la plata a tu cuenta) o <strong>condonar</strong> (solo se quita del cruce, sin mover plata).
              </p>
            </>
          )}

          <SectionTitle>Historial</SectionTitle>
          {ledger.length === 0 ? (
            <p className="px-1 text-sm text-muted">Aún no hay asientos. Se crean solos cuando uno paga algo que le correspondía al otro.</p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {ledger.map((l) => {
                const inFavor = l.creditor_user_id === me.user_id;
                const tx = l.transaction_id ? transactions.find((t) => t.id === l.transaction_id) : null;
                const deletable = (l.kind === "LOAN" || l.kind === "ERRAND" || l.kind === "FORGIVEN") && l.created_by === me.user_id;
                const payment = l.kind === "PAYMENT" && l.created_by === me.user_id && !!l.transaction_id;
                return (
                  <div key={l.id} className="flex items-center gap-3 px-3.5 py-3">
                    <MemberBadge member={memberById(l.creditor_user_id)} size={28} />
                    <button className="min-w-0 flex-1 text-left" disabled={!tx} onClick={() => tx && openTransaction(tx)}>
                      <span className="block truncate font-medium">{l.description || KIND_LABEL[l.kind]}</span>
                      <span className="block text-xs text-muted">
                        {KIND_LABEL[l.kind]} · {formatDay(l.occurred_on)} ·{" "}
                        {l.kind === "SETTLEMENT" || l.kind === "PAYMENT"
                          ? `${memberById(l.creditor_user_id)?.display_name} pagó`
                          : l.kind === "FORGIVEN"
                          ? `${memberById(l.debtor_user_id)?.display_name} le condonó la deuda`
                          : `${memberById(l.debtor_user_id)?.display_name} le debe a ${memberById(l.creditor_user_id)?.display_name}`}
                      </span>
                    </button>
                    <span className={cn("num shrink-0 font-semibold", inFavor ? "text-olive" : "text-danger")}>
                      {inFavor ? "+" : "−"}{formatCop(l.amount)}
                    </span>
                    {deletable && (
                      <button className="p-1 text-muted" onClick={() => remove(l.id)} aria-label={l.kind === "FORGIVEN" ? "Deshacer el perdón" : "Borrar asiento"}>
                        {l.kind === "FORGIVEN" ? <Undo2 size={16} /> : <Trash2 size={16} />}
                      </button>
                    )}
                    {payment && (
                      <button className="p-1 text-muted" onClick={() => undoPayment(l.transaction_id!)} aria-label="Deshacer el pago"><Undo2 size={16} /></button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2 px-1 text-xs text-muted">Verde: a tu favor. Rojo: lo debes tú. Los asientos de compras se corrigen editando el movimiento.</p>
        </>
      )}

      <LedgerEntrySheet open={addOpen} onOpenChange={setAddOpen} />
      <ResolveDebtSheet resolving={resolving} onClose={() => setResolving(null)} maxTotal={Math.max(0, net)} />
    </div>
  );
}

/** Una deuda a mi favor con su interruptor: cobrar / condonar. */
function DebtRow({ debt, partnerName, onResolve }: { debt: OpenDebt; partnerName: string; onResolve: (mode: "PAID" | "FORGIVEN") => void }) {
  const [mode, setMode] = useState<"PAID" | "FORGIVEN">("PAID");
  return (
    <Card className="space-y-3 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{debt.description || KIND_LABEL[debt.kind]}</p>
          <p className="text-xs text-muted">{KIND_LABEL[debt.kind]} · {formatDay(debt.occurredOn)}{debt.remaining < debt.original ? ` · de ${formatCop(debt.original)}` : ""}</p>
        </div>
        <p className="num shrink-0 font-display text-xl text-olive">{formatCop(debt.remaining)}</p>
      </div>
      <Segmented value={mode} onChange={setMode} options={[{ value: "PAID", label: "Cobrar" }, { value: "FORGIVEN", label: "Condonar" }]} />
      <Button size="sm" className="w-full" variant={mode === "FORGIVEN" ? "outline" : "primary"} onClick={() => onResolve(mode)}>
        {mode === "PAID" ? "Cobrar" : "Condonar"}
      </Button>
    </Card>
  );
}

function ResolveDebtSheet({ resolving, onClose, maxTotal }: { resolving: { debt: OpenDebt; mode: "PAID" | "FORGIVEN" } | null; onClose: () => void; maxTotal: number }) {
  const { me, partner, accounts, labels, supabase, reload } = useFinance();
  const [mode, setMode] = useState<"PAID" | "FORGIVEN">("PAID");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(todayBogota());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const myAccounts = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived && !["CREDIT_CARD", "LOAN"].includes(a.kind));

  useEffect(() => {
    if (!resolving) return;
    setMode(resolving.mode);
    setAmount(String(Math.min(resolving.debt.remaining, maxTotal)));
    setAccount(myAccounts[0]?.id ?? "");
    setDate(todayBogota());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolving]);

  if (!resolving || !partner) return null;
  const debt = resolving.debt;
  const n = parseCop(amount) ?? 0;

  async function save() {
    if (n <= 0) return setError("Escribe el monto.");
    if (n > debt.remaining) return setError(`Esta deuda es de ${formatCop(debt.remaining)}.`);
    if (mode === "PAID" && !account) return setError("Elige en qué cuenta entró el pago.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("resolve_debt", {
      p: {
        mode, amount: n, occurred_on: date, entry_id: debt.id,
        account_id: mode === "PAID" ? account : null,
        note: mode === "PAID" ? `Pago de ${partner!.display_name}${debt.description ? `: ${debt.description}` : ""}` : `Condonada${debt.description ? `: ${debt.description}` : ""}`,
      },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onClose();
    void reload();
  }

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={mode === "PAID" ? "Cobrar la deuda" : "Condonar la deuda"}
      description={`${debt.description || KIND_LABEL[debt.kind]} · ${formatCop(debt.remaining)} pendientes`}>
      <div className="space-y-4 pb-2">
        <Segmented value={mode} onChange={setMode} options={[{ value: "PAID", label: "Cobrar" }, { value: "FORGIVEN", label: "Condonar" }]} />
        <AmountInput large value={amount} onChange={setAmount} />
        <p className="-mt-2 text-xs text-muted">Puedes resolver solo una parte; el resto queda pendiente.</p>
        {mode === "PAID" ? (
          <>
            <Field label="Entró a">
              <ChipGroup value={account} onChange={setAccount} options={myAccounts.map((a) => ({ value: a.id, label: accountLabel(labels, a.id) }))} />
            </Field>
            <p className="rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">Sube el saldo de tu cuenta y baja la deuda. No cuenta como ingreso del hogar.</p>
          </>
        ) : (
          <p className="rounded-2xl bg-wood-soft px-3 py-2 text-sm">Solo se quita del cruce: no se mueve plata. {partner.display_name} lo verá en el historial como deuda condonada. Si te arrepientes, puedes deshacerlo desde el historial.</p>
        )}
        <Field label="Fecha" htmlFor="resolve-date"><Input id="resolve-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <ErrorText>{error}</ErrorText>
        <Button size="lg" className="w-full" disabled={busy} onClick={save}>
          {busy ? "Guardando..." : mode === "PAID" ? `Cobrar ${formatCop(n)}` : `Condonar ${formatCop(n)}`}
        </Button>
      </div>
    </Sheet>
  );
}

function LedgerEntrySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { me, partner, supabase, reload } = useFinance();
  const [kind, setKind] = useState<"LOAN" | "ERRAND">("LOAN");
  const [direction, setDirection] = useState<"they_owe" | "i_owe">("they_owe");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayBogota());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!partner) return null;

  async function save() {
    const n = parseCop(amount) ?? 0;
    if (n <= 0) return setError("Escribe el monto.");
    setBusy(true);
    setError(null);
    const theyOwe = direction === "they_owe";
    const { error } = await supabase.rpc("add_ledger_entry", {
      p_kind: kind,
      p_creditor: theyOwe ? me.user_id : partner!.user_id,
      p_debtor: theyOwe ? partner!.user_id : me.user_id,
      p_amount: n,
      p_description: description,
      p_occurred_on: date,
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    setAmount("");
    setDescription("");
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Préstamo o encargo">
      <div className="space-y-4 pb-2">
        <Segmented value={kind} onChange={setKind} options={[{ value: "LOAN", label: "Préstamo" }, { value: "ERRAND", label: "Encargo" }]} />
        <Segmented value={direction} onChange={setDirection} options={[
          { value: "they_owe", label: `${partner.display_name} me debe` },
          { value: "i_owe", label: `Le debo a ${partner.display_name}` },
        ]} />
        <AmountInput large value={amount} onChange={setAmount} />
        <Field label="Concepto" htmlFor="ledger-desc">
          <Input id="ledger-desc" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={kind === "LOAN" ? "Te presté para…" : "Me trajiste… / te compré…"} />
        </Field>
        <Field label="Fecha" htmlFor="ledger-date"><Input id="ledger-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <ErrorText>{error}</ErrorText>
        <Button size="lg" className="w-full" disabled={busy} onClick={save}>{busy ? "Guardando..." : "Guardar"}</Button>
      </div>
    </Sheet>
  );
}
