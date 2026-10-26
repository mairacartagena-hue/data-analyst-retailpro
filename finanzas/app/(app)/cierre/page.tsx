"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Landmark, Receipt } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useFinance, type FinanceState } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { StatementImport } from "@/components/StatementImport";
import { Segmented } from "@/components/ui/segmented";
import type { Account } from "@/lib/types";
import { ACCOUNT_KIND_LABEL } from "@/lib/types";
import { accountStatement, gmfEstimate, monthRange, shiftMonth, suggestedCloseMonth, type GmfMode } from "@/lib/finance/reconcile";
import { formatCop, parseCop } from "@/lib/finance/money";
import { monthName, periodFor, todayBogota } from "@/lib/finance/periods";
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
  const { accounts, me, transactions, reconciliations, categories, period } = state;
  const [month, setMonth] = useState(() => suggestedCloseMonth(todayBogota()));
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("mes");
    if (q && /^\d{4}-\d{2}$/.test(q)) setMonth(q);
  }, []);
  const range = monthRange(month);
  const mine = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived);
  const done = mine.filter((a) => reconciliations.some((r) => r.account_id === a.id && r.month === range.start && r.status === "RECONCILED"));
  const myAccounts = mine.filter((a) => !isCreditKind(a.kind));
  const myCredits = mine.filter((a) => isCreditKind(a.kind));
  const doneOf = (list: Account[]) => list.filter((a) => done.includes(a)).length;
  const [tab, setTab] = useState<"cuentas" | "creditos">("cuentas");
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
      {shown.length === 0 ? (
        <p className="px-1 text-sm text-muted">{tab === "creditos" ? "No tienes créditos ni préstamos. Agrégalos en Cuentas → Créditos." : "No tienes cuentas. Agrégalas en Cuentas."}</p>
      ) : (
        <div className="space-y-3">{shown.map((a) => <AccountClose key={a.id} account={a} month={month} />)}</div>
      )}
      {tab === "creditos" && shown.length > 0 && (
        <p className="mt-3 px-1 text-xs text-muted">
          Compara la deuda de capital con el extracto del crédito. Si no cuadra, suele ser porque el reparto de alguna cuota (capital e intereses) no coincide con el banco: el ajuste corrige la deuda sin contar como gasto ni ingreso.
        </p>
      )}
      <p className="mt-3 px-1 text-xs text-muted">
        El 4x1000 es un estimado: 0,4 % de lo que sale de la cuenta por encima del tope exento (350 UVT al mes en cuentas exentas, 65 UVT en depósitos de bajo monto; UVT {formatCop(state.uvt)}). Confírmalo con tu extracto.
      </p>
    </main>
  );
}

