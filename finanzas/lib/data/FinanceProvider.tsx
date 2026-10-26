"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import type {
  Account, AccountLabel, Category, CategoryBudgetRow, CustomPeriodRow, Household, LedgerRow, ManualAsset, Member,
  MerchantMemory, PeriodSettingsRow, Reconciliation, Split, ThirdParty, Transaction,
} from "@/lib/types";
import type { SpendingRow } from "@/lib/finance/budget";
import { toPeriodSettings, type Snapshot } from "@/lib/finance/derive";
import { periodFor, todayBogota, type Period } from "@/lib/finance/periods";

export interface FinanceState extends Snapshot {
  household: Household;
  uvt: number;
  reconciliations: Reconciliation[];
  /** Terceros propios (por ahora solo uno, ej. Álvaro) y los comercios o remitentes recordados como suyos. */
  thirdParties: ThirdParty[];
  thirdPartyMemory: Pick<MerchantMemory, "identifier_type" | "identifier" | "third_party_id">[];
  labels: AccountLabel[];
  customPeriods: CustomPeriodRow[];
  period: Period;
  setPeriod: (p: Period) => void;
  reload: () => Promise<void>;
  supabase: SupabaseClient;
  memberById: (userId: string | null | undefined) => Member | null;
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

type Loaded = Omit<FinanceState, "period" | "setPeriod" | "reload" | "supabase" | "memberById">;

async function loadAll(sb: SupabaseClient, userId: string): Promise<Loaded> {
  const { data: meRow, error: meErr } = await sb.from("household_members").select("*").eq("user_id", userId).single();
  if (meErr) throw meErr;
  const me = meRow as Member;
  const hh = me.household_id;

  const [household, members, settings, customPeriods, accounts, labels, balances, categories, budgets, txs, splits, ledger, assets, spending, recs, thirdParties, tpMemory] =
    await Promise.all([
      sb.from("households").select("id, name, invite_code").eq("id", hh).single(),
      sb.from("household_members").select("*").eq("household_id", hh),
      sb.from("period_settings").select("*").eq("household_id", hh).maybeSingle(),
      sb.from("custom_periods").select("id, name, start_date, end_date").eq("household_id", hh).order("start_date", { ascending: false }),
      sb.from("accounts").select("*").eq("household_id", hh).order("created_at"),
      sb.rpc("account_labels"),
      sb.rpc("account_balances"),
      sb.from("categories").select("*").eq("household_id", hh).order("name"),
      sb.from("category_budgets").select("id, category_id, valid_from, amount, fixed_amount_a, fixed_amount_b").eq("household_id", hh),
      fetchAll<Omit<Transaction, "splits">>((f, t) =>
        sb.from("transactions").select("*").eq("household_id", hh).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).range(f, t),
      ),
      fetchAll<Split>((f, t) => sb.from("transaction_splits").select("*").eq("household_id", hh).range(f, t)),
      fetchAll<LedgerRow>((f, t) =>
        sb.from("cross_ledger").select("*").eq("household_id", hh).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).range(f, t),
      ),
      sb.from("manual_assets").select("*").eq("household_id", hh).order("created_at"),
      fetchAll<{ category_id: string; responsible_user_id: string; occurred_on: string; total: number }>((f, t) =>
        sb.rpc("category_daily_spending", { p_from: "2000-01-01", p_to: "2100-12-31" }).range(f, t),
      ),
      sb.from("account_reconciliations").select("id, account_id, month, statement_balance, app_balance, difference, status, note, updated_at")
        .eq("owner_user_id", userId).order("month", { ascending: false }),
      sb.from("third_parties").select("id, name").eq("owner_user_id", userId).order("created_at"),
      sb.from("merchant_memory").select("identifier_type, identifier, third_party_id").eq("user_id", userId).not("third_party_id", "is", null),
    ]);

  for (const r of [household, members, settings, customPeriods, accounts, labels, balances, categories, budgets, assets, recs, thirdParties, tpMemory]) {
    if (r.error) throw r.error;
  }

  const splitsByTx = new Map<string, Split[]>();
  for (const s of splits) {
    const list = splitsByTx.get(s.transaction_id) ?? [];
    list.push({ ...s, amount: Number(s.amount) });
    splitsByTx.set(s.transaction_id, list);
  }

  const memberRows = (members.data ?? []) as Member[];
  const balanceMap: Record<string, number> = {};
  for (const b of (balances.data ?? []) as { account_id: string; balance: number }[]) balanceMap[b.account_id] = Number(b.balance);

  return {
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
    thirdParties: (thirdParties.data ?? []) as ThirdParty[],
    thirdPartyMemory: (tpMemory.data ?? []) as FinanceState["thirdPartyMemory"],
    customPeriods: (customPeriods.data ?? []) as CustomPeriodRow[],
    accounts: ((accounts.data ?? []) as Account[]).map((a) => ({
      ...a,
      opening_balance: Number(a.opening_balance),
      credit_limit: num(a.credit_limit) as number | null,
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
    transactions: txs.map((t) => ({ ...t, amount: Number(t.amount), splits: splitsByTx.get(t.id) ?? [] })),
    ledger: ledger.map((l) => ({ ...l, amount: Number(l.amount) })),
    assets: ((assets.data ?? []) as ManualAsset[]).map((a) => ({ ...a, value: Number(a.value) })),
    spending: spending.map<SpendingRow>((r) => ({
      categoryId: r.category_id,
      responsibleUserId: r.responsible_user_id,
      occurredOn: r.occurred_on,
      total: Number(r.total),
    })),
  };
}

const REALTIME_TABLES = [
  "account_reconciliations",
  "accounts", "categories", "category_budgets", "transactions", "transaction_splits",
  "cross_ledger", "household_members", "period_settings", "manual_assets", "third_parties", "merchant_memory",
];

export function FinanceProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const supabase = getSupabase();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await loadAll(supabase, userId);
      setData(next);
      setError(null);
    } catch (e) {
      setError((e as { message?: string }).message ?? "No se pudieron cargar los datos");
    }
  }, [supabase, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    };
  }, [data, period, reload, supabase]);

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
