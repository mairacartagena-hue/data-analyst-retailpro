"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Home, Lock, Plus, Scissors, Trash2, X } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import type { Category, Space, Transaction, TxKind } from "@/lib/types";
import { CHANNEL_LABEL, SPACE_LABEL, TX_KIND_LABEL } from "@/lib/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { ChipGroup, Segmented } from "@/components/ui/segmented";
import { SwitchRow } from "@/components/ui/switch";
import { AmountInput } from "@/components/AmountInput";
import { CategorySheet } from "@/components/CategorySheet";
import { CategoryOptions, CategoryPicker } from "@/components/CategoryPicker";
import { TransactionComments } from "@/components/TransactionComments";
import { TagPicker } from "@/components/TagPicker";
import { QuickCapture } from "@/components/QuickCapture";
import type { CaptureResult } from "@/lib/capture/phrase";
import { diffTags } from "@/lib/finance/tags";
import { MemberBadge } from "@/components/MemberBadge";
import { formatCop, parseCop } from "@/lib/finance/money";
import { formatDay, periodFor, todayBogota } from "@/lib/finance/periods";
import { statusesFor } from "@/lib/finance/derive";
import { fixedAmountsExcess } from "@/lib/finance/budget";
import { unassigned, validateSplits, type SplitDraft } from "@/lib/finance/crossLedger";
import { accountLabel, categoryLabel } from "@/lib/finance/labels";
import { categoryPath, hasSplits } from "@/lib/finance/spaces";
import { errMsg } from "@/lib/utils";
import { installmentPlan, MAX_INSTALLMENTS, rateOf } from "@/lib/finance/installments";
import { isNetworkError } from "@/lib/offline/store";
import { newClientId, type QueuedTx } from "@/lib/offline/queue";

type FormKind = Exclude<TxKind, "SETTLEMENT">;
type KindGroup = "EXPENSE" | "INCOME" | "TRANSFER" | "OTHER";
const OTHER_KINDS: FormKind[] = ["DEBT_PAYMENT", "REFUND", "ADJUSTMENT"];
/** Tipos que la pareja puede ajustar en un movimiento del hogar. */
const PARTNER_EDITABLE: TxKind[] = ["EXPENSE", "INCOME", "DEBT_PAYMENT", "REFUND"];

const KIND_HINT: Partial<Record<FormKind, string>> = {
  DEBT_PAYMENT: "Cuota de un crédito o deuda. Cuenta en el presupuesto de su categoría (ej. Deudas › Cuotas o Vivienda › Crédito hipotecario).",
  REFUND: "Te devolvieron plata de un gasto: resta de la categoría y no cuenta como ingreso.",
  ADJUSTMENT: "Corrige el saldo de una cuenta. No es ingreso ni gasto y no entra en presupuestos ni informes.",
};

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
const LAST_SCOPE_KEY = "last-scope";

/** Último espacio elegido al registrar (personal si no hay ninguno). */
function lastScope(): Space {
  try {
    return localStorage.getItem(LAST_SCOPE_KEY) === "HOUSEHOLD" ? "HOUSEHOLD" : "PERSONAL";
  } catch {
    return "PERSONAL";
  }
}

function newKey() {
  return Math.random().toString(36).slice(2);
}

/** Valores iniciales: pago de una categoría o de un vencimiento, o un aviso no reconocido de Captura automática. */
export interface TxPreset {
  kind?: FormKind;
  categoryId?: string;
  amount?: number;
  description?: string;
  date?: string;
  scope?: Space;
  responsibleId?: string;
  toAccountId?: string;
  /** Vencimiento que se paga con este movimiento. */
  scheduledPaymentId?: string;
  /** Gasto compartido: una parte por persona (se abre ya dividido). */
  shares?: { userId: string; amount: number }[];
  scheduledFor?: string;
  /** Aviso de ingest_logs que se marca como registrado al guardar. */
  logId?: string;
  /** Abrir escuchando (botón del micrófono). */
  voice?: boolean;
}

/** ¿Puedo editar este movimiento? Quien lo registró siempre; la pareja, si es del hogar y ya está confirmado. */
export function canEditTransaction(tx: Transaction, meId: string): "owner" | "partner" | null {
  if (tx.kind === "SETTLEMENT") return null;
  if (tx.created_by === meId) return "owner";
  if (tx.scope === "HOUSEHOLD" && tx.status === "CONFIRMED" && PARTNER_EDITABLE.includes(tx.kind)) return "partner";
  return null;
}

