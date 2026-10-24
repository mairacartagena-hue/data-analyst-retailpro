"use client";

import { createContext, useCallback, useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, List, PieChart, Plus, Wallet } from "lucide-react";
import type { Transaction } from "@/lib/types";
import { TransactionSheet, type TxPreset } from "@/components/TransactionSheet";
import { SettleSheet } from "@/components/SettleSheet";
import { cn } from "@/lib/utils";

interface ShellApi {
  openTransaction: (tx?: Transaction | null) => void;
  /** Abre el registro de un gasto con la categoría y el monto ya puestos. */
  openPayment: (preset: TxPreset) => void;
  openSettle: () => void;
}

const ShellCtx = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const v = useContext(ShellCtx);
  if (!v) throw new Error("useShell fuera de AppShell");
  return v;
}

const NAV = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/movimientos", label: "Movimientos", icon: List },
  { href: "/presupuestos", label: "Presupuestos", icon: PieChart },
  { href: "/cuentas", label: "Cuentas", icon: Wallet },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [txOpen, setTxOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [preset, setPreset] = useState<TxPreset | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);

  const openTransaction = useCallback((tx?: Transaction | null) => {
    setEditing(tx ?? null);
    setPreset(null);
    setTxOpen(true);
  }, []);
  const openPayment = useCallback((p: TxPreset) => {
    setEditing(null);
    setPreset(p);
    setTxOpen(true);
  }, []);
  const openSettle = useCallback(() => setSettleOpen(true), []);

  const left = NAV.slice(0, 2);
  const right = NAV.slice(2);

  const item = (n: (typeof NAV)[number]) => {
    const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
    const Icon = n.icon;
    return (
      <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
        className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-olive" : "text-muted")}>
        <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
        {n.label}
      </Link>
    );
  };

  return (
    <ShellCtx.Provider value={{ openTransaction, openPayment, openSettle }}>
      <div className="mx-auto min-h-dvh w-full max-w-2xl pb-nav">{children}</div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-end px-2">
          {left.map(item)}
          <div className="flex flex-1 justify-center">
            <button onClick={() => openTransaction(null)} aria-label="Registrar movimiento"
              className="-mt-6 flex h-16 w-16 items-center justify-center rounded-full bg-olive text-on-olive shadow-soft ring-4 ring-bg active:scale-95">
              <Plus size={30} />
            </button>
          </div>
          {right.map(item)}
        </div>
      </nav>

      <TransactionSheet open={txOpen} onOpenChange={setTxOpen} editing={editing} preset={preset} />
      <SettleSheet open={settleOpen} onOpenChange={setSettleOpen} />
    </ShellCtx.Provider>
  );
}
