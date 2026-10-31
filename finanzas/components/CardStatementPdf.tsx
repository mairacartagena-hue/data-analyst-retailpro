"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/types";
import type { CardStatementData } from "@/lib/capture/cardStatement";
import { formatCop } from "@/lib/finance/money";
import { todayBogota } from "@/lib/finance/periods";
import { shrink, toBase64 } from "@/lib/capture/file";
import { cn, errMsg } from "@/lib/utils";

/** Cierre de una tarjeta: la IA lee el extracto (PDF o foto), propone la deuda y las compras a cuotas; la persona revisa. */
export function CardStatementPdf({ account, onBalance }: { account: Account; onBalance: (v: number) => void }) {
  const { cardItems, supabase, reload, me } = useFinance();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [read, setRead] = useState<CardStatementData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const known = new Set(cardItems.filter((i) => i.account_id === account.id).map((i) => `${i.description.toLowerCase()}|${Math.round(i.amount)}`));
  const fresh = (read?.purchases ?? []).filter((p) => !known.has(`${p.description.toLowerCase()}|${p.amount}`));

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    setNotice(null);
    setRead(null);
    if (!navigator.onLine) return setErr("Sin conexión: para leer el extracto necesitas internet.");
    setBusy(true);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const payload = isPdf ? { data: await toBase64(file), mime: "application/pdf" } : await shrink(file, 2400);
      if (payload.data.length > 4_200_000) throw new Error("El archivo es muy pesado (máximo ~3 MB). Prueba con una foto o el PDF del banco.");
      const res = await fetch("/api/card-statement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, today: todayBogota() }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: CardStatementData; error?: string };
      if (!body.ok || !body.result) throw new Error(body.error ?? "No se pudo leer el extracto.");
      const r = body.result;
      if (r.totalDebt === undefined && r.purchases.length === 0) throw new Error("No encontré la deuda ni las compras a cuotas en ese archivo.");
      setRead(r);
      if (r.totalDebt !== undefined) onBalance(r.totalDebt);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function addPurchases() {
    if (fresh.length === 0) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("card_statement_items").insert(fresh.map((p) => ({
      account_id: account.id, description: p.description, purchase_date: p.purchaseDate, amount: p.amount, installments: p.installments,
      paid_installments: p.paidInstallments, remaining_balance: p.remainingBalance, rate_ea: p.rateEa ?? null,
      household_id: me.household_id, owner_user_id: me.user_id,
    })));
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setNotice(`Agregué ${fresh.length} compra${fresh.length === 1 ? "" : "s"} a cuotas a la proyección de la tarjeta.`);
    setRead({ ...read!, purchases: [] });
    void reload();
  }

  return (
    <div className="space-y-2 rounded-2xl border border-dashed border-border p-3">
      <label className={cn("flex cursor-pointer items-center gap-2 text-sm font-medium text-olive", busy && "pointer-events-none opacity-60")}>
        <FileUp size={18} />
        {busy ? "Leyendo el extracto…" : "Cargar el PDF o foto del extracto de la tarjeta"}
        <input type="file" accept="application/pdf,image/*" className="hidden" disabled={busy}
          onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {!read && !err && !notice && <p className="text-xs text-muted">La IA lee la deuda al corte y las compras a cuotas. Revisa antes de guardar. El archivo no se guarda.</p>}
      {read && (
        <div className="space-y-2 text-xs">
          {read.totalDebt !== undefined && <p>Deuda al corte{read.statementDate ? ` (${read.statementDate})` : ""}: <strong className="num">{formatCop(read.totalDebt)}</strong>. Ya la puse abajo como deuda según tu extracto.</p>}
          {read.totalPayment !== undefined && <p className="text-muted">Pago total {formatCop(read.totalPayment)}{read.minimumPayment !== undefined ? ` · mínimo ${formatCop(read.minimumPayment)}` : ""}.</p>}
          {fresh.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-medium">{fresh.length} compra{fresh.length === 1 ? "" : "s"} a cuotas que no están en la app:</p>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {fresh.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0 truncate">{p.description} <span className="text-muted">· cuota {p.paidInstallments} de {p.installments}</span></span>
                    <span className="num shrink-0">{formatCop(p.remainingBalance)}</span>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="outline" onClick={addPurchases} disabled={busy}>Agregar a la proyección de cuotas</Button>
            </div>
          )}
        </div>
      )}
      {notice && <p className="text-xs text-olive">{notice}</p>}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}