export function TransactionSheet({
  open, onOpenChange, editing, preset = null,
}: { open: boolean; onOpenChange: (v: boolean) => void; editing: Transaction | null; preset?: TxPreset | null }) {
  const state = useFinance();
  const router = useRouter();
  const { me, partner, accounts, categories, labels, supabase, reload, memberById } = state;

  const myAccounts = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived);
  // Destinos de una transferencia: mis cuentas y las tarjetas o créditos de mi pareja que me toca pagar
  const transferTargets = [...myAccounts, ...accounts.filter((a) => a.owner_user_id !== me.user_id && !a.archived
    && a.responsible_user_id === me.user_id && ["CREDIT_CARD", "CREDIT", "LOAN"].includes(a.kind))];
  const usable = categories.filter((c) => !c.archived && c.kind !== "INCOME");
  const incomeCategories = categories.filter(
    (c) => !c.archived && c.kind === "INCOME",
  );

  const access = editing ? canEditTransaction(editing, me.user_id) : "owner";
  const partnerEdit = access === "partner";
  const isPendingReview = editing?.status === "PENDING_REVIEW";
  const payerId = editing?.payer_user_id ?? me.user_id;
  const payer = memberById(payerId);

  const [kind, setKind] = useState<FormKind>("EXPENSE");
  const [scope, setScope] = useState<Space>("PERSONAL");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayBogota());
  const [accountId, setAccountId] = useState<string>("");
  const [toAccountId, setToAccountId] = useState<string>("");
  /** Transferencia hacia la pareja: sale de mi cuenta y él me la debe en el cruce hasta que compre. */
  const [toPartner, setToPartner] = useState(false);
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [categoryId, setCategoryId] = useState<string>("");
  const [responsibleId, setResponsibleId] = useState<string>(me.user_id);
  const [splitMode, setSplitMode] = useState(false);
  /** “Más opciones”: dividir por montos y etiquetas (abierto si ya hay etiquetas). */
  const [more, setMore] = useState(false);
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [createsDebt, setCreatesDebt] = useState(true);
  /** Compras con tarjeta de crédito: número de cuotas. */
  const [installments, setInstallments] = useState("1");
  /** Tasa E.A. de esta compra (la del extracto); vacío = la de la tarjeta. */
  const [purchaseRate, setPurchaseRate] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [incomeCategoryId, setIncomeCategoryId] = useState("");
  const [scheduled, setScheduled] = useState<{ id: string; for: string } | null>(null);
  const [newCategory, setNewCategory] = useState<"EXPENSE" | "INCOME" | null>(null);
  const [fixedPrompt, setFixedPrompt] = useState<FixedPrompt | null>(null);
  const [remember, setRemember] = useState(true);
  const [autoApply, setAutoApply] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cargar el formulario al abrir
  useEffect(() => {
    if (!open) return;
    setError(null);
    setFixedPrompt(null);
    setBusy(false);
    setTagIds(editing ? state.txTags[editing.id] ?? [] : []);
    setMore(false);
    setToPartner(false);
    if (editing) {
      setKind(editing.kind === "SETTLEMENT" ? "EXPENSE" : editing.kind);
      setScope(editing.scope ?? "PERSONAL");
      setAmount(String(editing.amount));
      setDescription(editing.description ?? editing.merchant ?? "");
      setDate(editing.occurred_on);
      setAccountId(editing.account_id ?? "");
      setToAccountId(editing.to_account_id ?? "");
      setDirection(editing.direction ?? "OUT");
      setCreatesDebt(editing.creates_debt ?? true);
      setInstallments(String(editing.installments ?? 1));
      setPurchaseRate(editing.interest_rate_ea ? String(editing.interest_rate_ea).replace(".", ",") : "");
      setIncomeCategoryId(editing.income_category_id ?? "");
      setScheduled(editing.scheduled_payment_id && editing.scheduled_for ? { id: editing.scheduled_payment_id, for: editing.scheduled_for } : null);
      const sp = editing.splits;
      if (sp.length > 1) {
        setSplitMode(true);
        setSplits(sp.map((s) => ({ key: s.id, amount: String(s.amount), categoryId: s.category_id ?? "", responsibleId: s.responsible_user_id })));
      } else {
        setSplitMode(false);
        const pendingCat = editing.status === "PENDING_REVIEW" && !sp[0]?.category_id ? editing.suggested_category_id ?? "" : "";
        setCategoryId(sp[0]?.category_id ?? pendingCat);
        setResponsibleId(pendingCat ? (editing.suggested_responsible_user_id ?? me.user_id) : (sp[0]?.responsible_user_id ?? payerId));
        // Un aviso que llegó solo queda personal; al revisarlo se propone el último espacio usado
        if (editing.status === "PENDING_REVIEW") setScope(lastScope());
      }
      setRemember(true);
      setAutoApply(true);
      // Un pago de tarjeta que llegó solo se revisa como transferencia hacia la tarjeta
      if (editing.status === "PENDING_REVIEW" && editing.movement_type === "CARD_PAYMENT") {
        setKind("TRANSFER");
        const card = editing.suggested_to_account_id ?? "";
        setToAccountId(card);
        if (card && editing.account_id === card) setAccountId("");
      }
      return;
    }
    let last = "";
    try { last = localStorage.getItem(LAST_ACCOUNT_KEY) ?? ""; } catch {}
    const presetCategory = preset?.categoryId ? usable.find((c) => c.id === preset.categoryId) ?? null : null;
    setKind(preset?.kind ?? "EXPENSE");
    setAmount(preset?.amount && preset.amount > 0 ? String(preset.amount) : "");
    setDescription(preset?.description ?? (presetCategory ? presetCategory.name : ""));
    setDate(preset?.date ?? todayBogota());
    setAccountId(myAccounts.some((a) => a.id === last) ? last : (myAccounts[0]?.id ?? ""));
    setToAccountId(preset?.toAccountId ?? "");
    setToPartner(false);
    setDirection("OUT");
    setCategoryId(presetCategory?.id ?? "");
    // Desde un presupuesto: su espacio y quien lo asume. Si no: quien paga y el último espacio usado.
    setResponsibleId(preset?.responsibleId ?? me.user_id);
    setScope(preset?.scope ?? lastScope());
    // Vencimiento compartido: ya dividido, una parte por persona en la misma categoría
    const shares = (preset?.shares ?? []).filter((x) => x.amount > 0);
    setSplitMode(shares.length > 1);
    setSplits(shares.length > 1 ? shares.map((x) => ({ key: newKey(), amount: String(x.amount), categoryId: presetCategory?.id ?? "", responsibleId: x.userId })) : []);
    setCreatesDebt(true);
    setInstallments("1");
    setPurchaseRate("");
    setIncomeCategoryId("");
    setScheduled(preset?.scheduledPaymentId && preset.scheduledFor ? { id: preset.scheduledPaymentId, for: preset.scheduledFor } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, preset]);

  const total = parseCop(amount) ?? 0;
  // Compra con tarjeta de crédito: se puede diferir a cuotas (cada mes cuenta su cuota en el presupuesto)
  const payAccount = accounts.find((a) => a.id === accountId) ?? null;
  const isCardPurchase = kind === "EXPENSE" && payAccount?.kind === "CREDIT_CARD" && !partnerEdit;
  const installmentCount = Math.min(MAX_INSTALLMENTS, Math.max(1, Number.parseInt(installments, 10) || 1));
  const parsedPurchaseRate = purchaseRate.trim() ? Number(purchaseRate.replace(",", ".")) : null;
  const effectiveRate = rateOf({ interest_rate_ea: parsedPurchaseRate ?? null }, { interest_rate_ea: payAccount?.interest_rate_ea ?? null });
  const installmentHint = (() => {
    if (!isCardPurchase || installmentCount <= 1) return "Cada mes cuenta su cuota en el presupuesto.";
    const plan = installmentPlan(total, installmentCount, date, effectiveRate);
    const interest = plan.reduce((a, c) => a + c.interest, 0);
    const first = plan[0];
    const base = `${installmentCount} cuotas de ${formatCop(plan[plan.length - 1]?.capital ?? 0)} de capital; en el presupuesto cuenta una por mes.`;
    if (!effectiveRate) return `${base} Escribe la tasa de la tarjeta en Cuentas o la de esta compra para estimar los intereses.`;
    return `${base} Primera cuota ≈ ${formatCop(first?.total ?? 0)} con intereses; intereses estimados en total ≈ ${formatCop(interest)} (${effectiveRate} % E.A.).`;
  })();
  const selectedCategory = usable.find((c) => c.id === categoryId) ?? null;
  const withSplits = hasSplits(kind);
  // Los comentarios van justo después de la categoría; sin categoría (transferencias, ajustes) quedan al final
  const commentsBlock = editing ? <TransactionComments txId={editing.id} /> : null;
  const kindGroup: KindGroup = OTHER_KINDS.includes(kind) ? "OTHER" : (kind as KindGroup);
  const scheduledPayment = scheduled ? state.commitments.find((c) => c.id === scheduled.id) ?? null : null;

  function chooseScope(s: Space) {
    setScope(s);
  }

  // La categoría solo dice en qué se gastó: no cambia quién lo asume ni si es del hogar o personal.
  function pickCategory(c: Category) {
    setCategoryId(c.id);
  }

  const memberOptions = [me, partner].filter(Boolean).map((m) => ({
    value: m!.user_id,
    label: m!.user_id === me.user_id ? "Yo" : m!.display_name,
    color: m!.color,
  }));

  // Categorías que puede elegir cada responsable en el desglose: las privadas solo su dueño y solo en lo personal.
  const categoriesFor = (_userId: string) => usable;

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
  // Partes que le corresponden a alguien distinto de quien pagó
  const crossedAmount = withSplits ? splitDrafts.filter((s) => s.responsibleUserId !== payerId).reduce((a, s) => a + s.amount, 0) : 0;
  const otherId = splitDrafts.find((s) => s.responsibleUserId !== payerId)?.responsibleUserId ?? null;

  const fixedContext = useMemo(() => {
    if (kind !== "EXPENSE" || splitMode || !selectedCategory || !partner || partnerEdit || scope !== "HOUSEHOLD") return null;
    // Presupuesto del hogar de montos fijos en esta categoría
    const limit = state.limits.find((l) => l.category_id === selectedCategory.id && l.scope === "HOUSEHOLD" && l.responsibility === "FIXED_AMOUNTS");
    if (!limit || responsibleId !== me.user_id) return null;
    const period = periodFor(state.settings, date);
    const st = statusesFor(state, period).get(limit.id);
    if (!st) return null;
    const mine = st.allocations.find((a) => a.userId === me.user_id);
    const theirs = st.allocations.find((a) => a.userId === partner.user_id);
    if (!mine || !theirs) return null;
    // Al editar, lo ya guardado de este mismo movimiento no cuenta como gastado
    const own = editing?.splits.filter((s) => s.category_id === selectedCategory.id && s.responsible_user_id === me.user_id)
      .reduce((acc, s) => acc + s.amount, 0) ?? 0;
    const sameCat = editing && editing.occurred_on >= period.start && editing.occurred_on <= period.end ? own : 0;
    return { mine: { ...mine, spent: mine.spent - sameCat }, theirs };
  }, [kind, splitMode, selectedCategory, partner, partnerEdit, scope, responsibleId, me.user_id, state, date, editing]);

  const online = () => !state.offline && (typeof navigator === "undefined" || navigator.onLine !== false);

  /**
   * Guarda con save_transaction. Un movimiento nuevo lleva un id de envío (no se duplica si se reenvía) y,
   * sin conexión, queda en la cola del celular para enviarse cuando vuelva internet.
   */
  async function submit(id: string | null, p: Record<string, unknown>, tags: string[], queueable: boolean):
    Promise<{ queued: true } | { queued: false; data: unknown; error: { message: string } | null }> {
    if (id || !queueable) {
      const r = await supabase.rpc("save_transaction", { p });
      return { queued: false, data: r.data, error: r.error };
    }
    const item: QueuedTx = { client_id: newClientId(), queued_at: new Date().toISOString(), payload: p, tagIds: tags };
    if (!online()) {
      await state.enqueue(item);
      return { queued: true };
    }
    const r = await supabase.rpc("save_transaction_once", { p: { ...p, client_id: item.client_id } });
    if (r.error && isNetworkError(r.error)) {
      await state.enqueue(item);
      return { queued: true };
    }
    return { queued: false, data: r.data, error: r.error };
  }

  function finishQueued() {
    setBusy(false);
    try {
      if (accountId) localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
      if (kind !== "TRANSFER" && kind !== "ADJUSTMENT") localStorage.setItem(LAST_SCOPE_KEY, scope);
    } catch {}
    onOpenChange(false);
  }

  /** Lo que se dictó o se leyó del recibo llena el formulario; la persona revisa y guarda. */
  function applyCapture(r: CaptureResult) {
    const k = r.kind ?? kind;
    if (r.kind) {
      setKind(r.kind);
      if (r.kind === "TRANSFER") setToPartner(false);
    }
    if (r.amount) setAmount(String(r.amount));
    if (r.description) setDescription(r.description);
    if (r.date) setDate(r.date);
    if (r.installments) setInstallments(String(r.installments));
    if (r.accountId && myAccounts.some((a) => a.id === r.accountId)) setAccountId(r.accountId);
    if (r.toAccountId && transferTargets.some((a) => a.id === r.toAccountId)) setToAccountId(r.toAccountId);
    if (r.categoryId) {
      if (k === "INCOME" && incomeCategories.some((c) => c.id === r.categoryId)) setIncomeCategoryId(r.categoryId);
      else if (k !== "INCOME" && usable.some((c) => c.id === r.categoryId)) setCategoryId(r.categoryId);
    }
    setError(null);
  }

  /** Envío a la pareja: se registra como liquidación (sale de mi cuenta, llega a la suya y queda en el cruce). */
  async function saveToPartner() {
    if (!partner) return setError("Tu pareja todavía no se ha unido al hogar.");
    if (!accountId) return setError("Elige de qué cuenta sale.");
    if (editing && isPendingReview && !online()) return setError("Sin conexión: para revisar un aviso necesitas internet.");
    setBusy(true);
    const sent = await submit(null, {
      kind: "SETTLEMENT",
      amount: total,
      occurred_on: date,
      description: description.trim() || `Envío a ${partner.display_name}`,
      account_id: accountId,
      to_account_id: toAccountId || null,
      counterparty_user_id: partner.user_id,
      creates_debt: createsDebt,
      tags: [],
    }, editing && isPendingReview ? [] : tagIds, !(editing && isPendingReview));
    if (sent.queued) return finishQueued();
    const { data: savedId, error } = sent;
    if (!error && savedId && editing && isPendingReview) {
      // Era un aviso por revisar (ej. "Cuenta ···4993"): el aviso pasa al envío y el pendiente se quita
      await supabase.from("ingest_logs").update({ transaction_id: savedId, result: "ACCEPTED", reason: "Registrado como envío a la pareja" }).eq("transaction_id", editing.id);
      const del = await supabase.rpc("delete_transaction", { p_id: editing.id });
      if (del.error) {
        setBusy(false);
        void reload();
        return setError(`Se registró el envío, pero no pude quitar el pendiente: ${errMsg(del.error)}. Bórralo a mano.`);
      }
    }
    if (!error && savedId) {
      const { add } = diffTags([], tagIds);
      if (add.length > 0) await supabase.from("transaction_tags").insert(add.map((tag_id) => ({ transaction_id: savedId as string, tag_id, household_id: state.household.id })));
    }
    if (!error && preset?.logId && savedId) {
      await supabase.from("ingest_logs").update({ result: "ACCEPTED", reason: "Registrado a mano", transaction_id: savedId }).eq("id", preset.logId);
    }
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  async function save(chargeExcess?: number) {
    setError(null);
    if (total <= 0) return setError("Escribe el monto.");
    if (kind === "TRANSFER" && toPartner) return saveToPartner();
    if (kind !== "TRANSFER" && !accountId) return setError("Elige la cuenta.");

    let payloadSplits: (SplitDraft & { origin?: string })[] = [];
    if (withSplits) {
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

    if (editing && !online()) return setError("Sin conexión: para editar un movimiento necesitas internet. Los nuevos sí se guardan y se envían después.");
    setBusy(true);
    const sent = await submit(editing?.id ?? null, {
        id: editing?.id ?? null,
        kind,
        scope,
        amount: total,
        occurred_on: date,
        description,
        merchant: editing?.merchant ?? null,
        tags: editing?.tags ?? [],
        account_id: accountId || null,
        to_account_id: kind === "TRANSFER" ? toAccountId : null,
        direction: kind === "ADJUSTMENT" ? direction : null,
        installments: isCardPurchase ? installmentCount : 1,
        interest_rate_ea: isCardPurchase && installmentCount > 1 ? parsedPurchaseRate : null,
        creates_debt: createsDebt,
        is_shared: kind === "INCOME" && scope === "HOUSEHOLD",
        income_category_id: kind === "INCOME" ? incomeCategoryId || null : null,
        scheduled_payment_id: scheduled && (kind === "EXPENSE" || kind === "DEBT_PAYMENT") ? scheduled.id : null,
        scheduled_for: scheduled && (kind === "EXPENSE" || kind === "DEBT_PAYMENT") ? scheduled.for : null,
        splits: withSplits ? payloadSplits.map((s) => ({
          amount: s.amount,
          category_id: s.categoryId,
          responsible_user_id: s.responsibleUserId,
          origin: s.origin ?? "NORMAL",
        })) : [],
    }, tagIds, !editing);
    if (sent.queued) return finishQueued();
    const { data: savedId, error } = sent;
    if (!error && isPendingReview && kind === "EXPENSE" && !splitMode && remember && (editing?.merchant_norm || (editing?.splits.length ?? 0) > 0)) {
      await supabase.rpc("remember_merchant", { p_transaction_id: editing!.id, p_auto_apply: autoApply });
    }
    if (!error && savedId) {
      // Etiquetas: se agregan o quitan solo las que cambiaron
      const { add, remove } = diffTags(editing ? state.txTags[editing.id] ?? [] : [], tagIds);
      if (remove.length > 0) await supabase.from("transaction_tags").delete().eq("transaction_id", savedId as string).in("tag_id", remove);
      if (add.length > 0) await supabase.from("transaction_tags").insert(add.map((tag_id) => ({ transaction_id: savedId as string, tag_id, household_id: state.household.id })));
    }
    if (!error && preset?.logId && savedId) {
      await supabase.from("ingest_logs").update({ result: "ACCEPTED", reason: "Registrado a mano", transaction_id: savedId }).eq("id", preset.logId);
    }
    setBusy(false);
    if (error) return setError(errMsg(error));
    try {
      if (accountId && !partnerEdit) localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
      if (!partnerEdit && kind !== "TRANSFER" && kind !== "ADJUSTMENT") localStorage.setItem(LAST_SCOPE_KEY, scope);
    } catch {}
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

  if (editing && !access) {
    return <TransactionDetail open={open} onOpenChange={onOpenChange} tx={editing} />;
  }

  const partnerName = partner?.display_name ?? "tu pareja";
  const nameOf = (id: string | null) => (id === me.user_id ? "tú" : memberById(id)?.display_name ?? "tu pareja");
  const title = isPendingReview ? "Revisar movimiento" : editing ? (partnerEdit ? "Ajustar movimiento" : "Editar movimiento")
    : scheduledPayment ? "Pagar vencimiento" : preset?.categoryId ? "Registrar pago" : "Registrar";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}
      footer={myAccounts.length === 0 && !partnerEdit ? undefined : fixedPrompt ? undefined : (
        <div className="space-y-2">
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-3">
            {editing && access === "owner" && (
              <Button variant="danger" size="icon" className="h-14 w-14" onClick={remove} disabled={busy} aria-label="Borrar">
                <Trash2 size={18} />
              </Button>
            )}
            <Button className="flex-1" size="lg" disabled={busy} onClick={() => save()}>
              {busy ? "Guardando..." : isPendingReview ? "Confirmar" : "Guardar"}
            </Button>
          </div>
        </div>
      )}>
      {myAccounts.length === 0 && !partnerEdit ? (
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
          {isPendingReview && (
            <p className="rounded-2xl bg-warning-soft px-3 py-2.5 text-sm">
              Llegó automáticamente{editing?.source ? ` (${CHANNEL_LABEL[editing.source] ?? editing.source})` : ""}. Revisa los datos y guarda para confirmarlo.
            </p>
          )}
          {partnerEdit && (
            <p className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2.5 text-sm">
              <MemberBadge member={payer} size={22} />
              <span>Lo registró {payer?.display_name}: sigue figurando como quien pagó, con la misma cuenta. Tú puedes ajustar el resto.</span>
            </p>
          )}
          {scheduledPayment && (
            <p className="rounded-2xl bg-olive-soft px-3 py-2.5 text-sm">
              Paga el vencimiento <strong>{scheduledPayment.name}</strong> del {formatDay(scheduled!.for)}: deja de contar como comprometido.
              <button className="ml-1 text-muted underline" onClick={() => setScheduled(null)}>Quitar</button>
            </p>
          )}

          {(!editing || isPendingReview) && (
            <>
              <Segmented value={kindGroup} onChange={(g) => setKind(g === "OTHER" ? "DEBT_PAYMENT" : g)} options={[
                { value: "EXPENSE", label: "Gasto" },
                { value: "INCOME", label: "Ingreso" },
                { value: "TRANSFER", label: "Transferir" },
                { value: "OTHER", label: "Otro" },
              ]} />
              {kindGroup === "OTHER" && (
                <ChipGroup value={kind} onChange={setKind}
                  options={OTHER_KINDS.map((k) => ({ value: k, label: TX_KIND_LABEL[k] }))} />
              )}
            </>
          )}
          {editing && !isPendingReview && <p className="text-sm font-medium text-muted">{TX_KIND_LABEL[kind]}</p>}
          {KIND_HINT[kind] && <p className="-mt-2 text-xs text-muted">{KIND_HINT[kind]}</p>}

          {!editing && (
            <QuickCapture
              offline={state.offline}
              accounts={myAccounts.map((a) => ({ id: a.id, name: a.name }))}
              categories={usable.map((c) => ({ id: c.id, name: categoryPath(categories, c.id) }))}
              incomeCategories={incomeCategories.map((c) => ({ id: c.id, name: c.name }))}
              onResult={applyCapture}
              autoStart={!!preset?.voice}
            />
          )}

          <AmountInput large value={amount} onChange={setAmount} autoFocus={!editing && !preset} />

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder={kind === "INCOME" ? "¿De dónde? (salario, venta…)" : kind === "TRANSFER" || kind === "ADJUSTMENT" ? "Nota (opcional)" : kind === "REFUND" ? "¿Qué te devolvieron?" : "¿En qué?"}
              aria-label="Descripción" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[150px]" aria-label="Fecha" />
          </div>

          {partnerEdit ? (
            <p className="text-sm text-muted">Pagó {payer?.display_name} con {accountLabel(labels, accountId || null)}</p>
          ) : (
            <Field label={kind === "INCOME" || kind === "REFUND" ? "Entró a" : kind === "TRANSFER" ? "Sale de" : kind === "ADJUSTMENT" ? "Cuenta" : "Pagué con"}>
              <ChipGroup value={accountId} onChange={setAccountId}
                options={myAccounts.filter((a) => kind === "TRANSFER" || kind === "ADJUSTMENT" || !["CREDIT", "LOAN"].includes(a.kind) || a.id === accountId)
                  .map((a) => ({ value: a.id, label: accountLabel(labels, a.id) }))} />
            </Field>
          )}

          {isCardPurchase && (
            <Field label="Cuotas" htmlFor="cuotas" hint={installmentHint}>
              <Select id="cuotas" value={String(installmentCount)} onChange={(e) => setInstallments(e.target.value)} aria-label="Número de cuotas">
                {Array.from({ length: MAX_INSTALLMENTS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n === 1 ? "1 cuota (sin cuotas)" : `${n} cuotas`}</option>
                ))}
              </Select>
              {installmentCount > 1 && (
                <div className="mt-2">
                  <Input inputMode="decimal" value={purchaseRate} placeholder={`Tasa E.A. de esta compra (vacío = ${payAccount?.interest_rate_ea ?? "la de la tarjeta"})`}
                    onChange={(e) => setPurchaseRate(e.target.value.replace(/[^\d,.]/g, "").slice(0, 6))} aria-label="Tasa efectiva anual de esta compra" />
                </div>
              )}
            </Field>
          )}

          {kind === "TRANSFER" && !partnerEdit && (
            <Segmented value={toPartner ? "PARTNER" : "MINE"} onChange={(v) => { setToPartner(v === "PARTNER"); setToAccountId(""); }} options={[
              { value: "MINE", label: "A mis cuentas" },
              { value: "PARTNER", label: `A ${partner?.display_name ?? "mi pareja"}` },
            ]} />
          )}

          {kind === "TRANSFER" && !toPartner && (
            <Field label="Llega a" hint="Para pagar una tarjeta, elige la tarjeta como destino. No consume presupuesto.">
              <ChipGroup value={toAccountId} onChange={setToAccountId}
                options={transferTargets.filter((a) => a.id !== accountId).map((a) => ({ value: a.id, label: accountLabel(labels, a.id) }))} />
            </Field>
          )}

          {kind === "TRANSFER" && toPartner && !partner && (
            <div className="space-y-2 rounded-2xl bg-wood-soft px-3 py-3 text-sm">
              <p><strong>Tu pareja todavía no está en el hogar.</strong> Para enviarle plata (por ejemplo para que haga una compra) y que quede anotado en el cruce, primero tiene que unirse.</p>
              <p className="text-muted">Pásale este enlace; con su cuenta creada podrás elegir sus cuentas aquí.</p>
              <p className="break-all rounded-xl bg-surface px-3 py-2 text-xs">{typeof window !== "undefined" ? `${window.location.origin}/unirse/${state.household.invite_code}` : state.household.invite_code}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => { try { void navigator.clipboard.writeText(`${window.location.origin}/unirse/${state.household.invite_code}`); } catch {} }}>Copiar enlace</Button>
            </div>
          )}

          {kind === "TRANSFER" && toPartner && partner && (
            <div className="space-y-3">
              {labels.some((l) => l.owner_user_id === partner.user_id && !["CREDIT_CARD", "LOAN"].includes(l.kind)) && (
                <Field label={`Llega a la cuenta de ${partner.display_name} (opcional)`}>
                  <ChipGroup value={toAccountId} onChange={(v) => setToAccountId(v === toAccountId ? "" : v)}
                    options={labels.filter((l) => l.owner_user_id === partner.user_id && !["CREDIT_CARD", "LOAN"].includes(l.kind)).map((l) => ({ value: l.id, label: accountLabel(labels, l.id) }))} />
                </Field>
              )}
              <div className="rounded-2xl border border-border bg-surface px-3">
                <SwitchRow label={`Anotar como deuda de ${partner.display_name}`}
                  hint={createsDebt
                    ? `Queda en el cruce: ${partner.display_name} te debe este dinero. Cuando haga la compra y la registre a tu cargo, el cruce se compensa solo.`
                    : "Solo mueve la plata entre cuentas; el cruce no cambia (ej. un regalo o plata que ya era de él)."}
                  checked={createsDebt} onCheckedChange={setCreatesDebt} />
              </div>
            </div>
          )}

          {kind === "ADJUSTMENT" && (
            <Segmented value={direction} onChange={setDirection} options={[
              { value: "IN", label: "Suma al saldo" },
              { value: "OUT", label: "Resta del saldo" },
            ]} />
          )}

          {kind === "INCOME" && !partnerEdit && (
            <Field label="Categoría del ingreso (opcional)">
              <div className="flex flex-wrap gap-2">
                {incomeCategories.map((c) => (
                  <button key={c.id} type="button" onClick={() => setIncomeCategoryId(c.id === incomeCategoryId ? "" : c.id)} aria-pressed={c.id === incomeCategoryId}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm ${c.id === incomeCategoryId ? "border-olive bg-olive-soft font-semibold" : "border-border bg-surface text-muted"}`}>
                    <span>{c.icon || "•"}</span>{categoryPath(incomeCategories, c.id)}
                  </button>
                ))}
                <button type="button" onClick={() => setNewCategory("INCOME")}
                  className="flex items-center gap-1 rounded-full border border-dashed border-olive px-3 py-2 text-sm font-medium text-olive">
                  <Plus size={15} /> Nueva
                </button>
              </div>
            </Field>
          )}

          {withSplits && !splitMode && (
            <>
              <Field label="Categoría">
                <CategoryPicker categories={usable} value={categoryId}
                  onPick={pickCategory} onNew={partnerEdit ? undefined : () => setNewCategory("EXPENSE")} />
              </Field>

              {partner && (
                <Field label="¿A quién le corresponde?" hint={preset?.categoryId && !editing ? "Propuesto por el presupuesto de la categoría; puedes cambiarlo. No tiene que ser quien pagó." : "Quién asume económicamente el gasto; no tiene que ser quien pagó."}>
                  <ChipGroup value={responsibleId} onChange={setResponsibleId}
                    options={memberOptions} />
                </Field>
              )}
            </>
          )}

          {withSplits && splitMode && (
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
                    <option value="">{s.responsibleId === me.user_id ? "Sin categoría" : `Sin categoría (la elige ${nameOf(s.responsibleId)})`}</option>
                    <CategoryOptions categories={categoriesFor(s.responsibleId)} />
                  </Select>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSplits([...splits, { key: newKey(), amount: remaining > 0 ? String(remaining) : "", categoryId: "", responsibleId: payerId }])}>
                  <Plus size={16} /> Agregar parte
                </Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  const f = splits[0];
                  setSplitMode(false);
                  setCategoryId(f?.categoryId ?? "");
                  setResponsibleId(f?.responsibleId ?? payerId);
                }}>
                  Sin dividir
                </Button>
              </div>
            </div>
          )}

          {crossedAmount > 0 && otherId && (
            <div className="space-y-2 rounded-2xl bg-wood-soft px-3 py-2.5 text-sm">
              <p className="flex items-center gap-2">
                <ArrowRightLeft size={16} className="shrink-0 text-wood" />
                {kind === "REFUND"
                  ? <>El reembolso entró a la cuenta de {nameOf(payerId)}, pero {formatCop(crossedAmount)} eran de {nameOf(otherId)}.</>
                  : <>Pagó {nameOf(payerId)}; {formatCop(crossedAmount)} le corresponden a {nameOf(otherId)}.</>}
              </p>
              <p className="font-medium">¿Se anota como deuda en el cruce?</p>
              <Segmented value={createsDebt ? "YES" : "NO"} onChange={(v) => setCreatesDebt(v === "YES")} options={[
                { value: "YES", label: kind === "REFUND" ? `Sí, ${nameOf(payerId)} se la debe` : `Sí, ${nameOf(otherId)} la debe` },
                { value: "NO", label: "No, sin deuda" },
              ]} />
              {!createsDebt && <p className="text-xs text-muted">Queda a cargo de {nameOf(otherId)} en los informes, sin cobrarse.</p>}
            </div>
          )}

          {!partnerEdit ? (
            <Field label="¿De qué espacio es?">
              <Segmented value={scope} onChange={chooseScope} options={[
                { value: "HOUSEHOLD", label: "Hogar" },
                { value: "PERSONAL", label: "Personal" },
              ]} />
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted">
                {scope === "HOUSEHOLD"
                  ? <><Home size={13} className="mt-px shrink-0" /> Lo ven los dos y cuenta en el hogar, aunque la cuenta sea personal (su nombre no se muestra si es privada).</>
                  : <><Lock size={13} className="mt-px shrink-0" /> Solo lo ves tú{partner ? ` (y ${partnerName} solo si le asignas una parte)` : ""}. No entra en los informes del hogar.</>}
              </p>
            </Field>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted"><Home size={13} /> Movimiento del hogar</p>
          )}

          {isPendingReview && kind === "EXPENSE" && !splitMode && (
            <div className="rounded-2xl border border-border bg-surface px-3">
              <SwitchRow label="Recordar este comercio" hint="La próxima vez te sugiero la misma categoría, responsable y espacio."
                checked={remember} onCheckedChange={setRemember} />
              {remember && (
                <SwitchRow label="Aplicar siempre sin preguntar" hint="Se confirma solo cuando llegue otro pago igual."
                  checked={autoApply} onCheckedChange={setAutoApply} />
              )}
            </div>
          )}

          {more || tagIds.length > 0 ? (
            <div className="space-y-4">
              {withSplits && !splitMode && (
                <Button variant="outline" size="sm" onClick={startSplit} disabled={!total}>
                  <Scissors size={16} /> Dividir por montos
                </Button>
              )}
              <Field label="Etiquetas (opcional)">
                <TagPicker value={tagIds} onChange={setTagIds} />
              </Field>
            </div>
          ) : (
            <button type="button" onClick={() => setMore(true)} className="flex items-center gap-1 text-sm font-semibold text-olive">
              <Plus size={15} /> Más opciones{withSplits && !splitMode ? " (dividir, etiquetas)" : " (etiquetas)"}
            </button>
          )}

          {commentsBlock}
        </div>
      )}
      <CategorySheet open={newCategory !== null} onOpenChange={(v) => !v && setNewCategory(null)} category={null}
        kind={newCategory ?? "EXPENSE"}
        onSaved={(id) => {
          if (newCategory === "INCOME") setIncomeCategoryId(id);
          else {
            setCategoryId(id);
            setResponsibleId(me.user_id);
          }
          setNewCategory(null);
        }} />
    </Sheet>
  );
}

/** Vista de solo lectura (movimientos personales de la pareja en los que participo, o liquidaciones). */
function TransactionDetail({ open, onOpenChange, tx }: { open: boolean; onOpenChange: (v: boolean) => void; tx: Transaction }) {
  const state = useFinance();
  const { me, categories, labels, supabase, reload, memberById } = state;
  const [error, setError] = useState<string | null>(null);
  const payer = memberById(tx.payer_user_id);
  const hiddenAmount = hasSplits(tx.kind) ? tx.amount - tx.splits.reduce((a, s) => a + s.amount, 0) : 0;
  const myCategories = categories.filter((c) => !c.archived && c.kind !== "INCOME"
);

  async function setCategory(splitId: string, categoryId: string) {
    setError(null);
    const { error } = await supabase.rpc("set_split_category", { p_split_id: splitId, p_category_id: categoryId || null });
    if (error) setError(errMsg(error));
    else void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.description || tx.merchant || TX_KIND_LABEL[tx.kind]}>
      <div className="space-y-4 pb-2">
        <p className="num font-display text-4xl">{formatCop(tx.amount)}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <MemberBadge member={payer} size={22} />
          {tx.kind === "SETTLEMENT" ? "Liquidación" : `${TX_KIND_LABEL[tx.kind]} · pagó ${payer?.user_id === me.user_id ? "yo" : payer?.display_name}`} ·{" "}
          {accountLabel(labels, tx.account_id)} · {tx.occurred_on} · {SPACE_LABEL[tx.scope]}
        </div>
        {tx.splits.map((s) => {
          const cat = categoryLabel(categories, s.category_id);
          const resp = memberById(s.responsible_user_id);
          return (
            <div key={s.id} className="space-y-2 rounded-2xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><MemberBadge member={resp} size={22} /> {cat.icon} {categoryPath(categories, s.category_id) || cat.name}</span>
                <span className="num font-semibold">{formatCop(s.amount)}</span>
              </div>
              {s.responsible_user_id === me.user_id && (
                <Select value={s.category_id ?? ""} aria-label="Categoría de mi parte" onChange={(e) => setCategory(s.id, e.target.value)}>
                  <option value="">Sin categoría</option>
                  <CategoryOptions categories={myCategories} />
                </Select>
              )}
            </div>
          );
        })}
        {hiddenAmount > 0 && <p className="text-sm text-muted">Y {formatCop(hiddenAmount)} en conceptos privados.</p>}
        <ErrorText>{error}</ErrorText>
        <p className="text-xs text-muted">
          {tx.kind === "SETTLEMENT"
            ? "Las liquidaciones no se editan."
            : "Es un movimiento personal de tu pareja: solo quien lo registró puede editarlo. Los del hogar los pueden ajustar los dos."}
        </p>
        {(state.txTags[tx.id] ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(state.txTags[tx.id] ?? []).map((id) => state.tags.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t).map((t) => (
              <span key={t.id} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">{t.name}</span>
            ))}
          </div>
        )}
        <TransactionComments txId={tx.id} />
      </div>
    </Sheet>
  );
}
