"use client";

import { useMemo, useState } from "react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import type { Account, Transaction } from "@/lib/types";
import { creditPayments, fixWithRealCapital, type CreditPayment } from "@/lib/finance/creditPayments";
import { ensureCategory } from "@/lib/finance/ensureCategory";
import { formatCop, parseCop } from "@/lib/finance/money";
import { addDays, formatDay, todayBogota } from "@/lib/finance/periods";
import { errMsg } from "@/lib/utils";

/** Datos de un movimiento existente para editarlo con save_transaction cambiando solo el valor. */
function editPayload(t: Transaction, amount: number) {
  const splits = t.splits.length ? scaleSplits(t, amount) : [];
  return {
    id: t.id, kind: t.kind, scope: t.scope, amount, occurred_on: t.occurred_on, description: t.description,
    merchant: t.merchant ?? null, tags: t.tags ?? [], account_id: t.account_id, to_account_id: t.to_account_id,
    direction: t.direction ?? null, installments: t.installments ?? 1, interest_rate_ea: t.interest_rate_ea ?? null,
    creates_debt: t.creates_debt, is_shared: t.is_shared, income_category_id: t.income_category_id ?? null,
    scheduled_payment_id: t.scheduled_payment_id ?? null, scheduled_for: t.scheduled_for ?? null, splits,
  };
}

/** Reparte el nuevo valor entre las partes del gasto en la misma proporción (lo que sobra va a la última). */
function scaleSplits(t: Transaction, amount: number) {
  const base = t.splits.reduce((s, x) => s + x.amount, 0) || 1;
  let left = amount;
  return t.splits.map((s, i) => {
    const v = i === t.splits.length - 1 ? left : Math.round((s.amount * amount) / base);
    left -= v;
    return { amount: v, category_id: s.category_id, responsible_user_id: s.responsible_user_id, origin: s.origin ?? "NORMAL" };
  });
}

/**
 * Cuotas pagadas del crédito con su reparto, y "Ajustar con el pago real": se escribe el capital que dice el
 * banco y la app deja el resto como intereses y seguros, sin cambiar lo que salió de la cuenta que pagó.
 */
export function CreditPaymentAdjust({ account, since, defaultOpen = false }: { account: Account; since?: string; defaultOpen?: boolean }) {
  const { transactions } = useFinance();
  const from = since ?? addDays(todayBogota(), -120);
  const payments = useMemo(() => creditPayments(account, transactions, from), [account, transactions, from]);
  if (payments.length === 0) return null;
  return (
    <Collapsible title="Cuotas pagadas" summary={String(payments.length)} defaultOpen={defaultOpen}>
      <p className="text-xs text-muted">Si el banco repartió distinto (capital, intereses y seguros), ajústala con el pago real. Lo que salió de tu cuenta no cambia.</p>
      <div className="divide-y divide-border">
        {payments.map((p) => <PaymentRow key={p.transfer.id} account={account} payment={p} />)}
      </div>
    </Collapsible>
  );
}

function PaymentRow({ account, payment: p }: { account: Account; payment: CreditPayment }) {
  const state = useFinance();
  const { supabase, reload, me } = state;
  const [open, setOpen] = useState(false);
  const [capital, setCapital] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const typed = parseCop(capital);
  const fix = typed === null ? null : fixWithRealCapital(p, typed);

  async function save() {
    if (typed === null) return setErr("Escribe el capital que dice el pago del banco.");
    if (!fix) return setErr(`El capital debe estar entre $0 y ${formatCop(p.total)} (lo que pagaste).`);
    setBusy(true);
    setErr(null);
    try {
      if (fix.transferAmount !== p.transfer.amount) {
        const r = await supabase.rpc("save_transaction", { p: editPayload(p.transfer, fix.transferAmount) });
        if (r.error) throw r.error;
      }
      if (p.charge && fix.chargeAmount === 0) {
        const r = await supabase.rpc("delete_transaction", { p_id: p.charge.id });
        if (r.error) throw r.error;
      } else if (p.charge && fix.chargeAmount !== p.charge.amount) {
        const r = await supabase.rpc("save_transaction", { p: editPayload(p.charge, fix.chargeAmount) });
        if (r.error) throw r.error;
      } else if (!p.charge && fix.chargeAmount > 0) {
        const categoryId = account.budget_category_id ?? await ensureCategory(state, supabase, "Intereses y seguros de créditos", "🏦");
        const r = await supabase.rpc("save_transaction", { p: {
          kind: "EXPENSE", scope: account.budget_category_id ? "HOUSEHOLD" : "PERSONAL", amount: fix.chargeAmount, occurred_on: p.date,
          description: `Cuota ${account.name} · intereses y seguros`, account_id: account.id, tags: [],
          splits: [{ amount: fix.chargeAmount, category_id: categoryId, responsible_user_id: me.user_id, origin: "NORMAL" }],
        } });
        if (r.error) throw r.error;
      }
      setOpen(false);
      void reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{formatDay(p.date)} · pagaste {formatCop(p.total)}</p>
          <p className="text-xs text-muted">Capital {formatCop(p.capital)} · intereses y seguros {formatCop(p.charges)}</p>
        </div>
        {!open && <Button size="sm" variant="outline" onClick={() => { setOpen(true); setCapital(String(p.capital)); setErr(null); }}>Ajustar</Button>}
      </div>
      {open && (
        <div className="space-y-2 rounded-xl bg-surface-2 p-2.5">
          <p className="text-xs font-medium">Capital según el pago real del banco</p>
          <AmountInput value={capital} onChange={setCapital} />
          {fix && (
            <p className="text-xs text-muted">
              Quedan {formatCop(p.total - (typed ?? 0))} de intereses y seguros (gasto) y {formatCop(typed ?? 0)} bajan la deuda. Total: {formatCop(p.total)}.
            </p>
          )}
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
