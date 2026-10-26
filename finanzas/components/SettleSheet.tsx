"use client";

import { useEffect, useState } from "react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { ChipGroup } from "@/components/ui/segmented";
import { AmountInput } from "@/components/AmountInput";
import { crossNet } from "@/lib/finance/derive";
import { formatCop, parseCop } from "@/lib/finance/money";
import { todayBogota } from "@/lib/finance/periods";
import { accountLabel } from "@/lib/finance/labels";
import { errMsg } from "@/lib/utils";

/** Liquidación: quien debe registra con un toque la transferencia a su pareja. */
export function SettleSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const state = useFinance();
  const { me, partner, accounts, labels, supabase, reload } = state;
  const net = crossNet(state);
  const owe = Math.max(0, -net);

  const myAccounts = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived && !["CREDIT_CARD", "LOAN"].includes(a.kind));
  const partnerAccounts = labels.filter((l) => partner && l.owner_user_id === partner.user_id && !["CREDIT_CARD", "LOAN"].includes(l.kind));

  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(todayBogota());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(owe > 0 ? String(owe) : "");
    setFrom(myAccounts[0]?.id ?? "");
    setTo("");
    setDate(todayBogota());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    const n = parseCop(amount) ?? 0;
    if (n <= 0) return setError("Escribe el monto.");
    if (!partner) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("save_transaction", {
      p: {
        kind: "SETTLEMENT",
        amount: n,
        occurred_on: date,
        description: "Liquidación",
        account_id: from || null,
        to_account_id: to || null,
        counterparty_user_id: partner.user_id,
      },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Liquidar"
      description={owe > 0 ? `Le debes ${formatCop(owe)} a ${partner?.display_name}.` : net > 0 ? `${partner?.display_name} te debe ${formatCop(net)}. La liquidación la registra quien paga.` : "Están a paz y salvo."}>
      {!partner ? (
        <p className="py-4 text-[15px]">Cuando tu pareja se una al hogar podrás liquidar aquí.</p>
      ) : (
        <div className="space-y-4 pb-2">
          <AmountInput large value={amount} onChange={setAmount} />
          <Field label="Sale de (opcional)">
            <ChipGroup value={from} onChange={(v) => setFrom(v === from ? "" : v)}
              options={myAccounts.map((a) => ({ value: a.id, label: accountLabel(labels, a.id) }))} />
          </Field>
          {partnerAccounts.length > 0 && (
            <Field label={`Llega a (opcional)`}>
              <ChipGroup value={to} onChange={(v) => setTo(v === to ? "" : v)}
                options={partnerAccounts.map((a) => ({ value: a.id, label: accountLabel(labels, a.id) }))} />
            </Field>
          )}
          <Field label="Fecha" htmlFor="settle-date">
            <Input id="settle-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button size="lg" className="w-full" disabled={busy} onClick={save}>
            {busy ? "Guardando..." : `Registrar pago de ${formatCop(parseCop(amount) ?? 0)}`}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
