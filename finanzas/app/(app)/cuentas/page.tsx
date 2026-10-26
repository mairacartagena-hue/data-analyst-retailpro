"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, CreditCard, Handshake, Landmark, Lock, Plus, Smartphone, Wallet } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { AccountSheet, AssetSheet } from "@/components/AccountSheet";
import { MemberBadge } from "@/components/MemberBadge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { CruceView } from "@/components/views/CruceView";
import { Card, SectionTitle } from "@/components/ui/card";
import type { Account, ManualAsset } from "@/lib/types";
import { ASSET_TYPE_LABEL, VISIBILITY_LABEL } from "@/lib/types";
import { formatCop } from "@/lib/finance/money";
import { responsibleOf } from "@/lib/finance/derive";
import { cn } from "@/lib/utils";

const ICONS = { DEPOSIT: Landmark, WALLET: Smartphone, CASH: Wallet, CREDIT_CARD: CreditCard, LOAN: Handshake, CREDIT: Building2 };

export default function CuentasPage() {
  const { accounts, balances, me, partner, assets, memberById } = useFinance();
  const [editing, setEditing] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState<ManualAsset | null>(null);
  const [assetOpen, setAssetOpen] = useState(false);
  const [view, setView] = useState<"cuentas" | "cruce">("cuentas");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("vista") === "cruce") setView("cruce");
  }, []);
  function changeView(v: "cuentas" | "cruce") {
    setView(v);
    window.history.replaceState(null, "", v === "cruce" ? "/cuentas?vista=cruce" : "/cuentas");
  }

  const mine = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived);
  const archived = accounts.filter((a) => a.owner_user_id === me.user_id && a.archived);
  const theirs = accounts.filter((a) => a.owner_user_id !== me.user_id && !a.archived);
  const myAssets = assets.filter((a) => a.owner_user_id === me.user_id);
  const theirAssets = assets.filter((a) => a.owner_user_id !== me.user_id);

  const row = (a: Account, editable: boolean) => {
    const Icon = ICONS[a.kind];
    const bal = balances[a.id];
    const isCard = a.kind === "CREDIT_CARD";
    // Quién paga la tarjeta o el crédito
    const payer = a.kind === "CREDIT_CARD" || a.kind === "LOAN" || a.kind === "CREDIT" ? responsibleOf(a) : null;
    const payerName = payer ? (payer === me.user_id ? "tú" : memberById(payer)?.display_name ?? "") : "";
    return (
      <button key={a.id} disabled={!editable} onClick={() => { setEditing(a); setOpen(true); }}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left enabled:hover:bg-surface-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2"><Icon size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{a.name}{a.last4 ? ` ··${a.last4}` : ""}</span>
          <span className="flex items-center gap-1 text-xs text-muted">
            {a.visibility === "PRIVATE" && <Lock size={11} />}
            {editable ? VISIBILITY_LABEL[a.visibility].split(":")[0] : a.institution ?? ""}
            {isCard && a.due_day ? ` · paga el ${a.due_day}` : ""}
            {payerName ? ` · responsable: ${payerName}` : ""}
          </span>
        </span>
        <span className="text-right">
          {bal === undefined ? (
            <span className="text-xs text-muted">Saldo oculto</span>
          ) : (
            <>
              <span className={cn("num block font-semibold", (isCard || a.kind === "LOAN" || a.kind === "CREDIT") && bal < 0 && "text-danger")}>
                {isCard || a.kind === "LOAN" || a.kind === "CREDIT" ? (bal < 0 ? `Debe ${formatCop(-bal)}` : formatCop(bal)) : formatCop(bal)}
              </span>
              {isCard && a.credit_limit ? <span className="num block text-xs text-muted">Disponible {formatCop(a.credit_limit + Math.min(0, bal))}</span> : null}
            </>
          )}
        </span>
      </button>
    );
  };

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <Link href="/mas" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
          <h1 className="font-display text-3xl">{view === "cruce" ? "Cruce" : "Cuentas"}</h1>
        </div>
        {view === "cuentas" && <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Nueva</Button>}
      </div>
      <Segmented className="mb-2" value={view} onChange={changeView} options={[
        { value: "cuentas", label: "Mis cuentas" },
        { value: "cruce", label: "Cruce con mi pareja" },
      ]} />

      {view === "cruce" ? <CruceView /> : (<>

      <SectionTitle>Mis cuentas y tarjetas</SectionTitle>
      {mine.length === 0 ? (
        <Card className="space-y-2 text-center">
          <p className="text-[15px]">Agrega tus cuentas de ahorros, Nequi, efectivo y tarjetas de crédito.</p>
          <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Agregar cuenta</Button>
        </Card>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">{mine.map((a) => row(a, true))}</div>
      )}

      {partner && (
        <>
          <SectionTitle className="flex items-center gap-2"><MemberBadge member={partner} size={18} /> De {partner.display_name}</SectionTitle>
          {theirs.length === 0 ? (
            <p className="px-1 text-sm text-muted">{partner.display_name} no ha compartido cuentas contigo.</p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">{theirs.map((a) => row(a, false))}</div>
          )}
        </>
      )}

      <div className="mt-6 flex items-center justify-between">
        <SectionTitle className="m-0">Otros activos y pasivos</SectionTitle>
        <Button size="sm" variant="ghost" onClick={() => { setAsset(null); setAssetOpen(true); }}><Plus size={16} /> Agregar</Button>
      </div>
      <p className="mb-2 px-1 text-xs text-muted">Inversiones, bienes o créditos que suman al patrimonio neto. Los valores los actualizas tú.</p>
      {[...myAssets, ...theirAssets].length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {[...myAssets, ...theirAssets].map((a) => (
            <button key={a.id} disabled={a.owner_user_id !== me.user_id} onClick={() => { setAsset(a); setAssetOpen(true); }}
              className="flex w-full items-center justify-between px-3.5 py-3 text-left enabled:hover:bg-surface-2">
              <span>
                <span className="block font-medium">{a.name}</span>
                <span className="text-xs text-muted">{ASSET_TYPE_LABEL[a.asset_type]}{a.owner_user_id !== me.user_id ? ` · de ${partner?.display_name}` : a.visibility === "PRIVATE" ? " · privado" : ""}</span>
              </span>
              <span className={cn("num font-semibold", a.kind === "LIABILITY" && "text-danger")}>{a.kind === "LIABILITY" ? "−" : ""}{formatCop(a.value)}</span>
            </button>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <>
          <SectionTitle>Archivadas</SectionTitle>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-dashed border-border opacity-70">{archived.map((a) => row(a, true))}</div>
        </>
      )}

      </>)}

      <AccountSheet open={open} onOpenChange={setOpen} account={editing} />
      <AssetSheet open={assetOpen} onOpenChange={setAssetOpen} asset={asset} />
    </main>
  );
}
