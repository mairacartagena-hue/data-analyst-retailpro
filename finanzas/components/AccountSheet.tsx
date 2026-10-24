"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import type { Account, ManualAsset, Visibility } from "@/lib/types";
import { ACCOUNT_KIND_LABEL, ASSET_TYPE_LABEL, VISIBILITY_LABEL } from "@/lib/types";
import type { AccountKind } from "@/lib/finance/safeToSpend";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { SwitchRow } from "@/components/ui/switch";
import { AmountInput } from "@/components/AmountInput";
import { parseCop } from "@/lib/finance/money";
import { cn, errMsg } from "@/lib/utils";

const KINDS: AccountKind[] = ["DEPOSIT", "WALLET", "CASH", "CREDIT_CARD"];
const VISIBILITIES: Visibility[] = ["PRIVATE", "BALANCE_ONLY", "PUBLIC"];

export function AccountSheet({ open, onOpenChange, account }: { open: boolean; onOpenChange: (v: boolean) => void; account: Account | null }) {
  const { me, supabase, reload, partner } = useFinance();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("DEPOSIT");
  const [institution, setInstitution] = useState("");
  const [last4, setLast4] = useState("");
  const [aliases, setAliases] = useState("");
  const [gmfMode, setGmfMode] = useState<"TAXED" | "EXEMPT_350" | "LOW_AMOUNT_65">("TAXED");
  const [openingDate, setOpeningDate] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("PRIVATE");
  const [reveal, setReveal] = useState(false);
  const [opening, setOpening] = useState("");
  const [limit, setLimit] = useState("");
  const [statementDay, setStatementDay] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(account?.name ?? "");
    setKind(account?.kind ?? "DEPOSIT");
    setInstitution(account?.institution ?? "");
    setLast4(account?.last4 ?? "");
    setAliases((account?.alias_last4 ?? []).join(", "));
    setGmfMode(account?.gmf_mode ?? "TAXED");
    setOpeningDate(account?.opening_at ? new Date(Date.parse(account.opening_at) - 5 * 3_600_000).toISOString().slice(0, 10) : "");
    setVisibility(account?.visibility ?? "PRIVATE");
    setReveal(account?.reveal_in_shared ?? false);
    const ob = account?.opening_balance ?? 0;
    setOpening(String(Math.abs(ob) || ""));
    setLimit(account?.credit_limit ? String(account.credit_limit) : "");
    setStatementDay(account?.statement_day ? String(account.statement_day) : "");
    setDueDay(account?.due_day ? String(account.due_day) : "");
  }, [open, account]);

  const isCard = kind === "CREDIT_CARD";

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Ponle un nombre.");
    if (last4 && !/^\d{4}$/.test(last4)) return setError("Los últimos 4 dígitos deben ser 4 números.");
    const aliasList = [...new Set(aliases.split(/[\s,;]+/).filter(Boolean))];
    if (aliasList.some((a) => !/^\d{4}$/.test(a))) return setError("Cada número adicional debe tener 4 dígitos, separados por comas.");
    const day = (v: string) => (v ? Math.min(31, Math.max(1, Number(v))) : null);
    const base = parseCop(opening) ?? 0;
    const row = {
      name: name.trim(),
      kind,
      institution: institution.trim() || null,
      last4: last4 || null,
      alias_last4: aliasList.filter((a) => a !== last4),
      gmf_mode: kind === "DEPOSIT" || kind === "WALLET" ? gmfMode : "TAXED",
      // Fecha del saldo: los movimientos desde ese día (hora Colombia) cuentan; los anteriores ya estaban incluidos
      ...(openingDate ? { opening_at: new Date(`${openingDate}T00:00:00-05:00`).toISOString() } : {}),
      visibility,
      reveal_in_shared: visibility === "PRIVATE" ? reveal : false,
      // En tarjetas el saldo inicial es la deuda actual (se guarda negativa)
      opening_balance: isCard ? -base : base,
      credit_limit: isCard ? parseCop(limit) : null,
      statement_day: isCard ? day(statementDay) : null,
      due_day: isCard ? day(dueDay) : null,
    };
    setBusy(true);
    const { error } = account
      ? await supabase.from("accounts").update(row).eq("id", account.id)
      : await supabase.from("accounts").insert({ ...row, household_id: me.household_id, owner_user_id: me.user_id });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  async function toggleArchive() {
    if (!account) return;
    setBusy(true);
    const { error } = await supabase.from("accounts").update({ archived: !account.archived }).eq("id", account.id);
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={account ? "Editar cuenta" : "Nueva cuenta"}>
      <div className="space-y-4 pb-2">
        <Field label="Tipo">
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} disabled={!!account}
                className={cn("rounded-2xl border px-3 py-2.5 text-left text-sm disabled:opacity-60", kind === k ? "border-olive bg-olive-soft font-semibold" : "border-border bg-surface")}>
                {ACCOUNT_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Nombre" htmlFor="acc-name">
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nequi, Ahorros Bancolombia, Visa…" maxLength={60} />
        </Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Banco o app (opcional)" htmlFor="inst">
            <Input id="inst" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Bancolombia" />
          </Field>
          <Field label="Últimos 4" htmlFor="last4">
            <Input id="last4" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="1234" />
          </Field>
        </div>
        <Field label="Otros números de esta cuenta (opcional)" htmlFor="aliases"
          hint="Últimos 4 dígitos de otras tarjetas o productos que llegan en los avisos de esta cuenta, separados por comas. Ej.: la tarjeta débito de tu cuenta de ahorros.">
          <Input id="aliases" value={aliases} onChange={(e) => setAliases(e.target.value.replace(/[^\d,\s]/g, ""))} inputMode="numeric" placeholder="7473, 1234" />
        </Field>
        <Field label={isCard ? "Deuda actual de la tarjeta" : "Saldo actual"} hint={account ? "Es el saldo con el que empezó la cuenta en la app; los movimientos se suman aparte." : "El saldo de hoy. Desde aquí la app suma y resta los movimientos."}>
          <AmountInput value={opening} onChange={setOpening} />
        </Field>
        {account && (
          <Field label="Fecha de ese saldo" htmlFor="opening-date"
            hint="Los movimientos desde esta fecha suman o restan. Los de antes ya estaban incluidos en el saldo que escribiste.">
            <Input id="opening-date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </Field>
        )}
        {(kind === "DEPOSIT" || kind === "WALLET") && (
          <Field label="4x1000 (GMF)">
            <Select value={gmfMode} onChange={(e) => setGmfMode(e.target.value as typeof gmfMode)}>
              <option value="TAXED">Me cobran 4x1000</option>
              <option value="EXEMPT_350">Exenta (hasta 350 UVT al mes)</option>
              <option value="LOW_AMOUNT_65">Depósito de bajo monto, como Nequi (hasta 65 UVT al mes)</option>
            </Select>
          </Field>
        )}
        {isCard && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Cupo"><AmountInput value={limit} onChange={setLimit} /></Field>
            <Field label="Día de corte" htmlFor="sd"><Input id="sd" inputMode="numeric" value={statementDay} onChange={(e) => setStatementDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
            <Field label="Día de pago" htmlFor="dd"><Input id="dd" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
          </div>
        )}
        <Field label={`¿Qué puede ver ${partner?.display_name ?? "tu pareja"}?`}
          hint="La cuenta sigue siendo tuya. Tus movimientos personales nunca se muestran; los del hogar sí, sin importar con qué cuenta los pagues.">
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            {VISIBILITIES.map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
          </Select>
        </Field>
        {visibility === "PRIVATE" && (
          <SwitchRow label="Mostrar el nombre en gastos compartidos"
            hint="Cuando pagues algo del hogar con esta cuenta, tu pareja verá su nombre en vez de “Cuenta privada”. El saldo sigue oculto."
            checked={reveal} onCheckedChange={setReveal} />
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          {account && (
            <Button variant="secondary" size="icon" onClick={toggleArchive} disabled={busy} aria-label={account.archived ? "Restaurar" : "Archivar"}>
              {account.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
            </Button>
          )}
          <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</Button>
        </div>
      </div>
    </Sheet>
  );
}

const ASSET_TYPES: ManualAsset["asset_type"][] = ["INVESTMENT", "PROPERTY", "VEHICLE", "LOAN", "MORTGAGE", "OTHER"];

/** Activos y pasivos manuales para el patrimonio neto (inversiones, bienes, créditos). */
export function AssetSheet({ open, onOpenChange, asset }: { open: boolean; onOpenChange: (v: boolean) => void; asset: ManualAsset | null }) {
  const { me, supabase, reload } = useFinance();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ManualAsset["kind"]>("ASSET");
  const [type, setType] = useState<ManualAsset["asset_type"]>("INVESTMENT");
  const [value, setValue] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(asset?.name ?? "");
    setKind(asset?.kind ?? "ASSET");
    setType(asset?.asset_type ?? "INVESTMENT");
    setValue(asset ? String(asset.value) : "");
    setShared(asset?.visibility === "PUBLIC");
  }, [open, asset]);

  async function save() {
    if (!name.trim()) return setError("Ponle un nombre.");
    const row = { name: name.trim(), kind, asset_type: type, value: parseCop(value) ?? 0, visibility: shared ? "PUBLIC" : "PRIVATE" };
    setBusy(true);
    const { error } = asset
      ? await supabase.from("manual_assets").update(row).eq("id", asset.id)
      : await supabase.from("manual_assets").insert({ ...row, household_id: me.household_id, owner_user_id: me.user_id });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  async function remove() {
    if (!asset || !confirm("¿Borrar este registro?")) return;
    const { error } = await supabase.from("manual_assets").delete().eq("id", asset.id);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={asset ? "Editar" : "Activo o pasivo"}>
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-2 gap-2">
          {(["ASSET", "LIABILITY"] as const).map((k) => (
            <button key={k} type="button" onClick={() => { setKind(k); setType(k === "ASSET" ? "INVESTMENT" : "LOAN"); }} aria-pressed={kind === k}
              className={cn("rounded-2xl border px-3 py-2.5 text-sm", kind === k ? "border-olive bg-olive-soft font-semibold" : "border-border bg-surface")}>
              {k === "ASSET" ? "Activo (lo que tengo)" : "Pasivo (lo que debo)"}
            </button>
          ))}
        </div>
        <Field label="Nombre" htmlFor="asset-name"><Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="CDT, carro, crédito de vivienda…" /></Field>
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as ManualAsset["asset_type"])}>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label={kind === "ASSET" ? "Valor actual" : "Saldo pendiente"}><AmountInput value={value} onChange={setValue} /></Field>
        <SwitchRow label="Mi pareja lo puede ver" hint="Cuenta en el patrimonio del hogar." checked={shared} onCheckedChange={setShared} />
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          {asset && <Button variant="danger" onClick={remove} disabled={busy}>Borrar</Button>}
          <Button className="flex-1" size="lg" onClick={save} disabled={busy}>Guardar</Button>
        </div>
      </div>
    </Sheet>
  );
}
