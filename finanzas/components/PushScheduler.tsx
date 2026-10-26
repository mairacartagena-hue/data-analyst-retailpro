"use client";

import { useEffect, useMemo } from "react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { buildReminders } from "@/lib/finance/reminders";
import { todayBogota } from "@/lib/finance/periods";
import { currentSubscription, SYNC_KEY } from "@/lib/push/client";

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Con las notificaciones activas, deja programados en la base los recordatorios de los próximos días. */
export function PushScheduler() {
  const { me, accounts, balances, transactions, commitments, cardItems, reconciliations, supabase } = useFinance();
  const today = todayBogota();
  const reminders = useMemo(
    () => buildReminders({ me: me.user_id, today, accounts, balances, transactions, commitments, cardItems, reconciliations }),
    [me.user_id, today, accounts, balances, transactions, commitments, cardItems, reconciliations],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted" || !navigator.onLine) return;
    const json = JSON.stringify(reminders);
    const sig = `${me.user_id}:${hash(json)}`;
    let stored: string | null = null;
    try { stored = localStorage.getItem(SYNC_KEY); } catch {}
    if (stored === sig) return;
    const t = setTimeout(async () => {
      if (!(await currentSubscription())) return;
      const { error } = await supabase.rpc("sync_push_schedule", { p: reminders });
      if (!error) {
        try { localStorage.setItem(SYNC_KEY, sig); } catch {}
      }
    }, 3000);
    return () => clearTimeout(t);
  }, [reminders, me.user_id, supabase]);

  return null;
}
