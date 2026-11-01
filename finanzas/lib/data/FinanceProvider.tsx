"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import type {
  Account, AccountLabel, BudgetPlan, CategoryLimit, BudgetPlanCategory, Category, CategoryBudgetRow, CustomPeriodRow, Household, LedgerRow,
  CardStatementItem, ManualAsset, Member, PeriodSettingsRow, Reconciliation, SavingsContribution, SavingsGoal, ScheduledPayment, Split, Tag, Transaction,
} from "@/lib/types";
import { toPeriodSettings, type Snapshot } from "@/lib/finance/derive";
import type { SpendingRow } from "@/lib/finance/budget";
import { creditBudgetMap, spendingRows } from "@/lib/finance/spaces";
import { cardPaymentPortions } from "@/lib/finance/cardBudget";
import { expandInstallments } from "@/lib/finance/installments";
import { periodFor, todayBogota, type Period } from "@/lib/finance/periods";
import { getItem, isNetworkError, queueKey, setItem, snapshotKey } from "@/lib/offline/store";
import type { QueuedTx } from "@/lib/offline/queue";

export interface FinanceState extends Snapshot {
  /** Etiquetas del hogar y, por movimiento, los ids de las que tiene. */
  tags: Tag[];
  txTags: Record<string, string[]>;
  /** Compras del extracto de mis tarjetas que no son movimientos (solo para proyectar cuotas). */
  cardItems: CardStatementItem[];
  /** Movimientos para presupuestos e informes: las compras a cuotas, una copia por cuota en su mes. */
  consumption: Transaction[];
  household: Household;
  /** Totales (sin detalle) de lo que la pareja lleva en sus presupuestos personales compartidos conmigo. */
  sharedSpending: SpendingRow[];
  plans: BudgetPlan[];
  planCategories: BudgetPlanCategory[];
  commitments: ScheduledPayment[];
  goals: SavingsGoal[];
  contributions: SavingsContribution[];
  uvt: number;
  reconciliations: Reconciliation[];
  labels: AccountLabel[];
  customPeriods: CustomPeriodRow[];
  period: Period;
  setPeriod: (p: Period) => void;
  reload: () => Promise<void>;
  supabase: SupabaseClient;
  memberById: (userId: string | null | undefined) => Member | null;
  /** Sin conexión: los datos son la última copia guardada en el celular. */
  offline: boolean;
  /** Fecha de la copia local que se está mostrando (solo sin conexión). */
  snapshotAt: string | null;
  /** Movimientos guardados sin conexión, por enviar. */
  queue: QueuedTx[];
  enqueue: (q: QueuedTx) => Promise<void>;
  /** Envía la cola; `retryRejected` también reintenta los que la base de datos rechazó. */
  flushQueue: (retryRejected?: boolean) => Promise<void>;
  discardQueued: (clientId: string) => Promise<void>;
}

const Ctx = createContext<FinanceState | null>(null);

export function useFinance(): FinanceState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance fuera de FinanceProvider");
  return v;
}

const PAGE = 1000;

