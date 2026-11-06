"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Handshake, Home, Lock, Scale, SlidersHorizontal, Tag as TagIcon, Undo2, X } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { PeriodSwitcher, SwipePeriods } from "@/components/PeriodSwitcher";
import { MemberBadge } from "@/components/MemberBadge";
import { TagManager } from "@/components/TagManager";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Segmented } from "@/components/ui/segmented";
import type { Space, Transaction, TxKind } from "@/lib/types";
import { TX_KIND_LABEL } from "@/lib/types";
import { formatCop } from "@/lib/finance/money";
import { formatDay, isWithin } from "@/lib/finance/periods";
import { accountLabel, categoryLabel, householdAccountOptions } from "@/lib/finance/labels";
import { cn } from "@/lib/utils";
import { filteredPaid, matchesFilter } from "@/lib/finance/reports";
import { CategoryOptions } from "@/components/CategoryPicker";
import { categoryPath, consumptionSign, creditBudgetMap, hasSplits, withDescendants } from "@/lib/finance/spaces";
import { hasTag } from "@/lib/finance/tags";
import { amountMatch, parseAmountQuery, type AmountMatch } from "@/lib/finance/amountSearch";

type Filter = "all" | "mine" | "cross" | "pending";

export default function MovimientosPage() {
  const { transactions, period, me, partner, categories, labels, accounts, tags, txTags } = useFinance();
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("filtro") === "pendientes") setFilter("pending");
    setCategoryId(q.get("categoria") ?? "");
    setAccountId(q.get("cuenta") ?? "");
    setTagId(q.get("etiqueta") ?? "");
  }, []);
  const activeFilters = [categoryId, accountId, kind, space, payerId, responsibleId, tagId].filter(Boolean).length;
  const categoryIds = useMemo(() => (categoryId ? withDescendants(categories, [categoryId]) : undefined), [categories, categoryId]);
  // Créditos con presupuesto: su pago (capital) sale en la categoría del presupuesto, como en Informes
  const creditBudgets = useMemo(() => creditBudgetMap(accounts), [accounts]);
  const people = [me, partner].filter(Boolean).map((m) => ({ id: m!.user_id, name: m!.user_id === me.user_id ? "Yo" : m!.display_name }));
  // Solo cuentas del hogar; con "Solo hogar", las que se usan para lo del hogar
  const accountOptions = useMemo(
    () => householdAccountOptions(labels, { members: [me, partner], accounts, space, transactions }),
    [labels, me, partner, accounts, space, transactions],
  );
  function clearFilters() {
    setCategoryId(""); setAccountId(""); setKind(""); setSpace(""); setPayerId(""); setResponsibleId(""); setTagId("");
    window.history.replaceState(null, "", "/movimientos");
  }

  // Si lo escrito es un monto, se busca por valor (exacto, aproximado o parecido) y no por texto
  const amountTarget = useMemo(() => parseAmountQuery(query), [query]);

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
        payerId: payerId || undefined, responsibleId: responsibleId || undefined, creditBudgets,
      })) return false;
      if (amountTarget !== null) {
        if (!amountMatch(t.amount, amountTarget)) return false;
      } else if (q) {
        const text = [t.description, t.merchant, ...t.splits.map((s) => categoryPath(categories, s.category_id) || categoryLabel(categories, s.category_id).name)].join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, period, filter, me.user_id, query, amountTarget, categories, categoryIds, creditBudgets, accountId, kind, space, payerId, responsibleId, tagId, txTags]);

  // Búsqueda por valor: primero los exactos, luego los aproximados y al final los parecidos
  const byAmount = useMemo(() => {
    if (amountTarget === null) return null;
    const order: AmountMatch[] = ["exact", "approx", "similar"];
    const buckets = new Map<AmountMatch, Transaction[]>(order.map((m) => [m, []]));
    for (const t of list) buckets.get(amountMatch(t.amount, amountTarget)!)!.push(t);
    return order.map((m) => [m, buckets.get(m)!] as const).filter(([, txs]) => txs.length > 0);
  }, [list, amountTarget]);

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of list) map.set(t.occurred_on, [...(map.get(t.occurred_on) ?? []), t]);
    return [...map.entries()];
  }, [list]);

  // Con categoría: la cuota completa de los créditos, como en Informes
  const totalExpense = categoryIds ? filteredPaid(list, creditBudgets) : list.reduce((a, t) => a + consumptionSign(t.kind) * t.amount, 0);
  const totalIncome = list.filter((t) => t.kind === "INCOME").reduce((a, t) => a + t.amount, 0);

  // Chips de los filtros activos: se quitan con la ×
  const chips: { key: string; label: string; clear: () => void }[] = [
    categoryId && { key: "cat", label: categoryPath(categories, categoryId) || categoryLabel(categories, categoryId).name, clear: () => setCategoryId("") },
    space && { key: "space", label: space === "HOUSEHOLD" ? "Hogar" : "Personal", clear: () => setSpace("") },
    kind && { key: "kind", label: TX_KIND_LABEL[kind], clear: () => setKind("") },
    accountId && { key: "acc", label: accountLabel(labels, accountId), clear: () => setAccountId("") },
    payerId && { key: "payer", label: `Pagó: ${people.find((p) => p.id === payerId)?.name ?? ""}`, clear: () => setPayerId("") },
    responsibleId && { key: "resp", label: `A cargo: ${people.find((p) => p.id === responsibleId)?.name ?? ""}`, clear: () => setResponsibleId("") },
    tagId && { key: "tag", label: `#${tags.find((t) => t.id === tagId)?.name ?? "etiqueta"}`, clear: () => setTagId("") },
  ].filter((c): c is { key: string; label: string; clear: () => void } => !!c);

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between py-2">
        <h1 className="font-display text-3xl">Movimientos</h1>
        <button className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-olive hover:bg-surface-2" onClick={() => setManageTags(true)}>
          <TagIcon size={16} /> Etiquetas{tags.length > 0 ? ` (${tags.length})` : ""}
        </button>
      </div>
      <PeriodSwitcher />
      <Segmented className="mt-3" value={filter} onChange={setFilter} options={[
        { value: "all", label: "Todos" },
        { value: "mine", label: "Pagué yo" },
        { value: "cross", label: "Cruces" },
        { value: "pending", label: "Pendientes" },
      ]} />
      <div className="mt-3 flex gap-2">
        <Input className="min-w-0 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por concepto, categoría o valor" aria-label="Buscar" />
        <button onClick={() => setFiltersOpen(true)} aria-label="Filtros"
          className={cn("flex shrink-0 items-center gap-1.5 rounded-2xl border px-3.5 text-sm font-medium", activeFilters ? "border-olive bg-olive-soft" : "border-border bg-surface")}>
          <SlidersHorizontal size={16} /> Filtros{activeFilters ? ` · ${activeFilters}` : ""}
        </button>
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button key={c.key} onClick={c.clear} aria-label={`Quitar filtro ${c.label}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-olive bg-olive-soft px-2.5 py-1 text-xs">
              <span className="truncate">{c.label}</span> <X size={12} className="shrink-0" />
            </button>
          ))}
          {chips.length > 1 && <button className="px-1 text-xs text-muted underline" onClick={clearFilters}>Quitar todos</button>}
        </div>
      )}

      <SwipePeriods>
        <p className="num mt-3 px-1 text-sm text-muted">
          {list.length} movimiento{list.length === 1 ? "" : "s"} · pagos {formatCop(totalExpense)}
          {totalIncome > 0 ? ` · ingresos ${formatCop(totalIncome)}` : ""}
        </p>
        {byAmount ? (
          byAmount.length === 0 ? (
            <Card className="mt-4 text-center text-[15px] text-muted">Ningún movimiento de este periodo tiene un valor parecido a {formatCop(amountTarget!)}.</Card>
          ) : (
            byAmount.map(([match, txs]) => (
              <section key={match} className="mt-4">
                <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted">{AMOUNT_MATCH_LABEL[match]} · {txs.length}</h2>
                <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                  {txs.map((t) => <TxRow key={t.id} tx={t} showDate />)}
                </div>
              </section>
            ))
          )
        ) : groups.length === 0 ? (
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

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title="Filtros"
        footer={<div className="flex gap-3">
          <Button variant="secondary" className="flex-1" size="lg" onClick={clearFilters} disabled={!activeFilters}>Quitar filtros</Button>
          <Button className="flex-1" size="lg" onClick={() => setFiltersOpen(false)}>Ver {list.length}</Button>
        </div>}>
        <div className="space-y-4 pb-2">
          <Field label="Espacio">
            <Segmented value={space || "ALL"} onChange={(v) => setSpace(v === "ALL" ? "" : v)} options={[
              { value: "ALL", label: "Todo" },
              { value: "HOUSEHOLD", label: "Hogar" },
              { value: "PERSONAL", label: "Personal" },
            ]} />
          </Field>
          <Field label="Categoría" htmlFor="f-cat">
            <Select id="f-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todas</option>
              <CategoryOptions categories={categories.filter((c) => !c.archived)} />
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo" htmlFor="f-kind">
              <Select id="f-kind" value={kind} onChange={(e) => setKind(e.target.value as TxKind | "")}>
                <option value="">Todos</option>
                {(Object.keys(TX_KIND_LABEL) as TxKind[]).map((k) => <option key={k} value={k}>{TX_KIND_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="Cuenta" htmlFor="f-acc">
              <Select id="f-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Todas</option>
                {accountId && !accountOptions.some((o) => o.id === accountId) && <option value={accountId}>{accountLabel(labels, accountId)}</option>}
                {accountOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="Pagó" htmlFor="f-payer">
              <Select id="f-payer" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
                <option value="">Cualquiera</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="A cargo de" htmlFor="f-resp">
              <Select id="f-resp" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
                <option value="">Cualquiera</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
          {tags.length > 0 && (
            <Field label="Etiqueta" htmlFor="f-tag">
              <Select id="f-tag" value={tagId} onChange={(e) => setTagId(e.target.value)}>
                <option value="">Todas</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          )}
          <p className="text-xs text-muted">Para buscar por valor escribe el monto en la búsqueda (ej. 45000, $45.000 o 45 mil): salen los de valor exacto, los aproximados (±10 %) y los parecidos.</p>
        </div>
      </Sheet>
      <TagManager open={manageTags} onOpenChange={setManageTags} />
    </main>
  );
}

const AMOUNT_MATCH_LABEL: Record<AmountMatch, string> = {
  exact: "Valor exacto",
  approx: "Valor aproximado (±10 %)",
  similar: "Valores parecidos",
};

function TxRow({ tx, showDate = false }: { tx: Transaction; showDate?: boolean }) {
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
    title = tx.description && tx.description !== "Liquidación" ? tx.description : "Liquidación";
    subtitle = `${payer?.display_name} → ${memberById(tx.counterparty_user_id)?.display_name}`;
    // Para quien la recibe es una entrada; para quien la paga, una salida
    sign = tx.counterparty_user_id === me.user_id ? "+" : tx.payer_user_id === me.user_id ? "−" : "";
  }
  if ((tx.installments ?? 1) > 1 && tx.kind === "EXPENSE") subtitle = `${subtitle} · ${tx.installments} cuotas`;
  if (showDate) subtitle = `${formatDay(tx.occurred_on)} · ${subtitle}`;

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

