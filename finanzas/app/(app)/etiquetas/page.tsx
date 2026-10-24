"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Pencil, Repeat, Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { formatCop } from "@/lib/finance/money";
import { tagStats, type TagStat } from "@/lib/finance/reports";
import { detectSubscriptions, SUBSCRIPTION_TAG } from "@/lib/finance/subscriptions";
import { errMsg } from "@/lib/utils";

export default function EtiquetasPage() {
  const { transactions, me, supabase, reload } = useFinance();
  const stats = useMemo(() => tagStats(transactions, me.user_id), [transactions, me.user_id]);
  const candidates = useMemo(() => detectSubscriptions(transactions, me.user_id), [transactions, me.user_id]);
  const [editing, setEditing] = useState<TagStat | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function markSubscription(key: string, ids: string[]) {
    setBusy(key);
    setError(null);
    const { error } = await supabase.rpc("tag_transactions", { p_ids: ids, p_tag: SUBSCRIPTION_TAG, p_add: true });
    setBusy(null);
    if (error) return setError(errMsg(error));
    void reload();
  }

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2 py-2">
        <Link href="/mas" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
        <h1 className="font-display text-3xl">Etiquetas</h1>
      </div>
      <p className="px-1 text-sm text-muted">
        Se ponen solas según el banco, la tarjeta o el tipo de cobro (#bancolombia, #tc_0602, #suscripcion…). Toca una para ver sus movimientos.
      </p>
      <ErrorText>{error}</ErrorText>

      {stats.length === 0 ? (
        <Card className="mt-4 text-sm text-muted">Aún no hay etiquetas.</Card>
      ) : (
        <div className="mt-4 divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface">
          {stats.map((s) => (
            <div key={s.tag} className="flex items-center gap-2 px-3.5 py-3">
              <Link href={`/movimientos?etiqueta=${encodeURIComponent(s.tag)}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
                  {s.tag === SUBSCRIPTION_TAG ? <Repeat size={16} /> : <span className="text-sm font-semibold">#</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.tag}</span>
                  <span className="num block text-xs text-muted">{s.count} movimiento{s.count === 1 ? "" : "s"} · gastos {formatCop(s.total)}</span>
                </span>
                <ChevronRight size={16} className="text-muted" />
              </Link>
              {s.editable > 0 && (
                <button className="rounded-full p-2 text-muted hover:bg-surface-2" onClick={() => setEditing(s)} aria-label={`Editar ${s.tag}`}>
                  <Pencil size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <>
          <SectionTitle>Posibles #suscripcion</SectionTitle>
          <Card className="space-y-3">
            {candidates.map((c) => (
              <div key={c.key} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{c.name}
                  <span className="block text-xs text-muted">{c.known ? "Servicio de suscripción" : `Se repite cada mes · ${c.count} cobros`}</span>
                </span>
                <span className="num">{formatCop(c.averageAmount)}</span>
                <Button size="sm" variant="secondary" disabled={busy === c.key} onClick={() => markSubscription(c.key, c.transactionIds)}>Etiquetar</Button>
              </div>
            ))}
          </Card>
        </>
      )}

      <TagSheet stat={editing} onClose={() => setEditing(null)} existing={stats.map((s) => s.tag)} />
    </main>
  );
}

function TagSheet({ stat, onClose, existing }: { stat: TagStat | null; onClose: () => void; existing: string[] }) {
  const { supabase, reload } = useFinance();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = name.trim() ? `#${name.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "_")}` : "";
  const merges = !!target && target !== stat?.tag && existing.includes(target);

  async function rename() {
    if (!stat || !target || target === stat.tag) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("rename_tag", { p_old: stat.tag, p_new: target });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onClose();
    void reload();
  }

  async function remove() {
    if (!stat || !confirm(`¿Quitar ${stat.tag} de ${stat.editable} movimiento${stat.editable === 1 ? "" : "s"}? Los movimientos no se borran.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("remove_tag", { p_tag: stat.tag });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onClose();
    void reload();
  }

  return (
    <Sheet open={!!stat} onOpenChange={(v) => { if (!v) { onClose(); setName(""); setError(null); } }} title={stat?.tag ?? ""}
      description={stat ? `${stat.editable} movimiento${stat.editable === 1 ? "" : "s"} tuyo${stat.editable === 1 ? "" : "s"} con esta etiqueta` : undefined}>
      <div className="space-y-4 pb-2">
        <Field label="Renombrar o unificar" htmlFor="tag-name" hint="Si escribes una etiqueta que ya existe, se juntan en una sola.">
          <Input id="tag-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={stat?.tag.replace(/^#/, "")} autoCapitalize="none" />
        </Field>
        {merges && <p className="rounded-xl bg-wood-soft px-3 py-2 text-sm">Se unirá con <strong>{target}</strong>.</p>}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button variant="danger" onClick={remove} disabled={busy}><Trash2 size={16} /> Quitar</Button>
          <Button className="flex-1" onClick={rename} disabled={busy || !target || target === stat?.tag}>
            {merges ? `Unificar con ${target}` : target ? `Renombrar a ${target}` : "Renombrar"}
          </Button>
        </div>
        <p className="text-xs text-muted">Solo cambia en tus movimientos; los de tu pareja conservan sus etiquetas.</p>
      </div>
    </Sheet>
  );
}
