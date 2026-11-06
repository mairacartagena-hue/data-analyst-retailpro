"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileText, Landmark, ListChecks, Receipt } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useFinance, type FinanceState } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { StatementImport } from "@/components/StatementImport";
import { CardStatementPdf } from "@/components/CardStatementPdf";
import { ManualCrossCheck } from "@/components/CardStatements";
import { ReconcileStep } from "@/components/ReconcileStep";
import { CreditPaymentAdjust } from "@/components/CreditPaymentAdjust";
import { creditMonthBreakdown } from "@/lib/finance/creditPayments";
import { Segmented } from "@/components/ui/segmented";
import { Collapsible } from "@/components/ui/collapsible";
import { InfoNote } from "@/components/ui/info-note";
import type { Account } from "@/lib/types";
import { ACCOUNT_KIND_LABEL } from "@/lib/types";
import { acceptDrift, accountStatement, effectOn, gmfEstimate, monthRange, reconciliationDrift, shiftMonth, type GmfMode } from "@/lib/finance/reconcile";
import { formatCop, parseCop } from "@/lib/finance/money";
import { addDays, monthName, periodFor, todayBogota } from "@/lib/finance/periods";
import { statusesFor } from "@/lib/finance/derive";
import { isCreditKind } from "@/lib/finance/credit";
import { cn, errMsg } from "@/lib/utils";

const FEES = [
  { key: "gmf", label: "4x1000 (GMF)", tag: "#gmf" },
  { key: "cuota", label: "Cuota de manejo", tag: "#banco" },
  { key: "intereses", label: "Intereses", tag: "#banco" },
  { key: "comision", label: "Comisión", tag: "#banco" },
  { key: "seguro", label: "Seguro", tag: "#banco" },
] as const;

