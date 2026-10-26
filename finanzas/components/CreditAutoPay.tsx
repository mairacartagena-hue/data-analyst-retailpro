"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { findCreditPayments } from "@/lib/finance/creditBudget";
import { todayBogota } from "@/lib/finance/periods";

/**
 * Cruce automático: cuando llega solo un pago con el valor de la cuota de un crédito con presupuesto,
 * lo convierte en el pago de ese crédito (baja la deuda y paga su presupuesto). Cada movimiento se intenta una vez.
 */
export function CreditAutoPay() {
  const { me, accounts, balances, transactions, limits, budgets, supabase, reload, offline } = useFinance();
  const tried = useRef(new Set<string>());
  const today = todayBogota();
  const matches = useMemo(
    () => findCreditPayments({ meId: me.user_id, accounts, balances, transactions, limits, budgets }, today),
    [me.user_id, accounts, balances, transactions, limits, budgets, today],
  );

  useEffect(() => {
    if (offline) return;
    const pending = matches.filter((m) => !tried.current.has(m.transaction.id));
    if (pending.length === 0) return;
    for (const m of pending) tried.current.add(m.transaction.id);
    void (async () => {
      let changed = false;
      for (const m of pending) {
        const { data, error } = await supabase.rpc("apply_credit_payment", {
          p: { transaction_id: m.transaction.id, credit_id: m.credit.id, charges: m.charges },
        });
        if (!error && data) changed = true;
      }
      if (changed) void reload();
    })();
  }, [matches, offline, supabase, reload]);

  return null;
}