function AccountClose({ account, month }: { account: Account; month: string }) {
  const state = useFinance();
  const { transactions, reconciliations, supabase, reload, uvt } = state;
  const { openTransaction } = useShell();
  const range = monthRange(month);
  const st = useMemo(() => accountStatement(account, transactions, range), [account, transactions, range]);
  const rec = reconciliations.find((r) => r.account_id === account.id && r.month === range.start);
  const isCard = account.kind === "CREDIT_CARD";
  const isCredit = isCreditKind(account.kind);
  const isDebt = isCard || isCredit;
  const [open, setOpen] = useState(!rec);
  const [bank, setBank] = useState("");
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

  async function saveClose(status: "RECONCILED" | "DIFFERENCE", appBalance: number) {
    const statement = isDebt ? -bankValue! : bankValue!;
    return supabase.from("account_reconciliations").upsert({
      household_id: account.household_id, account_id: account.id, owner_user_id: account.owner_user_id, month: range.start,
      statement_balance: statement, app_balance: appBalance, status,
    }, { onConflict: "account_id,month" });
  }

  /** Guarda el cierre tal cual: conciliada si cuadra; si no, queda "con diferencia" sin tocar el saldo. */
  async function markReconciled() {
    if (bankValue === null) return setError("Escribe el saldo que dice tu banco.");
    setBusy(true);
    setError(null);
    const { error } = await saveClose(diff === 0 ? "RECONCILED" : "DIFFERENCE", st.closing);
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
    if (diff === null || diff === 0) return markReconciled();
    setBusy(true);
    setError(null);
    try {
      const today = todayBogota();
      const { error } = await supabase.rpc("save_transaction", { p: {
        kind: "ADJUSTMENT", amount: Math.abs(diff), occurred_on: range.end < today ? range.end : today, account_id: account.id,
        // + el banco tiene más (o se debe menos) que la app: el ajuste suma al saldo; − resta
        direction: diff > 0 ? "IN" : "OUT", description: `Ajuste del saldo con el extracto (${account.name})`, tags: ["#conciliacion"],
      } });
      if (error) throw error;
      const r = await saveClose("RECONCILED", isDebt ? -bankValue : bankValue);
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
      <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Landmark size={18} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{account.name}{account.last4 ? ` ··${account.last4}` : ""}</span>
          <span className="text-xs text-muted">{ACCOUNT_KIND_LABEL[account.kind]}</span>
        </span>
        {rec?.status === "RECONCILED" ? (
          <span className="flex items-center gap-1 rounded-full bg-olive-soft px-2 py-0.5 text-xs font-semibold"><CheckCircle2 size={13} /> Conciliada</span>
        ) : rec ? (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold">Con diferencia</span>
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">Pendiente</span>
        )}
        <ChevronDown size={18} className={cn("text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{isDebt ? "Deuda al empezar" : "Saldo al empezar"}</dt><dd className="num text-right">{formatCop(isDebt ? -st.opening : st.opening)}</dd>
            <dt className="text-muted">{isCredit ? "Abonos a capital" : isCard ? "Pagos y abonos" : "Entró"}</dt><dd className="num text-right text-olive">+{formatCop(st.inflow)}</dd>
            <dt className="text-muted">{isCredit ? "Desembolsos y ajustes" : isCard ? "Compras" : "Salió"}</dt><dd className="num text-right">−{formatCop(st.outflow)}</dd>
            <dt className="font-semibold">{isDebt ? "Deuda según la app" : "Saldo según la app"}</dt><dd className="num text-right font-semibold">{formatCop(appValue)}</dd>
          </dl>
          {st.pending > 0 && <p className="text-xs text-warning">{st.pending} movimiento{st.pending === 1 ? "" : "s"} de esta cuenta siguen por revisar.</p>}

          {!isCredit && <StatementImport account={account} month={month} onBalance={(v) => setBank(String(v))} />}

          <Field label={isCredit ? `Saldo de capital según el extracto al ${Number(range.end.slice(8))} de ${monthName(Number(month.slice(5)) - 1, true)}` : isCard ? `Deuda según tu extracto al ${Number(range.end.slice(8))} de ${monthName(Number(month.slice(5)) - 1, true)}` : `Saldo según tu banco al ${Number(range.end.slice(8))} de ${monthName(Number(month.slice(5)) - 1, true)}`}>
            <AmountInput value={bank} onChange={setBank} />
          </Field>

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
            <button className="text-xs text-olive underline" onClick={() => openTransaction(null)}>Registrar otro movimiento que falte</button>
          </div>}

          {isCredit && diff !== null && (
            <div className="space-y-2">
              <p className={cn("rounded-xl px-3 py-2 text-sm", diff === 0 ? "bg-olive-soft" : "bg-warning-soft")}>
                {diff === 0
                  ? "Cuadra exacto con el extracto."
                  : diff < 0
                    ? `El extracto dice que debes ${formatCop(-diff)} más que la app.`
                    : `El extracto dice que debes ${formatCop(diff)} menos que la app.`}
              </p>
            </div>
          )}

          {!isCredit && diff !== null && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted">2 · Diferencia sin identificar</p>
              <p className={cn("rounded-xl px-3 py-2 text-sm", diff === 0 ? "bg-olive-soft" : "bg-warning-soft")}>
                {diff === 0
                  ? "Cuadra exacto: no hay diferencia sin identificar."
                  : diff < 0
                    ? `${formatCop(-diff)} salieron de la cuenta y no están en la app.`
                    : `${formatCop(diff)} entraron a la cuenta y no están en la app.`}
              </p>
              {diff < 0 && gmf > 0 && (
                <p className="text-xs text-warning">Parte de esta diferencia podría ser el 4x1000 (≈ {formatCop(gmf)}). Regístralo arriba primero.</p>
              )}
              {diff !== 0 && (
                <>
                  <p className="text-xs text-muted">Si sabes qué fue, regístralo como gasto o ingreso. Si no, abajo puedes ajustar el saldo de la app al del banco (no cuenta como gasto ni ingreso).</p>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setFee("unknown")}>
                    Registrar {formatCop(Math.abs(diff))} como {diff > 0 ? "ingreso" : "gasto"} “No identificado”
                  </Button>
                </>
              )}
            </div>
          )}

          <ErrorText>{error}</ErrorText>
          <Button className="w-full" onClick={adjustAndReconcile} disabled={busy || bankValue === null}>
            {busy ? "Guardando..." : diff === null || diff === 0 ? "Marcar como conciliada"
              : `Ajustar ${isDebt ? "la deuda" : "el saldo"} a ${formatCop(bankValue ?? 0)} y conciliar`}
          </Button>
          {diff !== null && diff !== 0 && (
            <button className="w-full text-center text-xs text-muted underline" onClick={markReconciled} disabled={busy}>
              Guardar el cierre con la diferencia, sin ajustar
            </button>
          )}
        </div>
      )}

      <FeeSheet account={account} feeKey={fee} onClose={() => setFee(null)} month={month}
        suggested={fee === "gmf" ? gmf : fee === "unknown" && diff !== null ? Math.abs(diff) : 0}
        unknownIsIncome={fee === "unknown" && diff !== null && diff > 0} />
    </Card>
  );
}

function FeeSheet({ account, feeKey, onClose, month, suggested, unknownIsIncome }: {
  account: Account; feeKey: FeeKey | null; onClose: () => void; month: string; suggested: number; unknownIsIncome: boolean;
}) {
  const state = useFinance();
  const { supabase, reload } = state;
  const range = monthRange(month);
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
