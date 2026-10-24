"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Handshake, Home, Lock, Scale, SlidersHorizontal, Tag as TagIcon, Undo2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { MemberBadge } from "@/components/MemberBadge";
import { TagManager } from "@/components/TagManager";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { Space, Transaction, TxKind } from "@/lib/types";
import { TX_KIND_LABEL } from "@/lib/types";
import { formatCop } from "@/lib/finance/money";
import { formatDay, isWithin } from "@/lib/finance/periods";
import { accountLabel, categoryLabel } from "@/lib/finance/labels";
import { cn } from "@/lib/utils";
import { matchesFilter } from "@/lib/finance/reports";
import { CategoryOptions } from "@/components/CategoryPicker";
import { categoryPath, consumptionSign, hasSplits, withDescendants } from "@/lib/finance/spaces";
import { hasTag } from "@/lib/finance/tags";

type Filter = "all" | "mine" | "cross" | "pending";

export default function MovimientosPage() {
  const { transactions, period, me, partner, categories, labels, tags, txTags } = useFinance();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<TxKind | "">("");
  const [space, setSpace] = useState<Space | "">("");
  const [payerId, setPayerId] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [tagId, setTagId] = useState("");
  const [manageTags, setManageTags] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("filtro") === "pendientes") setFilter("pending");
    setCategoryId(q.get("categoria") ?? "");
    setAccountId(q.get("cuenta") ?? "");
    setTagId(q.get("etiqueta") ?? "");
    if (q.get("etiqueta")) setMoreFilters(true);
  }, []);
  const activeFilters = [categoryId, accountId, kind, space, payerId, responsibleId, tagId].filter(Boolean).length;
  const categoryIds = useMemo(() => (categoryId ? withDescendants(categories, [categoryId]) : undefined), [categories, categoryId]);
  const people = [me, partner].filter(Boolean).map((m) => ({ id: m!.user_id, name: m!.user_id === me.user_id ? "Yo" : m!.display_name }));
  function clearFilters() {
    setCategoryId(""); setAccountId(""); setKind(""); setSpace(""); setPayerId(""); setResponsibleId(""); setTagId("");
    window.history.replaceState(null, "", "/movimientos");
  }

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (!isWithin(t.occurred_on, period)) return false;
      if (filter === "mine" && t.payer_user_id !== me.user_id) return false;
      if (filter === "cross" && !(t.kind === "SETTLEMENT" || t.splits.some((s) => s.responsible_user_id !== t.payer_user_id))) return false;
      if (filter === "pending" && t.status !== "PENDING_REVIEW") return false;
      if (tagId && !hasTag(txTags, t.id, tagId)) return false;
      if (!matchesFilter(t, {
        categoryIds, accountId: accountId || undefined, kind: kind || undefined, scope: space || undefined,
        payerId: payerId || undefined, responsibleId: responsibleId || undefined,
      })) return false;
      if (q) {
        const text = [t.description, t.merchant, ...t.splits.map((s) => categoryPath(categories, s.category_id) || categoryLabel(categories, s.category_id).name)].join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, period, filter, me.user_id, query, categories, categoryIds, accountId, kind, space, payerId, responsibleId, tagId, txTags]);

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of list) map.set(t.occurred_on, [...(map.get(t.occurred_on) ?? []), t]);
    return [...map.entries()];
  }, [list]);

  const totalExpense = list.reduce((a, t) => a + consumptionSign(t.kind) * t.amount, 0);
  const totalIncome = list.filter((t) => t.kind === "INCOME").reduce((a, t) => a + t.amount, 0);

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
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Filtrar por categoría" className={cn("h-10 px-3 text-sm", categoryId && "border-olive bg-olive-soft")}>
          <option value="">Categoría</option>
          <CategoryOptions categories={categories.filter((c) => !c.archived)} />
        </Select>
        <Select value={space} onChange={(e) => setSpace(e.target.value as Space | "")} aria-label="Filtrar por espacio" className={cn("h-10 px-3 text-sm", space && "border-olive bg-olive-soft")}>
          <option value="">Hogar y personal</option>
          <option value="HOUSEHOLD">Solo hogar</option>
          <option value="PERSONAL">Solo personal</option>
        </Select>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button className="flex items-center gap-1 px-1 text-xs font-medium text-muted" onClick={() => setMoreFilters(!moreFilters)}>
          <SlidersHorizontal size={13} /> {moreFilters ? "Menos filtros" : "Más filtros"}
        </button>
        <button className="flex items-center gap-1 px-1 text-xs font-medium text-olive" onClick={() => setManageTags(true)}>
          <TagIcon size={13} /> Etiquetas{tags.length > 0 ? ` (${tags.length})` : ""}
        </button>
      </div>
      {moreFilters && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as TxKind | "")} aria-label="Filtrar por tipo" className={cn("h-10 px-3 text-sm", kind && "border-olive bg-olive-soft")}>
            <option value="">Tipo</option>
            {(Object.keys(TX_KIND_LABEL) as TxKind[]).map((k) => <option key={k} value={k}>{TX_KIND_LABEL[k]}</option>)}
          </Select>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Filtrar por cuenta" className={cn("h-10 px-3 text-sm", accountId && "border-olive bg-olive-soft")}>
            <option value="">Cuenta</option>
            {labels.map((l) => <option key={l.id} value={l.id}>{accountLabel(labels, l.id)}</option>)}
          </Select>
          <Select value={payerId} onChange={(e) => setPayerId(e.target.value)} aria-label="Filtrar por quién pagó" className={cn("h-10 px-3 text-sm", payerId && "border-olive bg-olive-soft")}>
            <option value="">Pagó</option>
            {people.map((p) => <option key={p.id} value={p.id}>Pagó: {p.name}</option>)}
          </Select>
          <Select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)} aria-label="Filtrar por responsable" className={cn("h-10 px-3 text-sm", responsibleId && "border-olive bg-olive-soft")}>
            <option value="">Responsable</option>
            {people.map((p) => <option key={p.id} value={p.id}>A cargo: {p.name}</option>)}
          </Select>
          <Select value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label="Filtrar por etiqueta" className={cn("h-10 px-3 text-sm", tagId && "border-olive bg-olive-soft")}>
            <option value="">Etiqueta</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </div>
      )}
      {activeFilters > 0 && (
        <button className="mt-2 px-1 text-xs text-olive underline" onClick={clearFilters}>
          Quitar filtros ({activeFilters})
        </button>
      )}

      <SwipePeriods>
        <p className="num mt-3 px-1 text-sm text-muted">
          {list.length} movimiento{list.length === 1 ? "" : "s"} · gastos {formatCop(totalExpense)}
          {totalIncome > 0 ? ` · ingresos ${formatCop(totalIncome)}` : ""}
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
      <TagManager open={manageTags} onOpenChange={setManageTags} />
    </main>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const { me, categories, labels, memberById, tags, txTags } = useFinance();
  const { openTransaction } = useShell();
  const rowTags = (txTags[tx.id] ?? []).map((id) => tags.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
  const payer = memberById(tx.payer_user_id);
  const crossed = tx.splits.filter((s) => s.responsible_user_id !== tx.payer_user_id);
  const firstCat = categoryLabel(categories, tx.splits[0]?.category_id ?? null);
  const firstName = categoryPath(categories, tx.splits[0]?.category_id) || firstCat.name;

  let icon = <span className="text-lg">{firstCat.icon}</span>;
  let title = tx.description || tx.merchant || firstName;
  let subtitle = tx.splits.length > 1 ? `${tx.splits.length} partes` : firstName;
  let sign = "−";
  if (tx.kind === "DEBT_PAYMENT") {
    subtitle = `Pago de deuda · ${subtitle}`;
  } else if (tx.kind === "REFUND") {
    icon = <Undo2 size={18} className="text-olive" />;
    title = tx.description || "Reembolso";
    subtitle = `Reembolso · ${subtitle}`;
    sign = "+";
  } else if (tx.kind === "ADJUSTMENT") {
    icon = <Scale size={18} className="text-muted" />;
    title = tx.description || "Ajuste de saldo";
    subtitle = `Ajuste · ${accountLabel(labels, tx.account_id)}`;
    sign = tx.direction === "IN" ? "+" : "−";
  } else if (tx.kind === "INCOME") {
    icon = <ArrowDownLeft size={18} className="text-olive" />;
    title = tx.description || "Ingreso";
    subtitle = tx.scope === "HOUSEHOLD" ? "Ingreso del hogar" : "Ingreso";
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
          {tx.scope === "HOUSEHOLD" ? <Home size={11} className="shrink-0" aria-label="Del hogar" /> : <Lock size={11} className="shrink-0" aria-label="Personal" />}
          {subtitle}
          {hasSplits(tx.kind) && !labels.some((l) => l.id === tx.account_id) && <span className="shrink-0">· cuenta privada</span>}
        </span>
        {rowTags.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {rowTags.slice(0, 3).map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color ?? "var(--muted)" }} />{t.name}
              </span>
            ))}
            {rowTags.length > 3 && <span className="text-[11px] text-muted">+{rowTags.length - 3}</span>}
          </span>
        )}
        {crossed.length > 0 && hasSplits(tx.kind) && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-wood-soft px-2 py-0.5 text-[11px]">
            <ArrowUpRight size={11} />
            Pagado por {payer?.user_id === me.user_id ? "ti" : payer?.display_name}, corresponde a{" "}
            {crossed.map((s) => (s.responsible_user_id === me.user_id ? "ti" : memberById(s.responsible_user_id)?.display_name)).filter((v, i, a) => a.indexOf(v) === i).join(" y ")}
          </span>
        )}
      </span>
      <span className={cn("num shrink-0 font-semibold", sign === "+" && "text-olive")}>
        {sign}{formatCop(tx.amount)}
      </span>
    </button>
  );
}

