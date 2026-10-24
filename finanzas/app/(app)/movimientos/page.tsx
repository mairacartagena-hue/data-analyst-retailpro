"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Handshake, Lock } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { MemberBadge } from "@/components/MemberBadge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { Transaction } from "@/lib/types";
import { formatCop } from "@/lib/finance/money";
import { formatDay, isWithin } from "@/lib/finance/periods";
import { accountLabel, categoryLabel } from "@/lib/finance/labels";
import { cn } from "@/lib/utils";

type Filter = "all" | "mine" | "cross" | "pending";

export default function MovimientosPage() {
  const { transactions, period, me, categories } = useFinance();
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("filtro") === "pendientes") setFilter("pending");
  }, []);
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (!isWithin(t.occurred_on, period)) return false;
      if (filter === "mine" && t.payer_user_id !== me.user_id) return false;
      if (filter === "cross" && !(t.kind === "SETTLEMENT" || t.splits.some((s) => s.responsible_user_id !== t.payer_user_id))) return false;
      if (filter === "pending" && t.status !== "PENDING_REVIEW") return false;
      if (q) {
        const text = [t.description, t.merchant, ...t.splits.map((s) => categoryLabel(categories, s.category_id).name)].join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, period, filter, me.user_id, query, categories]);

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of list) map.set(t.occurred_on, [...(map.get(t.occurred_on) ?? []), t]);
    return [...map.entries()];
  }, [list]);

  const totalExpense = list.filter((t) => t.kind === "EXPENSE").reduce((a, t) => a + t.amount, 0);

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <h1 className="py-2 font-display text-3xl">Movimientos</h1>
      <PeriodSwitcher />
      <Segmented className="mt-3" value={filter} onChange={setFilter} options={[
        { value: "all", label: "Todos" },
        { value: "mine", label: "Pagué yo" },
        { value: "cross", label: "Cruces" },
        { value: "pending", label: "Pendientes" },
      ]} />
      <Input className="mt-3" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por concepto o categoría" aria-label="Buscar" />

      <SwipePeriods>
        <p className="num mt-3 px-1 text-sm text-muted">
          {list.length} movimiento{list.length === 1 ? "" : "s"} · gastos {formatCop(totalExpense)}
        </p>
        {groups.length === 0 ? (
          <Card className="mt-4 text-center text-[15px] text-muted">No hay movimientos en este periodo.</Card>
        ) : (
          groups.map(([day, txs]) => (
            <section key={day} className="mt-4">
              <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted">{formatDay(day)}</h2>
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {txs.map((t) => <TxRow key={t.id} tx={t} />)}
              </div>
            </section>
          ))
        )}
      </SwipePeriods>
    </main>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const { me, categories, labels, memberById } = useFinance();
  const { openTransaction } = useShell();
  const payer = memberById(tx.payer_user_id);
  const crossed = tx.splits.filter((s) => s.responsible_user_id !== tx.payer_user_id);
  const firstCat = categoryLabel(categories, tx.splits[0]?.category_id ?? null);

  let icon = <span className="text-lg">{firstCat.icon}</span>;
  let title = tx.description || tx.merchant || firstCat.name;
  let subtitle = tx.splits.length > 1 ? `${tx.splits.length} partes` : firstCat.name;
  let sign = "−";
  if (tx.kind === "INCOME") {
    icon = <ArrowDownLeft size={18} className="text-olive" />;
    title = tx.description || "Ingreso";
    subtitle = tx.is_shared ? "Ingreso compartido" : "Ingreso";
    sign = "+";
  } else if (tx.kind === "TRANSFER") {
    icon = <ArrowRightLeft size={18} className="text-muted" />;
    title = tx.description || "Transferencia";
    subtitle = `${accountLabel(labels, tx.account_id)} → ${accountLabel(labels, tx.to_account_id)}`;
    sign = "";
  } else if (tx.kind === "SETTLEMENT") {
    icon = <Handshake size={18} className="text-wood" />;
    title = "Liquidación";
    subtitle = `${payer?.display_name} → ${memberById(tx.counterparty_user_id)?.display_name}`;
  }

  return (
    <button onClick={() => openTransaction(tx)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted">
          <MemberBadge member={payer} size={14} />
          {subtitle}
          {tx.kind === "EXPENSE" && !labels.some((l) => l.id === tx.account_id) && <Lock size={11} aria-label="Cuenta privada" />}
        </span>
        {crossed.length > 0 && tx.kind === "EXPENSE" && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-wood-soft px-2 py-0.5 text-[11px]">
            <ArrowUpRight size={11} />
            Pagado por {payer?.user_id === me.user_id ? "ti" : payer?.display_name}, corresponde a{" "}
            {crossed.map((s) => (s.responsible_user_id === me.user_id ? "ti" : memberById(s.responsible_user_id)?.display_name)).filter((v, i, a) => a.indexOf(v) === i).join(" y ")}
          </span>
        )}
      </span>
      <span className={cn("num shrink-0 font-semibold", tx.kind === "INCOME" && "text-olive")}>
        {sign}{formatCop(tx.amount)}
      </span>
    </button>
  );
}
