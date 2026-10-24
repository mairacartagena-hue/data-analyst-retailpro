"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Inbox, Link2, Sparkles } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Transaction } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/types";
import { formatCop } from "@/lib/finance/money";

import { accountLabel, categoryLabel } from "@/lib/finance/labels";
import { findManualTwin } from "@/lib/ingest/match";
import { fold } from "@/lib/ingest/normalize";
import { SUBSCRIPTION_TAG } from "@/lib/finance/subscriptions";
import type { Space } from "@/lib/types";
import { formatDay } from "@/lib/finance/periods";
import { errMsg } from "@/lib/utils";

/** Cola de pendientes del inicio: movimientos que llegaron solos y esperan revisión. */
export function PendingReview() {
  const { transactions, me } = useFinance();
  const pending = transactions.filter((t) => t.status === "PENDING_REVIEW" && t.payer_user_id === me.user_id);
  if (pending.length === 0) return null;
  const shown = pending.slice(0, 3);

  return (
    <section className="mt-4 space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Inbox size={16} className="text-warning" /> Por revisar ({pending.length})</h2>
        {pending.length > shown.length && (
          <Link href="/movimientos?filtro=pendientes" className="text-sm font-semibold text-olive">Ver todos</Link>
        )}
      </div>
      {shown.map((t) => <PendingCard key={t.id} tx={t} />)}
    </section>
  );
}

function PendingCard({ tx }: { tx: Transaction }) {
  const { me, categories, labels, supabase, reload, memberById, transactions } = useFinance();
  const { openTransaction } = useShell();
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cobro de suscripción (servicio conocido o que se repite cada mes): sugerir la categoría "Suscripciones"
  const isSubscription = tx.tags.includes(SUBSCRIPTION_TAG);
  const subsCategory = categories.find((c) => !c.archived && c.kind !== "INCOME" && fold(c.name) === "suscripciones"
) ?? null;
  const suggested = (tx.suggested_category_id ? categories.find((c) => c.id === tx.suggested_category_id) ?? null : null)
    ?? (isSubscription ? subsCategory : null);
  // El responsable sale de lo que recordó el comercio, o es quien pagó (la categoría no lo decide)
  const suggestedResp = tx.suggested_responsible_user_id
    ?? me.user_id;
  const who = memberById(suggestedResp);
  // El espacio sale de lo que se recordó de este comercio (si se recordó), no de la categoría
  const [scope, setScope] = useState<Space>("PERSONAL");
  useEffect(() => {
    if (!tx.merchant_norm) return;
    let alive = true;
    void supabase.from("merchant_memory").select("scope").eq("identifier_type", "MERCHANT").eq("identifier", tx.merchant_norm)
      .maybeSingle().then(({ data }) => { if (alive && data?.scope) setScope(data.scope as Space); });
    return () => { alive = false; };
  }, [supabase, tx.merchant_norm]);
  const canConfirm = tx.kind === "EXPENSE" && !!suggested && !!tx.account_id && tx.movement_type !== "CARD_PAYMENT";
  const name = tx.merchant || tx.description || "comercio sin nombre";
  const twin = findManualTwin(tx, transactions, categories);

  async function mergeWithTwin() {
    if (!twin) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("merge_pending_into", { p_pending: tx.id, p_target: twin.id });
    setBusy(false);
    if (error) return setError(errMsg(error));
    void reload();
  }

  const verb =
    tx.kind === "INCOME" ? "Ingreso de" :
    tx.movement_type === "WITHDRAWAL" ? "Retiro" :
    tx.movement_type === "CARD_PAYMENT" ? "Pago de tarjeta" :
    tx.movement_type === "TRANSFER_OUT" ? "Transferencia a" : "Pago a";

  async function createSubscriptionsAndConfirm() {
    setBusy(true);
    setError(null);
    const { data: catId, error: catError } = await supabase.rpc("save_category", {
      p: {
        name: "Suscripciones", icon: "🔁",
      },
    });
    if (catError) {
      setBusy(false);
      return setError(errMsg(catError));
    }
    await confirm(catId as string);
  }

  async function confirm(categoryOverride?: string) {
    const categoryId = categoryOverride ?? suggested?.id;
    if (!categoryId) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("save_transaction", {
      p: {
        id: tx.id,
        kind: "EXPENSE",
        amount: tx.amount,
        occurred_on: tx.occurred_on,
        description: tx.description,
        merchant: tx.merchant,
        account_id: tx.account_id,
        tags: tx.tags,
        scope: categoryOverride ? "PERSONAL" : scope,
        creates_debt: true,
        splits: [{ amount: tx.amount, category_id: categoryId, responsible_user_id: categoryOverride ? me.user_id : suggestedResp }],
      },
    });
    if (!error) await supabase.rpc("remember_merchant", { p_transaction_id: tx.id, p_auto_apply: always });
    setBusy(false);
    if (error) return setError(errMsg(error));
    void reload();
  }

  return (
    <Card className="space-y-2.5 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{verb} {tx.movement_type === "WITHDRAWAL" || tx.movement_type === "CARD_PAYMENT" ? "" : name}</p>
          <p className="text-xs text-muted">
            {CHANNEL_LABEL[tx.source] ?? tx.source} · {formatDay(tx.occurred_on)} · {tx.account_id ? accountLabel(labels, tx.account_id) : "cuenta sin identificar"}
          </p>
        </div>
        <span className="num shrink-0 font-semibold">{formatCop(tx.amount)}</span>
      </div>

      {twin && (
        <div className="space-y-2 rounded-xl bg-wood-soft px-3 py-2 text-sm">
          <p className="flex items-start gap-1.5">
            <Link2 size={15} className="mt-0.5 shrink-0 text-wood" />
            <span>
              ¿Es el mismo que registraste a mano? <strong>{twin.description || categoryLabel(categories, twin.splits[0]?.category_id ?? null).name}</strong>{" "}
              · {formatCop(twin.amount)} · {formatDay(twin.occurred_on)}
            </span>
          </p>
          <Button size="sm" variant="secondary" className="w-full" onClick={mergeWithTwin} disabled={busy}>
            Sí, unir (queda {formatCop(tx.amount)}, el monto del banco)
          </Button>
        </div>
      )}

      {suggested && (
        <p className="flex items-start gap-1.5 rounded-xl bg-olive-soft px-3 py-2 text-sm">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-olive" />
          <span>
            ¿Asignar a <strong>{categoryLabel(categories, suggested.id).icon} {suggested.name}</strong> (100 % {who?.user_id === me.user_id ? "tú" : who?.display_name} · {scope === "HOUSEHOLD" ? "hogar" : "personal"})?
          </span>
        </p>
      )}

      {isSubscription && !suggested && tx.kind === "EXPENSE" && tx.account_id && (
        <p className="rounded-xl bg-olive-soft px-3 py-2 text-sm">Parece una suscripción.</p>
      )}

      {canConfirm && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="h-4 w-4 accent-[var(--olive)]" />
          Aplicar siempre sin preguntar
        </label>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        {canConfirm && <Button size="sm" className="flex-1" onClick={() => confirm()} disabled={busy}>Confirmar</Button>}
        {isSubscription && !suggested && tx.kind === "EXPENSE" && tx.account_id && (
          <Button size="sm" className="flex-1" onClick={createSubscriptionsAndConfirm} disabled={busy}>Crear “Suscripciones” y asignar</Button>
        )}
        <Button size="sm" variant={canConfirm ? "outline" : "primary"} className="flex-1" onClick={() => openTransaction(tx)}>
          {canConfirm ? "Cambiar" : "Revisar"}
        </Button>
      </div>
    </Card>
  );
}
