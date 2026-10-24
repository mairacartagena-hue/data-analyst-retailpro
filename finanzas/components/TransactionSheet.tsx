"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Plus, Scissors, Trash2, X } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import type { Category, Transaction, TxKind } from "@/lib/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { ChipGroup, Segmented } from "@/components/ui/segmented";
import { SwitchRow } from "@/components/ui/switch";
import { AmountInput } from "@/components/AmountInput";
import { MemberBadge } from "@/components/MemberBadge";
import { formatCop, parseCop } from "@/lib/finance/money";
import { periodFor, todayBogota } from "@/lib/finance/periods";
import { statusesFor } from "@/lib/finance/derive";
import { fixedAmountsExcess } from "@/lib/finance/budget";
import { unassigned, validateSplits, type SplitDraft } from "@/lib/finance/crossLedger";
import { accountLabel, categoryLabel, categoryResponsible } from "@/lib/finance/labels";
import { errMsg } from "@/lib/utils";

type FormKind = Exclude<TxKind, "SETTLEMENT">;

interface SplitRow {
  key: string;
  amount: string;
  categoryId: string;
  responsibleId: string;
}

interface FixedPrompt {
  categoryName: string;
  payerRemaining: number;
  excess: number;
  charge: string;
}

const LAST_ACCOUNT_KEY = "last-account";

function newKey() {
  return Math.random().toString(36).slice(2);
}

/** Valores iniciales para registrar el pago de una categoría desde su barra. */
export interface TxPreset {
  categoryId: string;
  amount: number;
}