type FeeKey = (typeof FEES)[number]["key"] | "unknown";

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${monthName(m - 1, true)} ${y}`;
}

/** Busca una categoría de gastos por nombre o la crea (sin presupuesto). */
async function ensureCategory(state: FinanceState, sb: SupabaseClient, name: string, icon: string): Promise<string> {
  const existing = state.categories.find(
    (c) => !c.archived && c.kind !== "INCOME" && c.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;
  const { data, error } = await sb.rpc("save_category", {
    p: { name, icon },
  });
  if (error) throw error;
  return data as string;
}

export default function CierrePage() {
  const state = useFinance();
  // Una cuenta abierta a la vez: al entrar, la primera sin conciliar
  const [openId, setOpenId] = useState<string | null>(null);
  const { accounts, me, transactions, reconciliations, categories, period } = state;
  // Abre en el mes actual; los avisos y recordatorios llevan el mes que toca en ?mes=
  const [month, setMonth] = useState(() => todayBogota().slice(0, 7));
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("mes");
    if (q && /^\d{4}-\d{2}$/.test(q)) setMonth(q);
  }, []);
  const range = monthRange(month);
  const mine = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived);
  // Conciliadas que siguen cuadrando: si algo cambió después de conciliar, vuelven a faltar
  const done = mine.filter((a) => {
    const r = reconciliations.find((x) => x.account_id === a.id && x.month === range.start && x.status === "RECONCILED");
    return !!r && !reconciliationDrift(a, transactions, r);
  });
  const myAccounts = mine.filter((a) => !isCreditKind(a.kind));
  const myCredits = mine.filter((a) => isCreditKind(a.kind));
  const doneOf = (list: Account[]) => list.filter((a) => done.includes(a)).length;
  const [tab, setTab] = useState<"cuentas" | "creditos">("cuentas");
  // Al cambiar de pestaña o de mes vuelve a abrirse la primera pendiente (al conciliar una, se abre la siguiente)
  useEffect(() => setOpenId(null), [tab, month]);
  const shown = tab === "creditos" ? myCredits : myAccounts;

  // ¿Qué hace falta? Obligaciones del periodo que cierra el mes, pendientes y avisos sin reconocer
  const closingPeriod = periodFor(state.settings, range.end);
  const statuses = useMemo(() => statusesFor(state, closingPeriod), [state, closingPeriod]);
  const missingObligations = state.limits
    .filter((l) => l.is_household_obligation)
    .map((l) => ({ c: categories.find((x) => x.id === l.category_id), a: statuses.get(l.id)?.allocations.find((x) => x.userId === me.user_id) }))
    .filter((x): x is { c: NonNullable<typeof x.c>; a: typeof x.a } => !!x.c && !x.c.archived && !!x.a && x.a.remaining > 0);
  const pendingInMonth = transactions.filter(
    (t) => t.status === "PENDING_REVIEW" && t.payer_user_id === me.user_id && t.occurred_on >= range.start && t.occurred_on <= range.end,
  );
  const [unrecognized, setUnrecognized] = useState<number | null>(null);
  useEffect(() => {
    void state.supabase.from("ingest_logs").select("id", { count: "exact", head: true })
      .eq("user_id", me.user_id).in("result", ["UNRECOGNIZED", "ERROR", "DISCARDED"])
      .gte("received_at", `${range.start}T00:00:00-05:00`).lte("received_at", `${range.end}T23:59:59-05:00`)
      .then(({ count }) => setUnrecognized(count ?? 0));
  }, [state.supabase, me.user_id, range.start, range.end]);

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2 py-2">
        <Link href="/mas" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
        <h1 className="font-display text-3xl">Cierre del mes</h1>
      </div>

      <div className="flex items-center justify-between">
        <button className="rounded-full p-2 text-muted" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mes anterior"><ChevronLeft size={22} /></button>
        <div className="text-center">
          <p className="font-semibold capitalize">{monthLabel(month)}</p>
          <p className="text-xs text-muted">{done.length} de {mine.length} cuentas conciliadas</p>
        </div>
        <button className="rounded-full p-2 text-muted" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mes siguiente"><ChevronRight size={22} /></button>
      </div>

      <SectionTitle>¿Qué hace falta?</SectionTitle>
      <Card className="space-y-2 text-sm">
        {missingObligations.length === 0 && pendingInMonth.length === 0 && !unrecognized && done.length === mine.length ? (
          <p className="flex items-center gap-2 text-olive"><CheckCircle2 size={18} /> Todo al día este mes.</p>
        ) : (
          <>
            {missingObligations.map(({ c, a }) => (
              <p key={c.id} className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0 text-warning" />
                <span>{c.icon} <strong>{c.name}</strong>: falta registrar {formatCop(a!.remaining)}.</span></p>
            ))}
            {pendingInMonth.length > 0 && (
              <p className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0 text-warning" />
                <span>{pendingInMonth.length} movimiento{pendingInMonth.length === 1 ? "" : "s"} por revisar. <Link href="/movimientos?filtro=pendientes" className="font-semibold text-olive underline">Revisar</Link></span></p>
            )}
            {!!unrecognized && (
              <p className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0 text-warning" />
                <span>{unrecognized} aviso{unrecognized === 1 ? "" : "s"} sin reconocer. <Link href="/captura#sin-reconocer" className="font-semibold text-olive underline">Ver y reintentar</Link></span></p>
            )}
            {mine.length - done.length > 0 && (
              <p className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0 text-warning" />
                <span>{mine.length - done.length} cuenta{mine.length - done.length === 1 ? "" : "s"} sin conciliar (abajo).</span></p>
            )}
          </>
        )}
        {closingPeriod.start !== period.start && <p className="text-xs text-muted">Las obligaciones son las del periodo que termina el {range.end.slice(8)} de {monthName(Number(month.slice(5)) - 1, true)}.</p>}
      </Card>

      <SectionTitle>Conciliar</SectionTitle>
      <Segmented className="mb-3" value={tab} onChange={setTab} options={[
        { value: "cuentas", label: `Cuentas · ${doneOf(myAccounts)}/${myAccounts.length}` },
        { value: "creditos", label: `Créditos · ${doneOf(myCredits)}/${myCredits.length}` },
      ]} />
      {tab === "creditos" && shown.length > 0 && (
        <InfoNote className="-mt-1 mb-3">
          Compara la deuda de capital con el extracto del crédito. Si no cuadra, suele ser porque el reparto de alguna cuota (capital e intereses) no coincide con el banco: el ajuste corrige la deuda sin contar como gasto ni ingreso.
        </InfoNote>
      )}
      {shown.length === 0 ? (
        <p className="px-1 text-sm text-muted">{tab === "creditos" ? "No tienes créditos ni préstamos. Agrégalos en Cuentas → Créditos." : "No tienes cuentas. Agrégalas en Cuentas."}</p>
      ) : (
        <div className="space-y-3">{shown.map((a) => <AccountClose key={a.id} account={a} month={month}
          open={(openId ?? shown.find((x) => !reconciliations.some((r) => r.account_id === x.id && r.month === monthRange(month).start))?.id) === a.id}
          onToggle={() => setOpenId((cur) => (cur === a.id ? "" : a.id))} />)}</div>
      )}
    </main>
  );
}

function AccountClose({ account, month, open, onToggle }: { account: Account; month: string; open: boolean; onToggle: () => void }) {
  const state = useFinance();
  const { transactions, reconciliations, supabase, reload, uvt } = state;
  const { openTransaction } = useShell();
  // El cierre es siempre al final del mes; lo que el extracto no trae (en tarjetas, lo posterior al corte) va en partidas conciliatorias
  const range = useMemo(() => monthRange(month), [month]);
  const monthKey = range.start;
  const st = useMemo(() => accountStatement(account, transactions, range), [account, transactions, range]);
  // Créditos: lo que bajó el capital, sin los intereses y seguros de las cuotas cargados al crédito
  const cb = useMemo(() => creditMonthBreakdown(account, transactions, range, st.inflow, st.outflow), [account, transactions, range, st]);
  const rec = reconciliations.find((r) => r.account_id === account.id && r.month === monthKey);
  const drift = useMemo(() => (rec ? reconciliationDrift(account, transactions, rec) : null), [account, transactions, rec]);
  const isCard = account.kind === "CREDIT_CARD";
  const isCredit = isCreditKind(account.kind);
  const isDebt = isCard || isCredit;
  const [bank, setBank] = useState("");
  const [movesStatus, setMovesStatus] = useState<string | null>(null);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  useEffect(() => { setMovesStatus(null); setPdfStatus(null); }, [month]);
  const [fee, setFee] = useState<FeeKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBank(rec ? String(Math.abs(rec.statement_balance)) : "");
  }, [rec, month]);

  // En tarjetas se compara la deuda (positiva) con la del extracto
  const appValue = isDebt ? -st.closing : st.closing;
  const bankValue = parseCop(bank);
  const diff = bankValue === null ? null : isDebt ? appValue - bankValue : bankValue - appValue; // + sobra plata en el banco, − falta
  const gmfMode = (account.gmf_mode ?? "TAXED") as GmfMode;
  const gmf = !isDebt && account.kind !== "CASH" ? Math.max(0, gmfEstimate(st.gmfBase, gmfMode, uvt) - st.gmfRecorded) : 0;

  // Partidas conciliatorias: movimientos del mes que están en la app pero no en el saldo del banco o del extracto.
  // En tarjetas se sugieren los posteriores al día de corte (el banco los factura en el próximo extracto).
  const cutDate = isCard && account.statement_day
    ? `${month}-${String(Math.min(account.statement_day, Number(range.end.slice(8)))).padStart(2, "0")}` : null;
  const savedIds = (rec?.reconciling_items ?? []).flatMap((i) => (i.transaction_id ? [i.transaction_id] : []));
  const defaultPicked = (rec?.reconciling_items?.length ? savedIds : cutDate ? st.items.filter((t) => t.occurred_on > cutDate).map((t) => t.id) : []).join(",");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set(defaultPicked ? defaultPicked.split(",") : [])), [defaultPicked]);
  const pickedTxs = st.items.filter((t) => picked.has(t.id));
  const pickedEffect = pickedTxs.reduce((a, t) => a + effectOn(account.id, t), 0);
  // Diferencia que queda después de las partidas (misma convención que diff)
  const rest = diff === null ? null : diff + pickedEffect;
  const togglePick = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function saveClose(status: "RECONCILED" | "DIFFERENCE", appBalance: number) {
    const statement = isDebt ? -bankValue! : bankValue!;
    const reconcilingItems = pickedTxs.map((t) => ({
      transaction_id: t.id, amount: effectOn(account.id, t), description: t.merchant || t.description || "Movimiento", occurred_on: t.occurred_on,
    }));
    return supabase.from("account_reconciliations").upsert({
      household_id: account.household_id, account_id: account.id, owner_user_id: account.owner_user_id, month: monthKey,
      statement_balance: statement, app_balance: appBalance, status,
      // Conciliar de nuevo empieza de cero: nuevo momento de conciliación y las partidas marcadas
      reconciled_at: new Date().toISOString(), reconciling_items: reconcilingItems,
    }, { onConflict: "account_id,month" });
  }

  /** Deja lo que movió la cuenta como partidas conciliatorias: la conciliación sigue en el saldo del banco. */
  async function acceptItems() {
    if (!rec) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("account_reconciliations")
      .update({ reconciling_items: acceptDrift(account, transactions, rec) }).eq("id", rec.id);
    setBusy(false);
    if (error) return setError(errMsg(error));
    void reload();
  }

  const items = rec?.status === "RECONCILED" ? rec.reconciling_items ?? [] : [];

  /** Guarda el cierre tal cual: conciliada si cuadra; si no, queda "con diferencia" sin tocar el saldo. */
  async function markReconciled() {
    if (bankValue === null) return setError("Escribe el saldo que dice tu banco.");
    setBusy(true);
    setError(null);
    const { error } = await saveClose(rest === 0 ? "RECONCILED" : "DIFFERENCE", st.closing);
    setBusy(false);
    if (error) return setError(errMsg(error));
    void reload();
  }

  /**
   * Conciliar con ajuste: registra la diferencia como ajuste de saldo (no es gasto ni ingreso) para que la app
   * quede igual al banco o al extracto, y marca la cuenta como conciliada.
   */
  async function adjustAndReconcile() {
    if (bankValue === null) return setError("Escribe el saldo que dice tu banco.");
    if (rest === null || rest === 0) return markReconciled();
    setBusy(true);
    setError(null);
    try {
      const today = todayBogota();
      const { error } = await supabase.rpc("save_transaction", { p: {
        kind: "ADJUSTMENT", amount: Math.abs(rest), occurred_on: range.end < today ? range.end : today, account_id: account.id,
        // + el banco tiene más (o se debe menos) que la app: el ajuste suma al saldo; − resta
        direction: rest > 0 ? "IN" : "OUT", description: `Ajuste del saldo con el extracto (${account.name})`, tags: ["#conciliacion"],
      } });
      if (error) throw error;
      // La app queda igual al banco más las partidas conciliatorias
      const r = await saveClose("RECONCILED", (isDebt ? -bankValue : bankValue) + pickedEffect);
      if (r.error) throw r.error;
      void reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-0">
      <button className="flex w-full items-center gap-3 p-4 text-left" onClick={onToggle} aria-expanded={open}>
        <Landmark size={18} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{account.name}{account.last4 ? ` ··${account.last4}` : ""}</span>
          <span className="text-xs text-muted">{open ? ACCOUNT_KIND_LABEL[account.kind] : `${isDebt ? "Deuda" : "Saldo"} según la app ${formatCop(appValue)}`}</span>
        </span>
        {drift ? (
          <span className="flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold"><AlertCircle size={13} /> Se movió</span>
        ) : rec?.status === "RECONCILED" ? (
          <span className="flex items-center gap-1 rounded-full bg-olive-soft px-2 py-0.5 text-xs font-semibold"><CheckCircle2 size={13} /> Conciliada{items.length ? ` · ${items.length} partida${items.length === 1 ? "" : "s"}` : ""}</span>
        ) : rec ? (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold">Con diferencia</span>
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">Pendiente</span>
        )}
        <ChevronDown size={18} className={cn("text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          {drift && (
            <div className="space-y-2 rounded-xl bg-danger-soft px-3 py-2 text-sm">
              <p className="flex items-start gap-2 font-semibold"><AlertCircle size={16} className="mt-0.5 shrink-0" /> Se movió después de conciliar</p>
              <p>
                Al conciliar, {isDebt ? "la deuda" : "el saldo"} al {Number(drift.cutoff.slice(8))} de {monthName(Number(drift.cutoff.slice(5, 7)) - 1, true)} era{" "}
                <strong className="num">{formatCop(isDebt ? -drift.reconciled : drift.reconciled)}</strong>; hoy la app dice{" "}
                <strong className="num">{formatCop(isDebt ? -drift.now : drift.now)}</strong> ({formatCop(Math.abs(drift.drift))} {(isDebt ? -drift.drift : drift.drift) > 0 ? "más" : "menos"}).
              </p>
              {drift.changed.length > 0 ? (
                <>
                  <p className="text-xs">Movimientos registrados o editados después de conciliar:</p>
                  <ul className="space-y-1">
                    {drift.changed.map((t) => (
                      <li key={t.id}>
                        <button className="flex w-full justify-between gap-2 text-left text-xs underline" onClick={() => openTransaction(t)}>
                          <span className="truncate">{t.occurred_on} · {t.description ?? t.merchant ?? "Movimiento"}</span>
                          <span className="num shrink-0">{formatCop(t.amount)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs">Puede ser un movimiento borrado o un cambio en el saldo inicial de la cuenta.</p>
              )}
              <p className="text-xs">Si fue un error, corrígelo y la cuenta vuelve a cuadrar sola. Si está bien, déjalo como partida conciliatoria: la conciliación no cambia y la diferencia queda explicada.</p>
              <Button variant="secondary" className="w-full" disabled={busy} onClick={acceptItems}>Dejar como partidas conciliatorias</Button>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{isDebt ? "Deuda al empezar" : "Saldo al empezar"}</dt><dd className="num text-right">{formatCop(isDebt ? -st.opening : st.opening)}</dd>
            <dt className="text-muted">{isCredit ? "Abonos a capital" : isCard ? "Pagos y abonos" : "Entró"}</dt><dd className="num text-right text-olive">+{formatCop(isCredit ? cb.capital : st.inflow)}</dd>
            {isCredit && cb.charges > 0 && (<><dt className="text-muted">Intereses y seguros pagados</dt><dd className="num text-right text-muted">{formatCop(cb.charges)}</dd></>)}
            {(!isCredit || cb.other > 0) && (<><dt className="text-muted">{isCredit ? "Desembolsos y ajustes" : isCard ? "Compras" : "Salió"}</dt><dd className="num text-right">−{formatCop(isCredit ? cb.other : st.outflow)}</dd></>)}
            <dt className="font-semibold">{isDebt ? "Deuda según la app" : "Saldo según la app"}</dt><dd className="num text-right font-semibold">{formatCop(appValue)}</dd>
          </dl>
          {st.pending > 0 && <p className="text-xs text-warning">{st.pending} movimiento{st.pending === 1 ? "" : "s"} de esta cuenta siguen por revisar.</p>}

          {isCard && <p className="text-xs text-muted">Puedes revisar la tarjeta contra el banco de dos formas. Son independientes: haz solo la que necesites, las dos, o en el orden que quieras. No hace falta el paso 1 para hacer el paso 2.</p>}
          {!isCredit && (
            <ReconcileStep step={isCard ? 1 : undefined} icon={<ListChecks size={15} />} title="Revisar los movimientos" done={movesStatus}
              question={`¿Están todas tus ${isCard ? "compras y pagos" : "entradas y salidas"}? Sube el Excel o CSV de movimientos del banco y te digo cuáles faltan en la app o están repetidos.`}>
              <StatementImport key={month} account={account} month={month} onBalance={(v) => setBank(String(v))} onStatus={setMovesStatus} />
            </ReconcileStep>
          )}
          {isCard && (
            <ReconcileStep step={2} icon={<FileText size={15} />} title="Revisar la deuda y las cuotas" done={pdfStatus}
              question="¿Coincide la deuda con la del banco? Sube el PDF o una foto del extracto mensual y leo la deuda, el pago mínimo y las compras a cuotas. No necesitas haber hecho el paso 1.">
              <CardStatementPdf key={month} account={account} onBalance={(v) => setBank(String(v))} onStatus={setPdfStatus} crossCheck />
              <ManualCrossCheck key={month} account={account} month={month} />
            </ReconcileStep>
          )}

          <Field label={isCredit ? `Saldo de capital según el extracto al ${Number(range.end.slice(8))} de ${monthName(Number(month.slice(5)) - 1, true)}` : isCard ? `Deuda total según tu extracto${cutDate ? ` (corte del ${Number(cutDate.slice(8))})` : ""}` : `Saldo según tu banco al ${Number(range.end.slice(8))} de ${monthName(Number(month.slice(5)) - 1, true)}`}>
            <AmountInput value={bank} onChange={setBank} />
          </Field>

          {!isCredit && diff !== null && (diff !== 0 || picked.size > 0) && st.items.length > 0 && (
            <Collapsible title="Partidas conciliatorias" summary={picked.size ? `${picked.size} · ${formatCop(Math.abs(pickedEffect))}` : undefined} defaultOpen={picked.size > 0}>
              <p className="text-xs text-muted">
                Marca los movimientos del mes que están en la app pero todavía no en {isCard ? "el extracto" : "el saldo del banco"}.
                {cutDate ? ` Las compras y pagos después del corte (${Number(cutDate.slice(8))} de ${monthName(Number(month.slice(5)) - 1, true)}) ya vienen marcadas: el banco las cobra en el próximo extracto.` : ""}
              </p>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-surface">
                {st.items.map((t) => {
                  const e = effectOn(account.id, t);
                  return (
                    <li key={t.id}>
                      <label className="flex items-center gap-2 px-3 py-2 text-xs">
                        <input type="checkbox" checked={picked.has(t.id)} onChange={() => togglePick(t.id)} />
                        <span className="min-w-0 flex-1 truncate">{t.occurred_on} · {t.merchant || t.description || "Movimiento"}</span>
                        <span className="num shrink-0">{(isDebt ? -e : e) > 0 ? "+" : "−"}{formatCop(Math.abs(e))}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                <dt className="text-muted">{isCard ? "Extracto" : "Banco"}</dt><dd className="num text-right">{formatCop(bankValue ?? 0)}</dd>
                <dt className="text-muted">Partidas conciliatorias</dt><dd className="num text-right">{(isDebt ? -pickedEffect : pickedEffect) >= 0 ? "+" : "−"}{formatCop(Math.abs(pickedEffect))}</dd>
                <dt className="font-semibold">Igual a la app</dt><dd className={cn("num text-right font-semibold", rest !== 0 && "text-warning")}>{formatCop((bankValue ?? 0) + (isDebt ? -pickedEffect : pickedEffect))}{rest === 0 ? " ✓" : ""}</dd>
              </dl>
            </Collapsible>
          )}

          {!isCredit && <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-muted"><Receipt size={15} /> 1 · Registra los gastos bancarios del mes</p>
            <div className="flex flex-wrap gap-2">
              {FEES.filter((f) => !(isCard && f.key === "gmf")).map((f) => (
                <button key={f.key} onClick={() => setFee(f.key)}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm">
                  {f.label}{f.key === "gmf" && gmf > 0 ? ` ≈ ${formatCop(gmf)}` : ""}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">Van a tu categoría “Gastos bancarios”. Cada uno que registres se descuenta de la diferencia.</p>
            {!isCard && (
              <InfoNote className="px-0" label="Sobre el 4x1000">
                Es un estimado: 0,4 % de lo que sale de la cuenta por encima del tope exento (350 UVT al mes en cuentas exentas, 65 UVT en depósitos de bajo monto; UVT {formatCop(uvt)}). Confírmalo con tu extracto.
              </InfoNote>
            )}
            <button className="text-xs text-olive underline" onClick={() => openTransaction(null)}>Registrar otro movimiento que falte</button>
          </div>}

          {account.kind === "CREDIT" && <CreditPaymentAdjust account={account} since={addDays(range.start, -15)} defaultOpen />}

          {isCredit && rest !== null && (
            <div className="space-y-2">
              <p className={cn("rounded-xl px-3 py-2 text-sm", rest === 0 ? "bg-olive-soft" : "bg-warning-soft")}>
                {rest === 0
                  ? "Cuadra exacto con el extracto."
                  : rest < 0
                    ? `El extracto dice que debes ${formatCop(-rest)} más que la app.`
                    : `El extracto dice que debes ${formatCop(rest)} menos que la app.`}
              </p>
            </div>
          )}

          {!isCredit && rest !== null && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted">2 · Diferencia sin identificar</p>
              <p className={cn("rounded-xl px-3 py-2 text-sm", rest === 0 ? "bg-olive-soft" : "bg-warning-soft")}>
                {rest === 0
                  ? "Cuadra exacto: no hay diferencia sin identificar."
                  : rest < 0
                    ? `${formatCop(-rest)} salieron de la cuenta y no están en la app.`
                    : `${formatCop(rest)} entraron a la cuenta y no están en la app.`}
              </p>
              {rest < 0 && gmf > 0 && (
                <p className="text-xs text-warning">Parte de esta diferencia podría ser el 4x1000 (≈ {formatCop(gmf)}). Regístralo arriba primero.</p>
              )}
              {rest !== 0 && (
                <>
                  <p className="text-xs text-muted">Si sabes qué fue, regístralo como gasto o ingreso. Si no, abajo puedes ajustar el saldo de la app al del banco (no cuenta como gasto ni ingreso).</p>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setFee("unknown")}>
                    Registrar {formatCop(Math.abs(rest))} como {rest > 0 ? "ingreso" : "gasto"} “No identificado”
                  </Button>
                </>
              )}
            </div>
          )}

          <ErrorText>{error}</ErrorText>
          <Button className="w-full" onClick={adjustAndReconcile} disabled={busy || bankValue === null}>
            {busy ? "Guardando..." : rest === null || rest === 0 ? "Marcar como conciliada"
              : `Ajustar ${isDebt ? "la deuda" : "el saldo"} a ${formatCop(bankValue ?? 0)} y conciliar`}
          </Button>
          {rest !== null && rest !== 0 && (
            <button className="w-full text-center text-xs text-muted underline" onClick={markReconciled} disabled={busy}>
              Guardar el cierre con la diferencia, sin ajustar
            </button>
          )}
        </div>
      )}

      <FeeSheet account={account} feeKey={fee} onClose={() => setFee(null)} month={month} end={range.end}
        suggested={fee === "gmf" ? gmf : fee === "unknown" && rest !== null ? Math.abs(rest) : 0}
        unknownIsIncome={fee === "unknown" && rest !== null && rest > 0} />
    </Card>
  );
}

function FeeSheet({ account, feeKey, onClose, month, end, suggested, unknownIsIncome }: {
  account: Account; feeKey: FeeKey | null; onClose: () => void; month: string; end: string; suggested: number; unknownIsIncome: boolean;
}) {
  const state = useFinance();
  const { supabase, reload } = state;
  // Fecha del cobro: el corte del extracto en tarjetas, el final del mes en las demás cuentas
  const range = { ...monthRange(month), end };
  const today = todayBogota();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(range.end);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fee = FEES.find((f) => f.key === feeKey);
  const isUnknown = feeKey === "unknown";
  const title = isUnknown ? (unknownIsIncome ? "Ingreso no identificado" : "Gasto no identificado") : fee?.label ?? "";

  useEffect(() => {
    if (!feeKey) return;
    setAmount(suggested > 0 ? String(suggested) : "");
    setDate(range.end < today ? range.end : today);
    setNote("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeKey]);

  async function save() {
    const n = parseCop(amount) ?? 0;
    if (n <= 0) return setError("Escribe el monto.");
    setBusy(true);
    setError(null);
    try {
      const description = [title, note.trim()].filter(Boolean).join(" · ");
      if (isUnknown && unknownIsIncome) {
        const { error } = await supabase.rpc("save_transaction", {
          p: { kind: "INCOME", amount: n, occurred_on: date, description, account_id: account.id, tags: ["#conciliacion"] },
        });
        if (error) throw error;
      } else {
        const categoryId = isUnknown
          ? await ensureCategory(state, supabase, "No identificado", "❓")
          : await ensureCategory(state, supabase, "Gastos bancarios", "🏦");
        const { error } = await supabase.rpc("save_transaction", {
          p: {
            kind: "EXPENSE", amount: n, occurred_on: date, description, account_id: account.id,
            tags: [isUnknown ? "#conciliacion" : fee!.tag],
            splits: [{ amount: n, category_id: categoryId, responsible_user_id: state.me.user_id }],
          },
        });
        if (error) throw error;
      }
      onClose();
      void reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!feeKey} onOpenChange={(v) => !v && onClose()} title={title} description={`${account.name}${account.last4 ? ` ··${account.last4}` : ""}`}>
      <div className="space-y-4 pb-2">
        <AmountInput large value={amount} onChange={setAmount} />
        {feeKey === "gmf" && suggested > 0 && <p className="text-xs text-muted">Estimado de la app; ajústalo al valor de tu extracto.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha" htmlFor="fee-date"><Input id="fee-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Nota (opcional)" htmlFor="fee-note"><Input id="fee-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-muted">
          {isUnknown && unknownIsIncome
            ? "Queda como ingreso de esta cuenta."
            : `Queda en tu categoría “${isUnknown ? "No identificado" : "Gastos bancarios"}” (se crea si no existe; puedes cambiarla en Presupuestos).`}
        </p>
        <ErrorText>{error}</ErrorText>
        <Button size="lg" className="w-full" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Registrar"}</Button>
      </div>
    </Sheet>
  );
}
