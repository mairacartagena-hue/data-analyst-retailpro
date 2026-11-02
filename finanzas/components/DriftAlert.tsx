"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { driftedAccounts } from "@/lib/finance/reconcile";
import { formatCop } from "@/lib/finance/money";

/** Aviso en el inicio: una cuenta ya conciliada cambió después (movimiento nuevo, editado o borrado). */
export function DriftAlert() {
  const { accounts, transactions, reconciliations, me } = useFinance();
  const mine = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived);
  const list = driftedAccounts(mine, transactions, reconciliations);
  if (list.length === 0) return null;
  return (
    <>
      {list.map(({ account, rec, d }) => (
        <Link key={account.id} href={`/cierre?mes=${rec.month.slice(0, 7)}`} className="mt-4 flex items-center gap-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm">
          <AlertCircle size={18} className="shrink-0 text-danger" />
          <span className="flex-1">
            <strong>{account.name}</strong> se movió {formatCop(Math.abs(d.drift))} después de conciliarla. Toca para ver qué cambió.
          </span>
        </Link>
      ))}
    </>
  );
}