export function TransactionSheet({
  open, onOpenChange, editing, preset = null,
}: { open: boolean; onOpenChange: (v: boolean) => void; editing: Transaction | null; preset?: TxPreset | null }) {
  const state = useFinance();
  const router = useRouter();
  const { me, partner, accounts, categories, labels, supabase, reload } = state;

  const myAccounts = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived);
  const usable = categories.filter((c) => !c.archived);

  const readOnly = !!editing && (editing.created_by !== me.user_id || editing.kind === "SETTLEMENT");

  const [kind, setKind] = useState<FormKind>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayBogota());
  const [accountId, setAccountId] = useState<string>("");
  const [toAccountId, setToAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [responsibleId, setResponsibleId] = useState<string>(me.user_id);
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [isShared, setIsShared] = useState(false);
  const [fixedPrompt, setFixedPrompt] = useState<FixedPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cargar el formulario al abrir
  useEffect(() => {
    if (!open) return;
    setError(null);
    setFixedPrompt(null);
    setBusy(false);
    if (editing) {
      setKind(editing.kind === "SETTLEMENT" ? "EXPENSE" : editing.kind);
      setAmount(String(editing.amount));
      setDescription(editing.description ?? editing.merchant ?? "");
      setDate(editing.occurred_on);
      setAccountId(editing.account_id ?? "");
      setToAccountId(editing.to_account_id ?? "");
      setIsShared(editing.is_shared);
      const sp = editing.splits;
      if (sp.length > 1) {
        setSplitMode(true);
        setSplits(sp.map((s) => ({ key: s.id, amount: String(s.amount), categoryId: s.category_id ?? "", responsibleId: s.responsible_user_id })));
      } else {
        setSplitMode(false);
        setCategoryId(sp[0]?.category_id ?? "");
        setResponsibleId(sp[0]?.responsible_user_id ?? me.user_id);
      }
      return;
    }
    let last = "";
    try { last = localStorage.getItem(LAST_ACCOUNT_KEY) ?? ""; } catch {}
    const presetCategory = preset ? usable.find((c) => c.id === preset.categoryId) ?? null : null;
    setKind("EXPENSE");
    setAmount(preset && preset.amount > 0 ? String(preset.amount) : "");
    setDescription(presetCategory ? presetCategory.name : "");
    setDate(todayBogota());
    setAccountId(myAccounts.some((a) => a.id === last) ? last : (myAccounts[0]?.id ?? ""));
    setToAccountId("");
    setCategoryId(presetCategory?.id ?? "");
    setResponsibleId(presetCategory ? (categoryResponsible(presetCategory, me, partner) ?? me.user_id) : me.user_id);
    setSplitMode(false);
    setSplits([]);
    setIsShared(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, preset]);

  const total = parseCop(amount) ?? 0;
  const selectedCategory = usable.find((c) => c.id === categoryId) ?? null;

  function pickCategory(c: Category) {
    setCategoryId(c.id);
    const resp = categoryResponsible(c, me, partner);
    setResponsibleId(resp ?? me.user_id);
  }

  const memberOptions = [me, partner].filter(Boolean).map((m) => ({
    value: m!.user_id,
    label: m!.user_id === me.user_id ? "Yo" : m!.display_name,
    color: m!.color,
  }));

  // Categorías que puede elegir cada responsable en el desglose: las privadas solo su dueño.
  const categoriesFor = (userId: string) =>
    usable.filter((c) => c.responsibility !== "PRIVATE" || c.owner_user_id === userId);

  function startSplit() {
    const first: SplitRow = { key: newKey(), amount: amount, categoryId, responsibleId };
    const second: SplitRow = { key: newKey(), amount: "", categoryId: "", responsibleId: partner?.user_id ?? me.user_id };
    setSplits([first, second]);
    setSplitMode(true);
  }

  const splitDrafts: SplitDraft[] = splitMode
    ? splits.map((s) => ({ amount: parseCop(s.amount) ?? 0, categoryId: s.categoryId || null, responsibleUserId: s.responsibleId }))
    : [{ amount: total, categoryId: categoryId || null, responsibleUserId: responsibleId }];
  const remaining = unassigned(total, splitDrafts);

  const fixedContext = useMemo(() => {
    if (kind !== "EXPENSE" || splitMode || !selectedCategory || !partner) return null;
    if (selectedCategory.responsibility !== "FIXED_AMOUNTS" || responsibleId !== me.user_id) return null;
    const period = periodFor(state.settings, date);
    const st = statusesFor(state, period).get(selectedCategory.id);
    if (!st) return null;
    const mine = st.allocations.find((a) => a.userId === me.user_id);
    const theirs = st.allocations.find((a) => a.userId === partner.user_id);
    if (!mine || !theirs) return null;
    // Al editar, lo ya guardado de este mismo movimiento no cuenta como gastado
    const own = editing?.splits.filter((s) => s.category_id === selectedCategory.id && s.responsible_user_id === me.user_id)
      .reduce((acc, s) => acc + s.amount, 0) ?? 0;
    const sameCat = editing && editing.occurred_on >= period.start && editing.occurred_on <= period.end ? own : 0;
    return { mine: { ...mine, spent: mine.spent - sameCat }, theirs };
  }, [kind, splitMode, selectedCategory, partner, responsibleId, me.user_id, state, date, editing]);

  async function save(chargeExcess?: number) {
    setError(null);
    if (total <= 0) return setError("Escribe el monto.");
    if (kind !== "TRANSFER" && !accountId) return setError("Elige la cuenta.");

    let payloadSplits: (SplitDraft & { origin?: string })[] = [];
    if (kind === "EXPENSE") {
      payloadSplits = splitDrafts;
      const v = validateSplits(total, payloadSplits);
      if (v) return setError(v);

      // Partida de montos fijos: si me paso de mi parte, preguntar si se cobra
      if (chargeExcess === undefined && fixedContext) {
        const r = fixedAmountsExcess({
          amount: total,
          payerAvailable: fixedContext.mine.available,
          payerSpent: fixedContext.mine.spent,
          partnerAvailable: fixedContext.theirs.available,
          partnerSpent: fixedContext.theirs.spent,
        });
        if (r.excess > 0) {
          setFixedPrompt({
            categoryName: selectedCategory!.name,
            payerRemaining: r.payerRemaining,
            excess: r.excess,
            charge: String(r.suggestedCharge > 0 ? r.suggestedCharge : r.excess),
          });
          return;
        }
      }
      if (chargeExcess && chargeExcess > 0 && partner) {
        const charge = Math.min(chargeExcess, total);
        payloadSplits = [
          ...(total - charge > 0 ? [{ amount: total - charge, categoryId: categoryId || null, responsibleUserId: me.user_id }] : []),
          { amount: charge, categoryId: categoryId || null, responsibleUserId: partner.user_id, origin: "FIXED_EXCESS" },
        ];
      }
    }
    if (kind === "TRANSFER" && (!accountId || !toAccountId || accountId === toAccountId)) {
      return setError("Elige la cuenta de origen y una de destino distinta.");
    }

    setBusy(true);
    const { error } = await supabase.rpc("save_transaction", {
      p: {
        id: editing?.id ?? null,
        kind,
        amount: total,
        occurred_on: date,
        description,
        account_id: accountId || null,
        to_account_id: kind === "TRANSFER" ? toAccountId : null,
        is_shared: kind === "INCOME" ? isShared : false,
        splits: payloadSplits.map((s) => ({
          amount: s.amount,
          category_id: s.categoryId,
          responsible_user_id: s.responsibleUserId,
          origin: s.origin ?? "NORMAL",
        })),
      },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    try { if (accountId) localStorage.setItem(LAST_ACCOUNT_KEY, accountId); } catch {}
    onOpenChange(false);
    void reload();
  }

  async function remove() {
    if (!editing || !confirm("¿Borrar este movimiento? También se borra lo que generó en el cruce.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_transaction", { p_id: editing.id });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  if (readOnly && editing) {
    return <TransactionDetail open={open} onOpenChange={onOpenChange} tx={editing} />;
  }

  const partnerName = partner?.display_name ?? "tu pareja";
  const crossing = kind === "EXPENSE" && !splitMode && responsibleId !== me.user_id;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={editing ? "Editar movimiento" : preset ? "Registrar pago" : "Registrar"}>
      {myAccounts.length === 0 ? (
        <div className="space-y-3 py-6 text-center">
          <p className="text-[15px]">Primero agrega una cuenta (ahorros, Nequi, efectivo o tarjeta) en la pestaña Cuentas.</p>
          <Button onClick={() => { onOpenChange(false); router.push("/cuentas"); }}>Ir a Cuentas</Button>
        </div>
      ) : fixedPrompt ? (
        <div className="space-y-4 py-2">
          <p className="text-[15px]">
            Con este gasto te pasas <strong>{formatCop(fixedPrompt.excess)}</strong> de tu parte fija en{" "}
            <strong>{fixedPrompt.categoryName}</strong>
            {fixedPrompt.payerRemaining > 0 ? <> (te quedaban {formatCop(fixedPrompt.payerRemaining)})</> : null}.
          </p>
          <Field label={`¿Cuánto le cobras a ${partnerName}?`} htmlFor="charge">
            <AmountInput id="charge" value={fixedPrompt.charge} onChange={(v) => setFixedPrompt({ ...fixedPrompt, charge: v })} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" disabled={busy} onClick={() => save(0)}>No cobrar</Button>
            <Button disabled={busy || !(parseCop(fixedPrompt.charge) ?? 0)} onClick={() => save(parseCop(fixedPrompt.charge) ?? 0)}>
              Cobrar {formatCop(parseCop(fixedPrompt.charge) ?? 0)}
            </Button>
          </div>
          <button className="w-full text-sm text-muted underline" onClick={() => setFixedPrompt(null)}>Volver</button>
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          {!editing && (
            <Segmented value={kind} onChange={setKind} options={[
              { value: "EXPENSE", label: "Gasto" },
              { value: "INCOME", label: "Ingreso" },
              { value: "TRANSFER", label: "Transferencia" },
            ]} />
          )}

          <AmountInput large value={amount} onChange={setAmount} autoFocus={!editing && !preset} />

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder={kind === "INCOME" ? "¿De dónde? (salario, venta…)" : kind === "TRANSFER" ? "Nota (opcional)" : "¿En qué? (comercio o concepto)"}
              aria-label="Descripción" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[150px]" aria-label="Fecha" />
          </div>

          <Field label={kind === "INCOME" ? "Entró a" : kind === "TRANSFER" ? "Sale de" : "Pagué con"}>
            <ChipGroup value={accountId} onChange={setAccountId}
              options={myAccounts.map((a) => ({ value: a.id, label: accountLabel(labels, a.id) }))} />
          </Field>

          {kind === "TRANSFER" && (
            <Field label="Llega a" hint="Para pagar una tarjeta, elige la tarjeta como destino. No consume presupuesto.">
              <ChipGroup value={toAccountId} onChange={setToAccountId}
                options={myAccounts.filter((a) => a.id !== accountId).map((a) => ({ value: a.id, label: accountLabel(labels, a.id) }))} />
            </Field>
          )}

          {kind === "INCOME" && partner && (
            <SwitchRow label={`Compartir con ${partnerName}`} hint="Si lo compartes, lo ve y cuenta en el flujo del hogar."
              checked={isShared} onCheckedChange={setIsShared} />
          )}

          {kind === "EXPENSE" && !splitMode && (
            <>
              <Field label="Categoría">
                {usable.length === 0 ? (
                  <p className="text-sm text-muted">Aún no hay categorías. Créalas en Presupuestos.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {usable.map((c) => (
                      <button key={c.id} type="button" onClick={() => pickCategory(c)} aria-pressed={c.id === categoryId}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm ${c.id === categoryId ? "border-olive bg-olive-soft font-semibold" : "border-border bg-surface text-muted"}`}>
                        <span>{c.icon || "•"}</span>{c.name}
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              {partner && (
                <Field label="¿A quién le corresponde?">
                  <ChipGroup value={responsibleId} onChange={setResponsibleId}
                    options={memberOptions.filter((o) => selectedCategory?.responsibility !== "PRIVATE" || o.value === selectedCategory.owner_user_id)} />
                </Field>
              )}

              {crossing && (
                <div className="flex items-center gap-2 rounded-2xl bg-wood-soft px-3 py-2.5 text-sm">
                  <ArrowRightLeft size={16} className="text-wood" />
                  Pagado por ti, corresponde a {partnerName}. Se anota a tu favor en el cruce.
                </div>
              )}

              <Button variant="outline" size="sm" onClick={startSplit} disabled={!total}>
                <Scissors size={16} /> Dividir por montos
              </Button>
            </>
          )}

          {kind === "EXPENSE" && splitMode && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted">Desglose por montos exactos</p>
                <span className={`num text-sm font-semibold ${remaining === 0 ? "text-olive" : "text-danger"}`}>
                  {remaining === 0 ? "Cuadra" : remaining > 0 ? `Faltan ${formatCop(remaining)}` : `Sobran ${formatCop(-remaining)}`}
                </span>
              </div>
              {splits.map((s, i) => (
                <div key={s.key} className="space-y-2 rounded-2xl border border-border bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <AmountInput value={s.amount} className="flex-1"
                      onChange={(v) => setSplits(splits.map((x) => (x.key === s.key ? { ...x, amount: v } : x)))} />
                    {remaining > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setSplits(splits.map((x) => (x.key === s.key ? { ...x, amount: String((parseCop(x.amount) ?? 0) + remaining) } : x)))}>
                        +resto
                      </Button>
                    )}
                    {splits.length > 1 && (
                      <button aria-label={`Quitar parte ${i + 1}`} className="p-2 text-muted" onClick={() => setSplits(splits.filter((x) => x.key !== s.key))}>
                        <X size={18} />
                      </button>
                    )}
                  </div>
                  {partner && (
                    <ChipGroup value={s.responsibleId} options={memberOptions}
                      onChange={(v) => setSplits(splits.map((x) => (x.key === s.key ? {
                        ...x, responsibleId: v,
                        categoryId: categoriesFor(v).some((c) => c.id === x.categoryId) ? x.categoryId : "",
                      } : x)))} />
                  )}
                  <Select value={s.categoryId} aria-label="Categoría de esta parte"
                    onChange={(e) => setSplits(splits.map((x) => (x.key === s.key ? { ...x, categoryId: e.target.value } : x)))}>
                    <option value="">{s.responsibleId === me.user_id ? "Sin categoría" : `Sin categoría (la elige ${partnerName})`}</option>
                    {categoriesFor(s.responsibleId).map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>)}
                  </Select>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSplits([...splits, { key: newKey(), amount: remaining > 0 ? String(remaining) : "", categoryId: "", responsibleId: me.user_id }])}>
                  <Plus size={16} /> Agregar parte
                </Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  const f = splits[0];
                  setSplitMode(false);
                  setCategoryId(f?.categoryId ?? "");
                  setResponsibleId(f?.responsibleId ?? me.user_id);
                }}>
                  Sin dividir
                </Button>
              </div>
            </div>
          )}

          <ErrorText>{error}</ErrorText>

          <div className="flex gap-3 pt-1">
            {editing && (
              <Button variant="danger" size="icon" onClick={remove} disabled={busy} aria-label="Borrar">
                <Trash2 size={18} />
              </Button>
            )}
            <Button className="flex-1" size="lg" disabled={busy} onClick={() => save()}>
              {busy ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Vista de solo lectura (movimientos de la pareja). El responsable puede ponerle categoría a su parte. */
function TransactionDetail({ open, onOpenChange, tx }: { open: boolean; onOpenChange: (v: boolean) => void; tx: Transaction }) {
  const { me, categories, labels, supabase, reload, memberById } = useFinance();
  const [error, setError] = useState<string | null>(null);
  const payer = memberById(tx.payer_user_id);
  const hiddenAmount = tx.kind === "EXPENSE" ? tx.amount - tx.splits.reduce((a, s) => a + s.amount, 0) : 0;
  const myCategories = categories.filter((c) => !c.archived && (c.responsibility !== "PRIVATE" || c.owner_user_id === me.user_id));

  async function setCategory(splitId: string, categoryId: string) {
    setError(null);
    const { error } = await supabase.rpc("set_split_category", { p_split_id: splitId, p_category_id: categoryId || null });
    if (error) setError(errMsg(error));
    else void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.description || tx.merchant || "Movimiento"}>
      <div className="space-y-4 pb-2">
        <p className="num font-display text-4xl">{formatCop(tx.amount)}</p>
        <div className="flex items-center gap-2 text-sm text-muted">
          <MemberBadge member={payer} size={22} />
          {tx.kind === "SETTLEMENT" ? "Liquidación" : `Pagó ${payer?.user_id === me.user_id ? "yo" : payer?.display_name}`} ·{" "}
          {accountLabel(labels, tx.account_id)} · {tx.occurred_on}
        </div>
        {tx.splits.map((s) => {
          const cat = categoryLabel(categories, s.category_id);
          const resp = memberById(s.responsible_user_id);
          return (
            <div key={s.id} className="space-y-2 rounded-2xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><MemberBadge member={resp} size={22} /> {cat.icon} {cat.name}</span>
                <span className="num font-semibold">{formatCop(s.amount)}</span>
              </div>
              {s.responsible_user_id === me.user_id && (
                <Select value={s.category_id ?? ""} aria-label="Categoría de mi parte" onChange={(e) => setCategory(s.id, e.target.value)}>
                  <option value="">Sin categoría</option>
                  {myCategories.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>)}
                </Select>
              )}
            </div>
          );
        })}
        {hiddenAmount > 0 && <p className="text-sm text-muted">Y {formatCop(hiddenAmount)} en conceptos privados.</p>}
        <ErrorText>{error}</ErrorText>
        <p className="text-xs text-muted">Solo quien registró el movimiento puede editarlo o borrarlo.</p>
      </div>
    </Sheet>
  );
}
