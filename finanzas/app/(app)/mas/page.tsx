"use client";

import Link from "next/link";
import { ChevronRight, ClipboardCheck, Settings, Wallet, Zap } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { crossNet } from "@/lib/finance/derive";
import { formatCop } from "@/lib/finance/money";
import { inCloseWindow, monthRange, suggestedCloseMonth } from "@/lib/finance/reconcile";
import { todayBogota } from "@/lib/finance/periods";

export default function MasPage() {
  const state = useFinance();
  const { accounts, reconciliations, me, partner } = state;
  const net = crossNet(state);
  const month = suggestedCloseMonth(todayBogota());
  const start = monthRange(month).start;
  const mine = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived);
  const toClose = mine.filter((a) => !reconciliations.some((r) => r.account_id === a.id && r.month === start && r.status === "RECONCILED")).length;

  const items = [
    {
      href: "/cuentas", icon: Wallet, title: "Cuentas y cruce",
      hint: partner ? (net === 0 ? "A paz y salvo con tu pareja" : net < 0 ? `Le debes ${formatCop(-net)}` : `Te debe ${formatCop(net)}`) : "Tus cuentas, tarjetas y patrimonio",
    },
    { href: "/cierre", icon: ClipboardCheck, title: "Cierre del mes", hint: toClose > 0 && inCloseWindow(todayBogota()) ? `${toClose} cuenta${toClose === 1 ? "" : "s"} por conciliar` : "Concilia tus cuentas con el banco", alert: toClose > 0 && inCloseWindow(todayBogota()) },
    { href: "/captura", icon: Zap, title: "Captura automática", hint: "Notificaciones, SMS y correos bancarios" },
    { href: "/ajustes", icon: Settings, title: "Ajustes", hint: "Perfil, hogar, periodos, apariencia" },
  ];

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <h1 className="py-2 font-display text-3xl">Más</h1>
      <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface">
        {items.map((i) => {
          const Icon = i.icon;
          return (
            <Link key={i.href} href={i.href} className="flex items-center gap-3 px-4 py-4 hover:bg-surface-2">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2"><Icon size={19} /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{i.title}</span>
                <span className={i.alert ? "block text-xs text-warning" : "block text-xs text-muted"}>{i.hint}</span>
              </span>
              <ChevronRight size={18} className="text-muted" />
            </Link>
          );
        })}
      </div>
    </main>
  );
}
