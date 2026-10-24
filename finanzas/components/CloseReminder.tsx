"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { inCloseWindow, monthRange, suggestedCloseMonth } from "@/lib/finance/reconcile";
import { monthName, todayBogota } from "@/lib/finance/periods";

/** Últimos 3 días del mes y primeros 5 del siguiente: recordar el cierre si faltan cuentas por conciliar. */
export function CloseReminder() {
  const { accounts, reconciliations, me } = useFinance();
  const today = todayBogota();
  if (!inCloseWindow(today)) return null;
  const month = suggestedCloseMonth(today);
  const start = monthRange(month).start;
  const mine = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived);
  const missing = mine.filter((a) => !reconciliations.some((r) => r.account_id === a.id && r.month === start && r.status === "RECONCILED"));
  if (mine.length === 0 || missing.length === 0) return null;
  return (
    <Link href={`/cierre?mes=${month}`} className="mt-4 flex items-center gap-3 rounded-2xl bg-wood-soft px-4 py-3 text-sm">
      <ClipboardCheck size={18} className="shrink-0 text-wood" />
      <span className="flex-1">
        Haz el cierre de <strong>{monthName(Number(month.slice(5)) - 1, true)}</strong>: {missing.length} cuenta{missing.length === 1 ? "" : "s"} por conciliar.
      </span>
    </Link>
  );
}
