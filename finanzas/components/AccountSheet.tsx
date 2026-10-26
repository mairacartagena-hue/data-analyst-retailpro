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
import { projectCard } from "@/lib/finance/installments";
import { nextCuota, suggestSplit } from "@/lib/finance/credit";
import { formatCop } from "@/lib/finance/money";
import { monthName, todayBogota } from "@/lib/finance/periods";
import { SwitchRow } from "@/components/ui/switch";
import { AmountInput } from "@/components/AmountInput";
import { parseCop } from "@/lib/finance/money";
import { cn, errMsg } from "@/lib/utils";

const KINDS: AccountKind[] = ["DEPOSIT", "WALLET", "CASH", "CREDIT_CARD", "LOAN", "CREDIT"];
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
  const [rate, setRate] = useState("");
  const [term, setTerm] = useState("");
  const [costs, setCosts] = useState("");
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
    setRate(account?.interest_rate_ea ? String(account.interest_rate_ea).replace(".", ",") : "");
    setTerm(account?.term_months ? String(account.term_months) : "");
    setCosts(account?.monthly_costs ? String(account.monthly_costs) : "");
  }, [open, account]);

  const isCard = kind === "CREDIT_CARD";
  // Tarjetas y préstamos: el saldo inicial es lo que se debe hoy
  const isCredit = kind === "CREDIT";
  const isDebt = isCard || kind === "LOAN" || isCredit;

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Ponle un nombre.");
    if (last4 && !/^\d{4}$/.test(last4)) return setError("Los últimos 4 dígitos deben ser 4 números.");
    const aliasList = [...new Set(aliases.split(/[\s,;]+/).filter(Boolean))];
    if (aliasList.some((a) => !/^\d{4}$/.test(a))) return setError("Cada número adicional debe tener 4 dígitos, separados por comas.");
    const rateValue = rate.trim() ? Number(rate.replace(",", ".")) : null;
    if (isCredit && (!Number.isFinite(Number.parseInt(term, 10)) || Number.parseInt(term, 10) < 1)) return setError("Escribe el plazo en meses.");
    if ((isCard || isCredit) && rateValue != null && (!Number.isFinite(rateValue) || rateValue < 0 || rateValue > 200)) return setError("La tasa debe ser un porcentaje entre 0 y 200 (ej. 28,5).");
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
      opening_balance: isDebt ? -base : base,
      credit_limit: isCard ? parseCop(limit) : null,
      statement_day: isCard ? day(statementDay) : null,
      due_day: isCard || isCredit ? day(dueDay) : null,
      interest_rate_ea: isCard || isCredit ? rateValue : null,
      term_months: isCredit ? Math.min(600, Math.max(1, Number.parseInt(term, 10) || 0)) || null : null,
      monthly_costs: isCredit ? parseCop(costs) ?? 0 : 0,
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
        <Field label={isCard ? "Deuda actual de la tarjeta" : isCredit ? "Capital que falta por pagar" : kind === "LOAN" ? "Cuánto se debe hoy" : "Saldo actual"} hint={account ? "Es el saldo con el que empezó la cuenta en la app; los movimientos se suman aparte." : "El saldo de hoy. Desde aquí la app suma y resta los movimientos."}>
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
        {isCredit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plazo (meses)" htmlFor="term"><Input id="term" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
            <Field label="Día de pago" htmlFor="dd2"><Input id="dd2" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
            <Field label="Seguros y otros costos al mes" hint="Seguro de vida, de inmueble, cuotas de administración del crédito."><AmountInput value={costs} onChange={setCosts} /></Field>
          </div>
        )}
        {isCredit && account && <CreditPayments account={account} />}
        {isCard && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Cupo"><AmountInput value={limit} onChange={setLimit} /></Field>
            <Field label="Día de corte" htmlFor="sd"><Input id="sd" inputMode="numeric" value={statementDay} onChange={(e) => setStatementDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
            <Field label="Día de pago" htmlFor="dd"><Input id="dd" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
          </div>
        )}
        {isCard && account && (
          <CardProjection account={account} />
        )}
        {(isCard || isCredit) && (
          <Field label="Tasa de interés (% efectiva anual)" htmlFor="rate"
            hint="Sale en el extracto de la tarjeta. Sirve para estimar los intereses de las compras a cuotas; las de 1 cuota no pagan intereses.">
            <Input id="rate" inputMode="decimal" value={rate} placeholder="ej. 28,5" onChange={(e) => setRate(e.target.value.replace(/[^\d,.]/g, "").slice(0, 6))} />
          </Field>
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

/** Cuotas que faltan por pagar en la tarjeta, mes a mes: compras registradas en la app y compras del extracto. */
function CardProjection({ account }: { account: Account }) {
  const cardId = account.id;
  const { transactions, cardItems, supabase, reload, me } = useFinance();
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ description: "", amount: "", installments: "12", paid: "1", balance: "", rate: "" });
  const mine = cardItems.filter((i) => i.account_id === cardId);
  const card = { id: cardId, interest_rate_ea: account.interest_rate_ea ?? null, statement_day: account.statement_day, due_day: account.due_day, opening_at: account.opening_at };
  const byPayment = !!(account.statement_day && account.due_day && account.opening_at);
  const rows = projectCard(card, transactions, todayBogota(), 12, mine).filter((r) => r.purchases > 0);
  const total = rows.reduce((a, r) => a + r.total, 0);

  async function addItem() {
    setErr(null);
    const amount = parseCop(draft.amount) ?? 0;
    const n = Number.parseInt(draft.installments, 10) || 0;
    const paid = Number.parseInt(draft.paid, 10) || 0;
    const balance = parseCop(draft.balance) ?? amount;
    const rateValue = draft.rate.trim() ? Number(draft.rate.replace(",", ".")) : null;
    if (!draft.description.trim()) return setErr("Escribe la descripción de la compra.");
    if (amount <= 0 || n < 1 || n > 48 || paid < 0 || paid >= n) return setErr("Revisa el valor, las cuotas y la cuota actual.");
    if (balance < 0 || balance > amount) return setErr("El saldo pendiente no puede ser mayor que el valor de la compra.");
    const { error } = await supabase.from("card_statement_items").insert({
      account_id: cardId, description: draft.description.trim(), purchase_date: todayBogota(), amount, installments: n,
      paid_installments: paid, remaining_balance: balance, rate_ea: rateValue,
      household_id: me.household_id,
      owner_user_id: me.user_id,
    });
    if (error) return setErr(errMsg(error));
    setDraft({ description: "", amount: "", installments: "12", paid: "1", balance: "", rate: "" });
    setAdding(false);
    void reload();
  }

  async function removeItem(id: string) {
    if (!confirm("¿Quitar esta compra de la proyección? No borra ningún movimiento.")) return;
    await supabase.from("card_statement_items").delete().eq("id", id);
    void reload();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Cuotas de los próximos meses</p>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-sm text-muted">No hay cuotas pendientes en esta tarjeta.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {rows.map((r) => (
            <div key={r.month} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
              <span className="capitalize">{byPayment ? "Pago de " : ""}{monthName(Number(r.month.slice(5)) - 1, true)} {r.month.slice(0, 4)} <span className="text-xs text-muted">· {r.purchases} compra{r.purchases === 1 ? "" : "s"}</span></span>
              <span className="num font-semibold">{formatCop(r.total)}</span>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <p className="text-xs text-muted">Total de estos meses: {formatCop(total)} (capital más intereses estimados). Es una estimación; el plan de pagos del banco manda.{byPayment ? " Incluye lo que compres después del corte, en el extracto que lo factura." : ""}</p>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Compras del extracto que no registraste</p>
        <p className="text-xs text-muted">Solo suman a la proyección. No aparecen en Movimientos, presupuestos ni informes.</p>
        {mine.length > 0 && (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {mine.map((i) => (
              <div key={i.id} className="flex items-center gap-2 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.description}</span>
                  <span className="text-xs text-muted">Cuota {i.paid_installments} de {i.installments} · debe {formatCop(i.remaining_balance)}</span>
                </span>
                <button className="text-xs text-danger underline" onClick={() => void removeItem(i.id)}>Quitar</button>
              </div>
            ))}
          </div>
        )}
        {adding ? (
          <div className="space-y-2 rounded-2xl border border-border p-3">
            <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Descripción (comercio)" aria-label="Descripción" />
            <div className="grid grid-cols-2 gap-2">
              <AmountInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} />
              <Input inputMode="numeric" value={draft.installments} onChange={(e) => setDraft({ ...draft, installments: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="Cuotas" aria-label="Cuotas" />
              <Input inputMode="numeric" value={draft.paid} onChange={(e) => setDraft({ ...draft, paid: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="Cuota actual pagada" aria-label="Cuotas pagadas" />
              <AmountInput value={draft.balance} onChange={(v) => setDraft({ ...draft, balance: v })} />
            </div>
            <p className="text-xs text-muted">Valor de la compra, cuotas, cuotas ya cobradas y saldo que falta (“Saldo diferido” del extracto).</p>
            <Input inputMode="decimal" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value.replace(/[^\d,.]/g, "").slice(0, 6) })} placeholder={`Tasa E.A. (vacío = ${account.interest_rate_ea ?? "la de la tarjeta"})`} aria-label="Tasa" />
            <ErrorText>{err}</ErrorText>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void addItem()}>Agregar</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>+ Agregar compra del extracto</Button>
        )}
      </div>
    </div>
  );
}

/** Registrar una cuota del crédito: el capital baja la deuda (transferencia) y los intereses y costos son gastos. */
function CreditPayments({ account }: { account: Account }) {
  const { accounts, balances, categories, me, supabase, reload, transactions } = useFinance();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owed = Math.max(0, -(balances[account.id] ?? 0));
  const today = todayBogota();
  const next = nextCuota(owed, account.interest_rate_ea, account.term_months, account.opening_at, account.monthly_costs ?? 0, today);
  const [date, setDate] = useState(today);
  const [total, setTotal] = useState("");
  const [interest, setInterest] = useState("");
  const [costsPaid, setCostsPaid] = useState("");
  const [payFrom, setPayFrom] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const payAccounts = accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived && ["DEPOSIT", "WALLET", "CASH"].includes(a.kind));
  const expenseCats = categories.filter((c) => !c.archived && c.kind !== "INCOME");
  const totalN = parseCop(total) ?? 0;
  const split = suggestSplit(owed, account.interest_rate_ea, totalN, parseCop(costsPaid) ?? 0);
  const interestN = parseCop(interest) ?? split.interest;
  const costsN = parseCop(costsPaid) ?? 0;
  const capitalN = Math.max(0, totalN - interestN - costsN);
  const paidCount = transactions.filter((t) => t.account_id === account.id && t.kind === "TRANSFER" && t.description?.startsWith("Cuota crédito")).length;

  function openForm() {
    setOpen(true);
    setErr(null);
    setDate(today);
    setTotal(String(next || ""));
    const s = suggestSplit(owed, account.interest_rate_ea, next, account.monthly_costs ?? 0);
    setInterest(String(s.interest || ""));
    setCostsPaid(String(account.monthly_costs ?? ""));
    setPayFrom(payAccounts[0]?.id ?? "");
    setCategoryId("");
  }

  async function save() {
    setErr(null);
    if (totalN <= 0) return setErr("Escribe el valor de la cuota.");
    if (!payFrom) return setErr("Elige de qué cuenta se paga.");
    if (interestN + costsN > 0 && !categoryId) return setErr("Elige la categoría de los intereses y costos.");
    if (interestN + costsN > totalN) return setErr("Intereses y costos no pueden ser mayores que la cuota.");
    setBusy(true);
    if (capitalN > 0) {
      const r = await supabase.rpc("save_transaction", { p: {
        kind: "TRANSFER", amount: capitalN, occurred_on: date, description: `Cuota crédito · capital (${account.name})`,
        account_id: payFrom, to_account_id: account.id, creates_debt: false, tags: [],
      } });
      if (r.error) { setBusy(false); return setErr(errMsg(r.error)); }
    }
    if (interestN + costsN > 0) {
      const r = await supabase.rpc("save_transaction", { p: {
        kind: "EXPENSE", scope: "PERSONAL", amount: interestN + costsN, occurred_on: date,
        description: `Cuota crédito · intereses y costos (${account.name})`, account_id: payFrom, tags: [],
        splits: [{ amount: interestN + costsN, category_id: categoryId, responsible_user_id: me.user_id, origin: "NORMAL" }],
      } });
      if (r.error) { setBusy(false); return setErr(errMsg(r.error)); }
    }
    setBusy(false);
    setOpen(false);
    void reload();
  }

  return (
    <div className="space-y-2 rounded-2xl border border-border p-3">
      <p className="text-sm font-medium">Cuotas del crédito</p>
      <p className="text-xs text-muted">
        Debe {formatCop(owed)} · cuota estimada {formatCop(next)} · {paidCount} pagos registrados
      </p>
      {!open ? (
        <Button size="sm" variant="outline" onClick={openForm} disabled={owed <= 0}>Registrar cuota</Button>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fecha" htmlFor="cr-date"><Input id="cr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Valor de la cuota"><AmountInput value={total} onChange={setTotal} /></Field>
            <Field label="Intereses"><AmountInput value={interest} onChange={setInterest} /></Field>
            <Field label="Seguros y costos"><AmountInput value={costsPaid} onChange={setCostsPaid} /></Field>
          </div>
          <p className="text-xs text-muted">
            Sugerido con la tasa y el saldo: intereses {formatCop(split.interest)}. Capital que baja la deuda: <strong>{formatCop(capitalN)}</strong> (no es gasto). Ajusta los valores con el extracto del banco.
          </p>
          <Field label="Se paga desde">
            <Select value={payFrom} onChange={(e) => setPayFrom(e.target.value)}>
              {payAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          {interestN + costsN > 0 && (
            <Field label="Categoría de intereses y costos">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Elige una categoría</option>
                {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <ErrorText>{err}</ErrorText>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>Guardar cuota</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
