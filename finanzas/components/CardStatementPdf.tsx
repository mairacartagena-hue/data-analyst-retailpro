"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Button } from "@/components/ui/button";
import { StatementFields, saveStatement, emptyDraft, type StatementDraft } from "@/components/CardStatements";
import type { Account } from "@/lib/types";
import type { CardStatementData, CardStatementPurchase } from "@/lib/capture/cardStatement";
import { knownItem, registeredTx } from "@/lib/finance/cardStatements";
import { installmentsOf } from "@/lib/finance/installments";
import { openingDay } from "@/lib/finance/cardBudget";
import { formatCop } from "@/lib/finance/money";
import { todayBogota } from "@/lib/finance/periods";
import { shrink, toBase64 } from "@/lib/capture/file";
import { cn, errMsg } from "@/lib/utils";

/**
 * La IA lee el extracto de la tarjeta (PDF o foto). La persona revisa y guarda:
 *  · el extracto (corte, fecha de pago, pago mínimo, pago total y deuda), editable, para cruzarlo con la app;
 *  · las compras a cuotas que no están en la app, una por una, para la proyección.
 * Las compras que ya están (como compra del extracto o registradas en la app con las mismas cuotas) no se repiten.
 */
export function CardStatementPdf({ account, onBalance }: { account: Account; onBalance?: (v: number) => void }) {
  const { cardItems, transactions, supabase, reload, me } = useFinance();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [read, setRead] = useState<CardStatementData | null>(null);
  const [draft, setDraft] = useState<StatementDraft>(emptyDraft);
  const [notice, setNotice] = useState<string | null>(null);

  const purchases = read?.purchases ?? [];
  const inCard = (p: CardStatementPurchase) => !!knownItem(p, cardItems, account.id);
  const inApp = (p: CardStatementPurchase) => {
    const t = registeredTx(p, transactions, account.id);
    return !!t && installmentsOf(t) === p.installments;
  };
  const fresh = purchases.filter((p) => !inCard(p) && !inApp(p));
  const already = purchases.length - fresh.length;

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
      if (r.totalDebt === undefined && r.minimumPayment === undefined && r.purchases.length === 0) throw new Error("No encontré la deuda ni las compras a cuotas en ese archivo.");
      setRead(r);
      const s = (v?: number) => (v === undefined ? "" : String(v));
      setDraft({ cut: r.statementDate ?? "", due: r.dueDate ?? "", minimum: s(r.minimumPayment), total: s(r.totalPayment), debt: s(r.totalDebt) });
      if (r.totalDebt !== undefined) onBalance?.(r.totalDebt);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!read) return;
    setBusy(true);
    setErr(null);
    const e = await saveStatement(supabase, account, me.user_id, draft, "PDF");
    if (e) { setBusy(false); return setErr(e); }
    // Compras de un extracto posterior al registro de la tarjeta: su saldo se factura desde el corte siguiente a este
    const open = account.opening_at ? openingDay(account.opening_at) : null;
    const asOf = draft.cut && open && draft.cut > open ? draft.cut : null;
    if (fresh.length > 0) {
      const { error } = await supabase.from("card_statement_items").insert(fresh.map((p) => ({
        account_id: account.id, description: p.description, purchase_date: p.purchaseDate, amount: p.amount, installments: p.installments,
        paid_installments: p.paidInstallments, remaining_balance: p.remainingBalance, rate_ea: p.rateEa ?? null,
        household_id: me.household_id, owner_user_id: me.user_id, ...(asOf ? { as_of: asOf } : {}),
      })));
      if (error) { setBusy(false); void reload(); return setErr(`El extracto quedó guardado, pero no las compras: ${errMsg(error)}`); }
    }
    setBusy(false);
    setNotice(`Guardé el extracto${fresh.length ? ` y ${fresh.length} compra${fresh.length === 1 ? "" : "s"} a cuotas en la proyección` : ""}. El cruce queda en “Extractos y cruce con la app”.`);
    setRead(null);
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
      {!read && !err && !notice && <p className="text-xs text-muted">La IA lee el pago mínimo, el total, la deuda y cada compra a cuotas. Revisa antes de guardar. El archivo no se guarda.</p>}
      {read && (
        <div className="space-y-3 text-xs">
          <p className="font-medium">Revisa lo que leí (puedes corregirlo):</p>
          <StatementFields value={draft} onChange={setDraft} />
          {onBalance && read.totalDebt !== undefined && <p className="text-muted">Ya puse la deuda abajo como deuda según tu extracto.</p>}
          {purchases.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-medium">
                {fresh.length > 0 ? `${fresh.length} compra${fresh.length === 1 ? "" : "s"} a cuotas nueva${fresh.length === 1 ? "" : "s"}` : "No hay compras a cuotas nuevas"}
                {already > 0 ? ` · ${already} ya estaba${already === 1 ? "" : "n"} en la tarjeta o en la app` : ""}
              </p>
              {fresh.length > 0 && (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                  {fresh.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="min-w-0 truncate">{p.description} <span className="text-muted">· cuota {p.paidInstallments} de {p.installments}</span></span>
                      <span className="num shrink-0">{formatCop(p.remainingBalance)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy}>Guardar extracto{fresh.length ? " y compras" : ""}</Button>
            <Button size="sm" variant="ghost" onClick={() => setRead(null)} disabled={busy}>Descartar</Button>
          </div>
        </div>
      )}
      {notice && <p className="text-xs text-olive">{notice}</p>}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}