/** Supabase entrega máximo 1000 filas por consulta: pide de a páginas. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

const num = (v: unknown) => (v == null ? v : Number(v));

type Loaded = Omit<FinanceState, "period" | "setPeriod" | "reload" | "supabase" | "memberById" | "offline" | "snapshotAt" | "queue" | "enqueue" | "flushQueue" | "discardQueued">;

async function loadAll(sb: SupabaseClient, userId: string): Promise<Loaded> {
  const { data: meRow, error: meErr } = await sb.from("household_members").select("*").eq("user_id", userId).single();
  if (meErr) throw meErr;
  const me = meRow as Member;
  const hh = me.household_id;

  const [household, members, settings, customPeriods, accounts, labels, balances, categories, budgets, txs, splits, ledger, assets, recs,
    plans, planCategories, commitments, goals, contributions, limits, shared, tagRows, txTagRows] =
    await Promise.all([
      sb.from("households").select("id, name, invite_code").eq("id", hh).single(),
      sb.from("household_members").select("*").eq("household_id", hh),
      sb.from("period_settings").select("*").eq("household_id", hh).maybeSingle(),
      sb.from("custom_periods").select("id, name, start_date, end_date").eq("household_id", hh).order("start_date", { ascending: false }),
      sb.from("accounts").select("*").eq("household_id", hh).order("created_at"),
      sb.rpc("account_labels"),
      sb.rpc("account_balances"),
      sb.from("categories").select("*").eq("household_id", hh).order("name"),
      sb.from("category_budgets").select("id, category_id, limit_id, valid_from, amount, fixed_amount_a, fixed_amount_b").eq("household_id", hh),
      fetchAll<Omit<Transaction, "splits">>((f, t) =>
        sb.from("transactions").select("*").eq("household_id", hh).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).range(f, t),
      ),
      fetchAll<Split>((f, t) => sb.from("transaction_splits").select("*").eq("household_id", hh).range(f, t)),
      fetchAll<LedgerRow>((f, t) =>
        sb.from("cross_ledger").select("*").eq("household_id", hh).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).range(f, t),
      ),
      sb.from("manual_assets").select("*").eq("household_id", hh).order("created_at"),
      sb.from("account_reconciliations").select("id, account_id, month, statement_balance, app_balance, difference, status, note, updated_at")
        .eq("owner_user_id", userId).order("month", { ascending: false }),
      sb.from("budget_plans").select("*").eq("household_id", hh).order("name"),
      sb.from("budget_plan_categories").select("plan_id, category_id, amount").eq("household_id", hh),
      sb.from("scheduled_payments").select("*").eq("household_id", hh).order("name"),
      sb.from("savings_goals").select("*").eq("household_id", hh).order("created_at"),
      fetchAll<SavingsContribution>((f, t) =>
        sb.from("savings_contributions").select("id, goal_id, user_id, amount, occurred_on, note, created_at").eq("household_id", hh)
          .order("occurred_on", { ascending: false }).range(f, t),
      ),
      sb.from("category_limits").select("id, category_id, scope, owner_user_id, responsibility, is_household_obligation, rollover_enabled, shared_with_partner").eq("household_id", hh),
      sb.rpc("shared_personal_spending"),
      sb.from("tags").select("id, household_id, name, color").eq("household_id", hh).order("name"),
      fetchAll<{ transaction_id: string; tag_id: string }>((f, t) =>
        sb.from("transaction_tags").select("transaction_id, tag_id").eq("household_id", hh).range(f, t),
      ),
    ]);

  for (const r of [household, members, settings, customPeriods, accounts, labels, balances, categories, budgets, assets, recs,
    plans, planCategories, commitments, goals, limits, shared, tagRows]) {
    if (r.error) throw r.error;
  }
  const txTags: Record<string, string[]> = {};
  for (const r of txTagRows) (txTags[r.transaction_id] ??= []).push(r.tag_id);

  const splitsByTx = new Map<string, Split[]>();
  for (const s of splits) {
    const list = splitsByTx.get(s.transaction_id) ?? [];
    list.push({ ...s, amount: Number(s.amount) });
    splitsByTx.set(s.transaction_id, list);
  }

  const transactions: Transaction[] = txs.map((t) => ({ ...t, amount: Number(t.amount), installments: Number(t.installments ?? 1), interest_rate_ea: num(t.interest_rate_ea) as number | null, splits: splitsByTx.get(t.id) ?? [] }));
  const consumption = expandInstallments(transactions);
  const cardItemRows = await sb.from("card_statement_items").select("id, account_id, description, purchase_date, amount, installments, paid_installments, remaining_balance, rate_ea");
  if (cardItemRows.error) throw cardItemRows.error;
  const cardItems = ((cardItemRows.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), account_id: String(r.account_id), description: String(r.description), purchase_date: String(r.purchase_date),
    amount: Number(r.amount), installments: Number(r.installments), paid_installments: Number(r.paid_installments),
    remaining_balance: Number(r.remaining_balance), rate_ea: num(r.rate_ea) as number | null,
  }));
  const sharedSpending: SpendingRow[] = ((shared.data ?? []) as { owner_user_id: string; category_id: string; occurred_on: string; total: number }[])
    .map((r) => ({ categoryId: r.category_id, responsibleUserId: r.owner_user_id, occurredOn: r.occurred_on, total: Number(r.total), scope: "PERSONAL" }));
  const memberRows = (members.data ?? []) as Member[];
  const balanceMap: Record<string, number> = {};
  for (const b of (balances.data ?? []) as { account_id: string; balance: number }[]) balanceMap[b.account_id] = Number(b.balance);

  return {
    tags: (tagRows.data ?? []) as Tag[],
    txTags,
    household: household.data as Household,
    me,
    partner: memberRows.find((m) => m.user_id !== userId) ?? null,
    settings: toPeriodSettings(settings.data as PeriodSettingsRow | null),
    uvt: Number((settings.data as PeriodSettingsRow | null)?.uvt_value ?? 52374),
    reconciliations: ((recs.data ?? []) as Reconciliation[]).map((r) => ({
      ...r,
      statement_balance: Number(r.statement_balance),
      app_balance: Number(r.app_balance),
      difference: Number(r.difference),
    })),
    customPeriods: (customPeriods.data ?? []) as CustomPeriodRow[],
    accounts: ((accounts.data ?? []) as Account[]).map((a) => ({
      ...a,
      opening_balance: Number(a.opening_balance),
      credit_limit: num(a.credit_limit) as number | null,
      interest_rate_ea: num(a.interest_rate_ea) as number | null,
      term_months: num(a.term_months) as number | null,
      paid_installments: num(a.paid_installments) as number | null,
      original_amount: num(a.original_amount) as number | null,
      installment_amount: num(a.installment_amount) as number | null,
      monthly_costs: Number(a.monthly_costs ?? 0),
    })),
    labels: (labels.data ?? []) as AccountLabel[],
    balances: balanceMap,
    categories: (categories.data ?? []) as Category[],
    budgets: ((budgets.data ?? []) as CategoryBudgetRow[]).map((b) => ({
      ...b,
      amount: Number(b.amount),
      fixed_amount_a: num(b.fixed_amount_a) as number | null,
      fixed_amount_b: num(b.fixed_amount_b) as number | null,
    })),
    transactions,
    ledger: ledger.map((l) => ({ ...l, amount: Number(l.amount) })),
    assets: ((assets.data ?? []) as ManualAsset[]).map((a) => ({ ...a, value: Number(a.value) })),
    // Lo ejecutado sale de los movimientos visibles (lo personal de la pareja no llega), más los totales
    // de sus presupuestos personales que me compartió (solo de movimientos que no puedo abrir)
    spending: [...spendingRows(consumption, creditBudgetMap((accounts.data ?? []) as Account[]),
      cardPaymentPortions(((accounts.data ?? []) as Account[]).map((a) => ({ ...a, opening_balance: Number(a.opening_balance) })), transactions, cardItems)), ...sharedSpending],
    consumption,
    cardItems,
    sharedSpending,
    plans: ((plans.data ?? []) as BudgetPlan[]).map((b) => ({ ...b, amount: Number(b.amount), alert_pct: Number(b.alert_pct), shared_with_partner: !!b.shared_with_partner })),
    planCategories: ((planCategories.data ?? []) as BudgetPlanCategory[]).map((c) => ({ ...c, amount: num(c.amount) as number | null })),
    commitments: ((commitments.data ?? []) as ScheduledPayment[]).map((c) => ({ ...c, amount: Number(c.amount) })),
    goals: ((goals.data ?? []) as SavingsGoal[]).map((g) => ({
      ...g,
      target_amount: Number(g.target_amount),
      planned_amount: num(g.planned_amount) as number | null,
    })),
    contributions: contributions.map((c) => ({ ...c, amount: Number(c.amount) })),
    limits: (limits.data ?? []) as CategoryLimit[],
  };
}

const REALTIME_TABLES = [
  "account_reconciliations",
  "accounts", "categories", "category_budgets", "transactions", "transaction_splits",
  "cross_ledger", "household_members", "period_settings", "manual_assets",
  "category_limits", "budget_plans", "budget_plan_categories", "scheduled_payments", "savings_goals", "savings_contributions",
  "tags", "transaction_tags",
];

export function FinanceProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const supabase = getSupabase();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [offline, setOffline] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedTx[]>([]);
  const queueRef = useRef<QueuedTx[]>([]);
  const flushing = useRef(false);
  const hasData = useRef(false);

  const reload = useCallback(async () => {
    try {
      const next = await loadAll(supabase, userId);
      setData(next);
      hasData.current = true;
      setError(null);
      setOffline(false);
      setSnapshotAt(null);
      void setItem(snapshotKey(userId), { at: new Date().toISOString(), data: next });
    } catch (e) {
      if (isNetworkError(e)) {
        setOffline(true);
        // Sin conexión: se muestra la última copia guardada en el celular
        if (!hasData.current) {
          const snap = await getItem<{ at: string; data: Loaded }>(snapshotKey(userId));
          if (snap?.data?.me?.user_id === userId) {
            setData(snap.data);
            hasData.current = true;
            setSnapshotAt(snap.at);
            setError(null);
            return;
          }
        }
        if (hasData.current) return;
      }
      setError((e as { message?: string }).message ?? "No se pudieron cargar los datos");
    }
  }, [supabase, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveQueue = useCallback(async (next: QueuedTx[]) => {
    queueRef.current = next;
    setQueue(next);
    await setItem(queueKey(userId), next);
  }, [userId]);

  /** Envía la cola en orden. Se detiene si no hay conexión; un rechazo de la base de datos queda anotado en el movimiento. */
  const flushQueue = useCallback(async (retryRejected = false) => {
    if (flushing.current || queueRef.current.length === 0) return;
    flushing.current = true;
    let sent = 0;
    try {
      for (const item of [...queueRef.current]) {
        if (item.error && !retryRejected) continue;
        const { data: id, error: err } = await supabase.rpc("save_transaction_once", { p: { ...item.payload, client_id: item.client_id } });
        if (err) {
          if (isNetworkError(err)) {
            setOffline(true);
            break;
          }
          await saveQueue(queueRef.current.map((q) => (q.client_id === item.client_id ? { ...q, error: err.message } : q)));
          continue;
        }
        if (id && item.tagIds.length > 0 && data) {
          await supabase.from("transaction_tags").upsert(
            item.tagIds.map((tag_id) => ({ transaction_id: id as string, tag_id, household_id: data.me.household_id })),
            { onConflict: "transaction_id,tag_id", ignoreDuplicates: true },
          );
        }
        sent++;
        await saveQueue(queueRef.current.filter((q) => q.client_id !== item.client_id));
      }
    } finally {
      flushing.current = false;
    }
    if (sent > 0) void reload();
  }, [supabase, saveQueue, reload, data]);

  const enqueue = useCallback(async (q: QueuedTx) => {
    await saveQueue([...queueRef.current.filter((x) => x.client_id !== q.client_id), q]);
    setOffline(true);
  }, [saveQueue]);

  const discardQueued = useCallback(async (clientId: string) => {
    await saveQueue(queueRef.current.filter((q) => q.client_id !== clientId));
  }, [saveQueue]);

  // Cola guardada en el celular: se carga al abrir y se envía apenas haya conexión
  useEffect(() => {
    let alive = true;
    void getItem<QueuedTx[]>(queueKey(userId)).then((q) => {
      if (!alive || !q?.length) return;
      queueRef.current = q;
      setQueue(q);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    if (data && queue.length > 0 && !offline) void flushQueue();
  }, [data, queue.length, offline, flushQueue]);

  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      void reload().then(() => flushQueue());
    };
    const onOffline = () => setOffline(true);
    if (!navigator.onLine) setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [reload, flushQueue]);

  // Realtime: cualquier cambio del hogar recarga (con una pequeña espera para agrupar ráfagas).
  const householdId = data?.me.household_id;
  useEffect(() => {
    if (!householdId) return;
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void reload(), 350);
    };
    let channel = supabase.channel(`hogar-${householdId}`);
    for (const table of REALTIME_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `household_id=eq.${householdId}` },
        schedule,
      );
    }
    channel.subscribe();
    const onVisible = () => document.visibilityState === "visible" && schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [householdId, reload, supabase]);

  const settings = data?.settings;
  useEffect(() => {
    if (settings && !period) setPeriod(periodFor(settings, todayBogota()));
  }, [settings, period]);

  // Si cambia el ciclo del hogar, recalcula el periodo actual.
  const cycleKey = settings ? `${settings.cycle}-${settings.monthlyStartDay}-${settings.biweeklyFirstDay}-${settings.biweeklySecondDay}` : "";
  useEffect(() => {
    if (settings) setPeriod((p) => (p?.custom ? p : periodFor(settings, p?.start ?? todayBogota())));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleKey]);

  const value = useMemo<FinanceState | null>(() => {
    if (!data || !period) return null;
    const all = [data.me, data.partner].filter(Boolean) as Member[];
    return {
      ...data,
      period,
      setPeriod,
      reload,
      supabase,
      memberById: (id) => all.find((m) => m.user_id === id) ?? null,
      offline,
      snapshotAt,
      queue,
      enqueue,
      flushQueue,
      discardQueued,
    };
  }, [data, period, reload, supabase, offline, snapshotAt, queue, enqueue, flushQueue, discardQueued]);

  if (error && !data) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="font-display text-2xl">No pudimos cargar tus datos</p>
        <p className="mt-2 text-sm text-muted">{error}</p>
        <button className="mt-6 rounded-2xl bg-olive px-5 py-3 font-semibold text-on-olive" onClick={() => void reload()}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!value) return <LoadingScreen />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-olive-soft border-t-olive" aria-label="Cargando" />
    </div>
  );
}
