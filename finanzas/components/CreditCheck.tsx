"use client";

import { useState } from "react";
import { Landmark } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/types";
import { formatCop, parseCop } from "@/lib/finance/money";
import { todayBogota } from "@/lib/finance/periods";
import { errMsg } from "@/lib/utils";

/** Mes en que toca confirmar el saldo del crédito: después del día de pago (o desde el día 1) y si aún no se confirmó. */
export function creditCheckDue(account: Pick<Account, "id" | "due_day" | "opening_at">, confirmedMonths: string[], today: string): boolean {
  const month = `${today.slice(0, 7)}-01`;
  if (confirmedMonths.includes(month)) return false;
  if (account.opening_at && account.opening_at.slice(0, 10) >= month) return false; // recién creado: su saldo ya es el del extracto
  const day = Number(today.slice(8, 10));
  return day > (account.due_day ?? 0);
}

/** Aviso mensual: “¿El saldo de tu hipoteca es $X? Confirmar / Corregir”. */
export function CreditCheck() {
  const { accounts, balances, reconciliations, me } = useFinance();
  const today = todayBogota();
  const due = accounts.filter((a) => a.kind === "CREDIT" && !a.archived && a.owner_user_id === me.user_id
    && (balances[a.id] ?? 0) < 0
    && creditCheckDue(a, reconciliations.filter((r) => r.account_id === a.id && r.status === "RECONCILED").map((r) => r.month), today));
  if (due.length === 0) return null;
  return <>{due.map((a) => <CreditCheckRow key={a.id} account={a} balance={balances[a.id] ?? 0} today={today} />)}</>;
}

function CreditCheckRow({ account, balance, today }: { account: Account; balance: number; today: string }) {
  const { supabase, reload } = useFinance();
  const [fixing, setFixing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const owed = -balance;
  const month = `${today.slice(0, 7)}-01`;

  async function record(statementOwed: number) {
    setBusy(true);
    setErr(null);
    const diff = statementOwed - owed; // + el banco dice que se debe más
    if (diff !== 0) {
      const r = await supabase.rpc("save_transaction", { p: {
        kind: "ADJUSTMENT", amount: Math.abs(diff), occurred_on: today, account_id: account.id,
        direction: diff > 0 ? "OUT" : "IN", description: `Ajuste del saldo con el extracto (${account.name})`, tags: ["#conciliacion"],
      } });
      if (r.error) { setBusy(false); return setErr(errMsg(r.error)); }
    }
    const { error } = await supabase.from("account_reconciliations").upsert({
      household_id: account.household_id, account_id: account.id, owner_user_id: account.owner_user_id, month,
      statement_balance: -statementOwed, app_balance: balance, status: "RECONCILED",
    }, { onConflict: "account_id,month" });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    void reload();
  }

  const typed = parseCop(value);
  return (
    <div className="mt-4 space-y-2 rounded-2xl bg-wood-soft px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <Landmark size={18} className="shrink-0 text-wood" />
        <span className="flex-1">¿El saldo de tu <strong>{account.name}</strong> es <strong>{formatCop(owed)}</strong>?</span>
      </div>
      {!fixing ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => record(owed)} disabled={busy}>Confirmar</Button>
          <Button size="sm" variant="outline" onClick={() => { setFixing(true); setValue(""); }} disabled={busy}>Corregir</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <AmountInput value={value} onChange={setValue} />
          <p className="text-xs text-muted">Escribe el saldo de capital que dice el extracto. La diferencia queda como ajuste del saldo (no es gasto ni ingreso).</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => typed !== null && typed >= 0 ? record(typed) : setErr("Escribe el saldo del extracto.")} disabled={busy}>Guardar</Button>
            <Button size="sm" variant="ghost" onClick={() => setFixing(false)} disabled={busy}>Cancelar</Button>
          </div>
        </div>
      )}
      {err ? <p className="text-xs text-danger">{err}</p> : null}
    </div>
  );
}
