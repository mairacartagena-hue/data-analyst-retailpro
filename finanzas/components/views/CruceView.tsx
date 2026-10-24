"use client";

// Cruce de cuentas: quién le debe a quién, historial, préstamos/encargos y liquidación.

import { useState } from "react";
import { HandCoins, Trash2 } from "lucide-react";
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
};

export function CruceView() {
  const state = useFinance();
  const { ledger, me, partner, memberById, supabase, reload, transactions } = state;
  const { openSettle, openTransaction } = useShell();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const net = crossNet(state);

  async function remove(id: string) {
    if (!confirm("¿Borrar este asiento?")) return;
    const { error } = await supabase.rpc("delete_ledger_entry", { p_id: id });
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

          <SectionTitle>Historial</SectionTitle>
          {ledger.length === 0 ? (
            <p className="px-1 text-sm text-muted">Aún no hay asientos. Se crean solos cuando uno paga algo que le correspondía al otro.</p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {ledger.map((l) => {
                const inFavor = l.creditor_user_id === me.user_id;
                const tx = l.transaction_id ? transactions.find((t) => t.id === l.transaction_id) : null;
                const deletable = (l.kind === "LOAN" || l.kind === "ERRAND") && l.created_by === me.user_id;
                return (
                  <div key={l.id} className="flex items-center gap-3 px-3.5 py-3">
                    <MemberBadge member={memberById(l.creditor_user_id)} size={28} />
                    <button className="min-w-0 flex-1 text-left" disabled={!tx} onClick={() => tx && openTransaction(tx)}>
                      <span className="block truncate font-medium">{l.description || KIND_LABEL[l.kind]}</span>
                      <span className="block text-xs text-muted">
                        {KIND_LABEL[l.kind]} · {formatDay(l.occurred_on)} ·{" "}
                        {l.kind === "SETTLEMENT"
                          ? `${memberById(l.creditor_user_id)?.display_name} pagó`
                          : `${memberById(l.debtor_user_id)?.display_name} le debe a ${memberById(l.creditor_user_id)?.display_name}`}
                      </span>
                    </button>
                    <span className={cn("num shrink-0 font-semibold", inFavor ? "text-olive" : "text-danger")}>
                      {inFavor ? "+" : "−"}{formatCop(l.amount)}
                    </span>
                    {deletable && (
                      <button className="p-1 text-muted" onClick={() => remove(l.id)} aria-label="Borrar asiento"><Trash2 size={16} /></button>
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
    </div>
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
