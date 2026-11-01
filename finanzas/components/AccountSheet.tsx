"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, FileUp } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import type { Account, CardStatementItem, ManualAsset, Visibility } from "@/lib/types";
import type { CardStatementData } from "@/lib/capture/cardStatement";
import { cardBudgetVersions } from "@/lib/finance/cardBudget";
import { ACCOUNT_KIND_LABEL, ASSET_TYPE_LABEL, VISIBILITY_LABEL } from "@/lib/types";
import type { AccountKind } from "@/lib/finance/safeToSpend";
import { Sheet } from "@/components/ui/sheet";
import { Collapsible } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { projectCard } from "@/lib/finance/installments";
import { capitalPaidRatio, installmentLabel, installmentsPaid, nextCuota, suggestSplit } from "@/lib/finance/credit";
import { formatCop } from "@/lib/finance/money";
import { monthName, periodFor, todayBogota } from "@/lib/finance/periods";
import { CategoryOptions } from "@/components/CategoryPicker";
import { ensureCategory } from "@/lib/finance/ensureCategory";
import { responsibleOf, toBudgetCategories } from "@/lib/finance/derive";
import { budgetVersionAt } from "@/lib/finance/budget";
import { categoryPath } from "@/lib/finance/spaces";
import { normalizeMerchant } from "@/lib/ingest/normalize";
import { SwitchRow } from "@/components/ui/switch";
import { AmountInput } from "@/components/AmountInput";
import { parseCop } from "@/lib/finance/money";
import { cn, errMsg } from "@/lib/utils";
import { shrink, toBase64 } from "@/lib/capture/file";
import { currentInstallmentFrom, type CreditStatementData } from "@/lib/capture/creditStatement";
import { effectOn } from "@/lib/finance/reconcile";
import { CreditPaymentAdjust } from "@/components/CreditPaymentAdjust";

const KINDS: AccountKind[] = ["DEPOSIT", "WALLET", "CASH", "CREDIT_CARD", "LOAN", "CREDIT"];
const VISIBILITIES: Visibility[] = ["PRIVATE", "BALANCE_ONLY", "PUBLIC"];

export function AccountSheet({ open, onOpenChange, account, defaultKind = "DEPOSIT", startCuota = false }: { open: boolean; onOpenChange: (v: boolean) => void; account: Account | null; defaultKind?: AccountKind; startCuota?: boolean }) {
  const finance = useFinance();
  const { me, supabase, reload, partner, categories } = finance;
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
  const [currentInst, setCurrentInst] = useState("");
  const [original, setOriginal] = useState("");
  const [fixedCuota, setFixedCuota] = useState("");
  const [responsible, setResponsible] = useState("");
  const [inBudget, setInBudget] = useState(false);
  const [budgetCat, setBudgetCat] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [cardDrafts, setCardDrafts] = useState<CardDraft[]>([]);
  const [cutDate, setCutDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCardDrafts([]);
    setCutDate("");
    setInBudget(false);
    setBudgetCat("");
    setBudgetAmount("");
    setName(account?.name ?? "");
    setKind(account?.kind ?? defaultKind);
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
    setOriginal(account?.original_amount ? String(account.original_amount) : "");
    setFixedCuota(account?.installment_amount ? String(Math.round(account.installment_amount)) : "");
    const paidNow = account?.kind === "CREDIT" ? installmentsPaid(account, todayBogota()) : null;
    setCurrentInst(paidNow != null && account?.term_months ? String(Math.min(paidNow + 1, account.term_months)) : "");
    setResponsible(account?.responsible_user_id && account.responsible_user_id !== account.owner_user_id ? account.responsible_user_id : "");
  }, [open, account]);

  const isCard = kind === "CREDIT_CARD";
  // Tarjetas y préstamos: el saldo inicial es lo que se debe hoy
  const isCredit = kind === "CREDIT";
  const isDebt = isCard || kind === "LOAN" || isCredit;

  // Cuota que calcula la app con lo que hay en el formulario (sirve también antes de guardar el crédito)
  const formCuota = (() => {
    if (!isCredit) return 0;
    const today = todayBogota();
    const termN = Number.parseInt(term, 10) || 0;
    const instN = Number.parseInt(currentInst, 10);
    return nextCuota(parseCop(opening) ?? 0, {
      interest_rate_ea: rate.trim() ? Number(rate.replace(",", ".")) || 0 : 0,
      term_months: termN || null,
      monthly_costs: parseCop(costs) ?? 0,
      due_day: dueDay ? Number(dueDay) : null,
      installment_amount: parseCop(fixedCuota) || null,
      ...(instN >= 1 ? { paid_installments: instN - 1, paid_installments_on: today } : { opening_at: openingDate || today }),
    }, today);
  })();

  // Tarjeta nueva: la deuda total es el saldo al corte más lo que falta de las compras a cuotas del extracto
  const deferredTotal = cardDrafts.reduce((a, d) => a + d.balance, 0);
  const newCardDebt = (parseCop(opening) ?? 0) + deferredTotal;

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Ponle un nombre.");
    const today = todayBogota();
    if (isCard && !account && cutDate && cutDate > today) return setError("La fecha de corte no puede ser futura.");
    if (last4 && !/^\d{4}$/.test(last4)) return setError("Los últimos 4 dígitos deben ser 4 números.");
    const aliasList = [...new Set(aliases.split(/[\s,;]+/).filter(Boolean))];
    if (aliasList.some((a) => !/^\d{4}$/.test(a))) return setError("Cada número adicional debe tener 4 dígitos, separados por comas.");
    const rateValue = rate.trim() ? Number(rate.replace(",", ".")) : null;
    if (isCredit && (!Number.isFinite(Number.parseInt(term, 10)) || Number.parseInt(term, 10) < 1)) return setError("Escribe el plazo en meses.");
    const instN = Number.parseInt(currentInst, 10);
    if (isCredit && currentInst && (!(instN >= 1) || instN > Number.parseInt(term, 10))) return setError("La cuota en la que vas debe estar entre 1 y el número de cuotas.");
    if ((isCard || isCredit) && rateValue != null && (!Number.isFinite(rateValue) || rateValue < 0 || rateValue > 200)) return setError("La tasa debe ser un porcentaje entre 0 y 200 (ej. 28,5).");
    if (isDebt && responsible && responsible !== me.user_id && visibility === "PRIVATE") return setError(`Para que ${partner?.display_name ?? "tu pareja"} vea la deuda, la cuenta no puede ser privada: elige que vea el saldo o todo.`);
    const day = (v: string) => (v ? Math.min(31, Math.max(1, Number(v))) : null);
    const base = isCard && !account ? newCardDebt : parseCop(opening) ?? 0;
    // Tarjeta nueva con fecha de corte: el saldo es el de ese corte, así que las compras desde el día siguiente suman aparte
    const cardOpening = isCard && !account && cutDate
      ? new Date(Date.parse(`${cutDate}T00:00:00-05:00`) + 86_400_000).toISOString()
      : null;
    const row = {
      name: name.trim(),
      kind,
      institution: institution.trim() || null,
      last4: last4 || null,
      alias_last4: aliasList.filter((a) => a !== last4),
      gmf_mode: kind === "DEPOSIT" || kind === "WALLET" ? gmfMode : "TAXED",
      // Fecha del saldo: los movimientos desde ese día (hora Colombia) cuentan; los anteriores ya estaban incluidos
      ...(cardOpening ? { opening_at: cardOpening } : openingDate ? { opening_at: new Date(`${openingDate}T00:00:00-05:00`).toISOString() } : {}),
      visibility,
      reveal_in_shared: visibility === "PRIVATE" ? reveal : false,
      // En tarjetas el saldo inicial es la deuda actual (se guarda negativa)
      opening_balance: isDebt ? -base : base,
      credit_limit: isCard ? parseCop(limit) : null,
      statement_day: isCard || isCredit ? day(statementDay) : null,
      due_day: isCard || isCredit ? day(dueDay) : null,
      interest_rate_ea: isCard || isCredit ? rateValue : null,
      term_months: isCredit ? Math.min(600, Math.max(1, Number.parseInt(term, 10) || 0)) || null : null,
      monthly_costs: isCredit ? parseCop(costs) ?? 0 : 0,
      original_amount: isCredit ? (parseCop(original) || null) : null,
      installment_amount: isCredit ? (parseCop(fixedCuota) || null) : null,
      // "Voy en la cuota 38": quedan 37 pagadas a hoy; cada día de pago que pase suma una
      ...(isCredit && currentInst ? { paid_installments: instN - 1, paid_installments_on: todayBogota() } : {}),
      responsible_user_id: isDebt && responsible && responsible !== me.user_id ? responsible : null,
    };
    const budgetValue = isCredit && !account && inBudget ? (parseCop(budgetAmount) || formCuota) : 0;
    if (isCredit && !account && inBudget && budgetValue <= 0) return setError("Escribe el valor de la cuota para el presupuesto.");
    if (isCard && !account && inBudget && (!statementDay || !dueDay || !cutDate)) return setError("Para incluir la tarjeta en Presupuestos escribe la fecha de corte del extracto y el día de pago.");
    setBusy(true);
    if (account) {
      const { error } = await supabase.from("accounts").update(row).eq("id", account.id);
      if (error) { setBusy(false); return setError(errMsg(error)); }
    } else {
      const { data, error } = await supabase.from("accounts").insert({ ...row, household_id: me.household_id, owner_user_id: me.user_id }).select().single();
      if (error) { setBusy(false); return setError(errMsg(error)); }
      if (isCard && cardDrafts.length > 0 && data) {
        const r = await supabase.from("card_statement_items").insert(cardDrafts.map((d) => ({
          account_id: (data as Account).id, description: d.description, purchase_date: d.purchaseDate ?? (cutDate || todayBogota()), amount: d.amount, installments: d.installments,
          paid_installments: d.paid, remaining_balance: d.balance, rate_ea: d.rate,
          household_id: me.household_id, owner_user_id: me.user_id,
        })));
        if (r.error) {
          setBusy(false);
          void reload();
          return setError(`La tarjeta quedó guardada, pero no se pudieron guardar las cuotas: ${errMsg(r.error)}. Ábrela de nuevo y agrégalas.`);
        }
      }
      if (isCard && inBudget && data) {
        try {
          const saved = { ...(data as Account), opening_balance: Number((data as Account).opening_balance) };
          const items = cardDrafts.map((d, i) => ({ id: `draft-${i}`, account_id: saved.id, description: d.description, purchase_date: d.purchaseDate ?? today,
            amount: d.amount, installments: d.installments, paid_installments: d.paid, remaining_balance: d.balance, rate_ea: d.rate }));
          await linkCardBudget(finance, saved, items, budgetCat);
        } catch (e) {
          setBusy(false);
          void reload();
          return setError(`La tarjeta quedó guardada, pero no se pudo crear el presupuesto: ${errMsg(e)}. Ábrela de nuevo y activa el interruptor.`);
        }
      }
      if (budgetValue > 0 && data) {
        try {
          await linkCreditBudget(finance, data as Account, budgetCat, budgetValue);
        } catch (e) {
          setBusy(false);
          void reload();
          return setError(`El crédito quedó guardado, pero no se pudo crear el presupuesto: ${errMsg(e)}. Ábrelo de nuevo y activa el interruptor.`);
        }
      }
    }
    setBusy(false);
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
    <Sheet open={open} onOpenChange={onOpenChange} title={account ? "Editar cuenta" : "Nueva cuenta"}
      footer={<div className="space-y-2"><ErrorText>{error}</ErrorText><div className="flex gap-3">
            {account && (
              <Button variant="secondary" size="icon" className="h-14 w-14" onClick={toggleArchive} disabled={busy} aria-label={account.archived ? "Restaurar" : "Archivar"}>
                {account.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
              </Button>
            )}
            <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</Button>
          </div></div>}>
      <div className="space-y-4 pb-2">
        {account ? (
          <p className="text-sm text-muted">Tipo: <span className="font-medium text-text">{ACCOUNT_KIND_LABEL[kind]}</span></p>
        ) : (
        <Field label="Tipo">
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                className={cn("rounded-2xl border px-3 py-2.5 text-left text-sm disabled:opacity-60", kind === k ? "border-olive bg-olive-soft font-semibold" : "border-border bg-surface")}>
                {ACCOUNT_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </Field>
        )}
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
        {isCard && !account && <NewCardStatementImport onData={(d) => {
          if (d.institution && !institution.trim()) setInstitution(d.institution);
          if (d.last4 && !last4) setLast4(d.last4);
          if (d.creditLimit) setLimit(String(d.creditLimit));
          if (d.rateEa) setRate(String(d.rateEa).replace(".", ","));
          if (d.statementDate) {
            setStatementDay(String(Number(d.statementDate.slice(8, 10))));
            if (d.statementDate <= todayBogota()) setCutDate(d.statementDate);
          }
          if (d.dueDate) setDueDay(String(Number(d.dueDate.slice(8, 10))));
          const deferred = d.purchases.reduce((a, p) => a + p.remainingBalance, 0);
          const statement = d.totalPayment ?? (d.totalDebt !== undefined ? Math.max(0, d.totalDebt - deferred) : undefined);
          if (statement !== undefined) setOpening(String(statement));
          if (d.purchases.length) setCardDrafts(d.purchases.map((p) => ({ description: p.description, amount: p.amount, installments: p.installments,
            paid: p.paidInstallments, balance: p.remainingBalance, rate: p.rateEa ?? null, purchaseDate: p.purchaseDate })));
        }} />}
        <Field label={isCard ? (account ? "Deuda total con la que empezó la tarjeta" : "Saldo al corte (pago total del extracto)") : isCredit ? "Capital que falta por pagar" : kind === "LOAN" ? "Cuánto se debe hoy" : "Saldo actual"}
          hint={isCard && !account
            ? "Lo que pagas en la próxima fecha de pago (“Pago total”). Las compras a cuotas que siguen se agregan abajo y se suman a la deuda."
            : isCard ? "Saldo al corte más lo que faltaba de las compras a cuotas del extracto. Los movimientos se suman aparte."
            : account ? "Es el saldo con el que empezó la cuenta en la app; los movimientos se suman aparte." : "El saldo de hoy. Desde aquí la app suma y resta los movimientos."}>
          <AmountInput value={opening} onChange={setOpening} />
        </Field>
        {isCard && !account && (
          <Field label="Fecha de corte de ese extracto" htmlFor="cut-date"
            hint="Las compras desde el día siguiente al corte se registran como movimientos y van en el próximo extracto. Vacío: hoy.">
            <Input id="cut-date" type="date" value={cutDate} max={todayBogota()}
              onChange={(e) => { setCutDate(e.target.value); if (e.target.value && !statementDay) setStatementDay(String(Number(e.target.value.slice(8, 10)))); }} />
          </Field>
        )}
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
          <CreditStatementImport account={account} onData={(d) => {
            const today = todayBogota();
            if (d.institution && !institution.trim()) setInstitution(d.institution);
            if (d.last4 && !last4) setLast4(d.last4);
            if (!account && d.capitalBalance) {
              setOpening(String(Math.round(d.capitalBalance)));
              if (d.statementDate && d.statementDate <= today) setOpeningDate(d.statementDate);
            }
            if (d.rateEa) setRate(String(d.rateEa).replace(".", ","));
            if (d.termMonths) setTerm(String(d.termMonths));
            const cur = currentInstallmentFrom(d, today);
            if (cur) setCurrentInst(String(cur));
            if (d.dueDate) setDueDay(String(Number(d.dueDate.slice(8, 10))));
            if (d.statementDate) setStatementDay(String(Number(d.statementDate.slice(8, 10))));
            if (d.monthlyCosts !== undefined) setCosts(String(Math.round(d.monthlyCosts)));
            if (d.installmentAmount) setFixedCuota(String(Math.round(d.installmentAmount)));
            if (d.originalAmount) setOriginal(String(Math.round(d.originalAmount)));
          }} />
        )}
        {isCredit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor inicial del crédito" hint="Lo que te prestó el banco al empezar."><AmountInput value={original} onChange={setOriginal} /></Field>
            <Field label="Valor de la cuota" hint="Capital + intereses del extracto, sin seguros. Los intereses salen de la tasa y la diferencia va a capital. Vacío: la app la calcula."><AmountInput value={fixedCuota} onChange={setFixedCuota} /></Field>
            <Field label="Número de cuotas" htmlFor="term" hint="Plazo total en meses."><Input id="term" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
            <Field label="¿En qué cuota vas?" htmlFor="cur-inst" hint="La próxima que vas a pagar. Desde aquí suma una cada día de pago.">
              <Input id="cur-inst" inputMode="numeric" value={currentInst} placeholder={term ? `1 a ${term}` : ""} onChange={(e) => setCurrentInst(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            </Field>
            <Field label="Día de pago" htmlFor="dd2"><Input id="dd2" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
            <Field label="Día de corte" htmlFor="sd2" hint="Fecha de facturación del extracto."><Input id="sd2" inputMode="numeric" value={statementDay} onChange={(e) => setStatementDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
            <Field label="Seguros y otros costos al mes" hint="Seguro de vida, de inmueble, cuotas de administración del crédito."><AmountInput value={costs} onChange={setCosts} /></Field>
          </div>
        )}
        {isCredit && formCuota > 0 && (
          <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-sm">
            Cuota estimada: <strong className="num">{formatCop(formCuota)}</strong>
            <span className="block text-xs text-muted">{parseCop(fixedCuota) ? "Cuota del extracto" : "Calculada con el saldo, la tasa y las cuotas que faltan"}{parseCop(costs) ? ", más seguros y otros costos." : "."}</span>
          </p>
        )}
        {isCredit && account && <CreditBudget account={account} />}
        {isCredit && !account && (
          <div className="space-y-2 rounded-2xl border border-border px-3 pb-3">
            <SwitchRow label="Incluir la cuota en Presupuestos"
              hint="Crea un presupuesto del hogar con la cuota. Cuando llegue solo un pago con ese valor, se marca como pago de este crédito."
              checked={inBudget}
              onCheckedChange={(v) => { setInBudget(v); if (v && !budgetCat) setBudgetCat(guessCategory(name, categories)); }} />
            {inBudget && (
              <div className="space-y-2">
                <Field label="Categoría del presupuesto">
                  <Select value={budgetCat} onChange={(e) => setBudgetCat(e.target.value)}>
                    <option value="">Nueva categoría: {name.trim() || "nombre del crédito"}</option>
                    <CategoryOptions categories={categories.filter((c) => !c.archived && c.kind !== "INCOME")} />
                  </Select>
                </Field>
                <Field label="Cuota por periodo" hint={`Vacío: se usa la cuota estimada (${formatCop(formCuota)}, incluye seguros). Cada pago queda con su valor real.`}>
                  <AmountInput value={budgetAmount} onChange={setBudgetAmount} />
                </Field>
              </div>
            )}
          </div>
        )}
        {isCredit && account && <CreditPayments account={account} autoOpen={startCuota} />}
        {isCredit && account && <CreditPaymentAdjust account={account} />}
        {isCard && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label="Cupo"><AmountInput value={limit} onChange={setLimit} /></Field></div>
            <Field label="Día de corte" htmlFor="sd"><Input id="sd" inputMode="numeric" value={statementDay} onChange={(e) => setStatementDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
            <Field label="Día de pago" htmlFor="dd"><Input id="dd" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
          </div>
        )}
        {isCard && account && (
          <CardProjection account={account} />
        )}
        {isCard && !account && (
          <NewCardPurchases items={cardDrafts} onChange={setCardDrafts} />
        )}
        {isCard && !account && newCardDebt > 0 && (
          <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-sm">
            Deuda total de la tarjeta: <strong className="num">{formatCop(newCardDebt)}</strong>
            <span className="block text-xs text-muted">Saldo al corte {formatCop(parseCop(opening) ?? 0)}{deferredTotal > 0 ? ` + ${formatCop(deferredTotal)} de compras a cuotas que siguen` : ""}.</span>
          </p>
        )}
        {isCard && !account && (
          <div className="space-y-2 rounded-2xl border border-border px-3 pb-3">
            <SwitchRow label="Incluir la cuota del mes en Presupuestos"
              hint="Crea un presupuesto del hogar con lo que vence cada mes de la deuda que ya traía la tarjeta (saldo al corte y cuotas de las compras anteriores). Las compras nuevas cuentan en su propia categoría."
              checked={inBudget}
              onCheckedChange={(v) => { setInBudget(v); if (v && !budgetCat) setBudgetCat(guessCategory(name, categories)); }} />
            {inBudget && (
              <Field label="Categoría del presupuesto">
                <Select value={budgetCat} onChange={(e) => setBudgetCat(e.target.value)}>
                  <option value="">Nueva categoría: {name.trim() || "nombre de la tarjeta"}</option>
                  <CategoryOptions categories={categories.filter((c) => !c.archived && c.kind !== "INCOME")} />
                </Select>
              </Field>
            )}
          </div>
        )}
        {isCard && account && <CardBudget account={account} />}
        {(isCard || isCredit) && (
          <Field label="Tasa de interés (% efectiva anual)" htmlFor="rate"
            hint={isCard
              ? "Sale en el extracto de la tarjeta. Sirve para estimar los intereses de las compras a cuotas; las de 1 cuota no pagan intereses."
              : "Sale en el extracto del crédito (la tasa cobrada). Con ella se estiman los intereses de cada cuota."}>
            <Input id="rate" inputMode="decimal" value={rate} placeholder="ej. 28,5" onChange={(e) => setRate(e.target.value.replace(/[^\d,.]/g, "").slice(0, 6))} />
          </Field>
        )}
        {isDebt && partner && (
          <Field label={`¿Quién paga ${isCard ? "esta tarjeta" : "este crédito"}?`}
            hint={responsible && responsible !== me.user_id
              ? `El Saldo Seguro de ${partner.display_name} aparta la cuota y la deuda, no el tuyo. ${partner.display_name} verá los movimientos y el saldo de esta cuenta.`
              : "El Saldo Seguro de quien pague aparta la cuota y la deuda."}>
            <Select value={responsible || me.user_id} onChange={(e) => setResponsible(e.target.value === me.user_id ? "" : e.target.value)} aria-label="Responsable del pago">
              <option value={me.user_id}>Yo ({me.display_name})</option>
              <option value={partner.user_id}>{partner.display_name}</option>
            </Select>
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
    <Sheet open={open} onOpenChange={onOpenChange} title={asset ? "Editar" : "Activo o pasivo"}
      footer={<div className="space-y-2"><ErrorText>{error}</ErrorText><div className="flex gap-3">
          {asset && <Button variant="danger" onClick={remove} disabled={busy}>Borrar</Button>}
          <Button className="flex-1" size="lg" onClick={save} disabled={busy}>Guardar</Button>
        </div></div>}>
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
      </div>
    </Sheet>
  );
}

interface CardDraft { description: string; amount: number; installments: number; paid: number; balance: number; rate: number | null; purchaseDate?: string }

/** Tarjeta nueva: compras a cuotas que se guardan junto con la tarjeta. */
function NewCardPurchases({ items, onChange }: { items: CardDraft[]; onChange: (v: CardDraft[]) => void }) {
  const empty = { description: "", amount: "", installments: "12", paid: "1", balance: "", rate: "" };
  const [draft, setDraft] = useState(empty);
  const [err, setErr] = useState<string | null>(null);

  function add() {
    setErr(null);
    const amount = parseCop(draft.amount) ?? 0;
    const n = Number.parseInt(draft.installments, 10) || 0;
    const paid = Number.parseInt(draft.paid, 10) || 0;
    const balance = parseCop(draft.balance) ?? amount;
    const rate = draft.rate.trim() ? Number(draft.rate.replace(",", ".")) : null;
    if (!draft.description.trim()) return setErr("Escribe la descripción de la compra.");
    if (amount <= 0 || n < 1 || n > 48 || paid < 0 || paid >= n) return setErr("Revisa el valor, las cuotas y la cuota actual.");
    if (balance < 0 || balance > amount) return setErr("El saldo pendiente no puede ser mayor que el valor de la compra.");
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 200)) return setErr("La tasa debe estar entre 0 y 200.");
    onChange([...items, { description: draft.description.trim(), amount, installments: n, paid, balance, rate }]);
    setDraft(empty);
  }

  return (
    <Collapsible title="Compras a cuotas de la tarjeta" summary={items.length ? String(items.length) : undefined}>
      <p className="text-xs text-muted">Opcional. Las compras que ya tienes diferidas en el extracto: su saldo pendiente se suma a la deuda y cada cuota entra en la proyección de pagos del mes que le toca. Se guardan junto con la tarjeta.</p>
      {items.length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((i, idx) => (
            <div key={idx} className="flex items-center gap-2 px-3.5 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{i.description}</span>
                <span className="text-xs text-muted">Cuota {i.paid} de {i.installments} · debe {formatCop(i.balance)}</span>
              </span>
              <button type="button" className="text-xs text-danger underline" onClick={() => onChange(items.filter((_, j) => j !== idx))}>Quitar</button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2 rounded-2xl border border-border p-3">
        <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Descripción (comercio)" aria-label="Descripción" />
        <div className="grid grid-cols-2 gap-2">
          <AmountInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} />
          <Input inputMode="numeric" value={draft.installments} onChange={(e) => setDraft({ ...draft, installments: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="Cuotas" aria-label="Cuotas" />
          <Input inputMode="numeric" value={draft.paid} onChange={(e) => setDraft({ ...draft, paid: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="Cuotas pagadas" aria-label="Cuotas pagadas" />
          <AmountInput value={draft.balance} onChange={(v) => setDraft({ ...draft, balance: v })} />
        </div>
        <p className="text-xs text-muted">Valor de la compra, cuotas, cuotas ya cobradas y saldo que falta (“Saldo diferido” del extracto).</p>
        <Input inputMode="decimal" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value.replace(/[^\d,.]/g, "").slice(0, 6) })} placeholder="Tasa E.A. (vacío = la de la tarjeta)" aria-label="Tasa" />
        <ErrorText>{err}</ErrorText>
        <Button type="button" size="sm" onClick={add}>Agregar compra</Button>
      </div>
    </Collapsible>
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
  const card = { id: cardId, interest_rate_ea: account.interest_rate_ea ?? null, statement_day: account.statement_day, due_day: account.due_day, opening_at: account.opening_at, opening_balance: account.opening_balance };
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
      <Collapsible title={byPayment ? "Proyección de pagos" : "Cuotas de los próximos meses"}
        summary={rows.length ? `${formatCop(rows[0].total)} el próximo` : "sin cuotas"}>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-sm text-muted">No hay cuotas pendientes en esta tarjeta.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {rows.map((r) => (
            <div key={r.month} className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm">
              <span className="min-w-0">{(() => { const m = `${monthName(Number(r.month.slice(5)) - 1, true)} ${r.month.slice(0, 4)}`; return byPayment ? `Pago de ${m.toLowerCase()}` : m.charAt(0).toUpperCase() + m.slice(1); })()} <span className="text-xs text-muted">· {r.purchases} compra{r.purchases === 1 ? "" : "s"}</span></span>
              <span className="num shrink-0 whitespace-nowrap font-semibold">{formatCop(r.total)}</span>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <p className="text-xs text-muted">Total de estos meses: {formatCop(total)} (capital más intereses estimados). Es una estimación; el plan de pagos del banco manda.{byPayment ? " Incluye lo que compres después del corte, en el extracto que lo factura." : ""}</p>
      )}
      </Collapsible>

      <Collapsible title="Compras del extracto que no registraste" summary={mine.length ? String(mine.length) : undefined}>
        <p className="text-xs text-muted">Suman a la proyección y, si la tarjeta está en Presupuestos, a su cuota del mes (toca Recalcular). No aparecen en Movimientos ni informes. Su saldo debe estar incluido en la deuda de la tarjeta (en Cierre del mes se ajusta con el extracto).</p>
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
      </Collapsible>
    </div>
  );
}

/** Registrar una cuota del crédito: el capital baja la deuda (transferencia) y los intereses y costos son gastos. */
function CreditPayments({ account, autoOpen = false }: { account: Account; autoOpen?: boolean }) {
  const { accounts, balances, categories, me, supabase, reload, transactions } = useFinance();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owed = Math.max(0, -(balances[account.id] ?? 0));
  const today = todayBogota();
  const next = nextCuota(owed, account, today);
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
  const progress = installmentLabel(account, today);
  const paidRatio = capitalPaidRatio(account.original_amount, owed);

  function openForm() {
    setOpen(true);
    setErr(null);
    setDate(today);
    setTotal(String(next || ""));
    const s = suggestSplit(owed, account.interest_rate_ea, next, account.monthly_costs ?? 0);
    setInterest(String(s.interest || ""));
    setCostsPaid(String(account.monthly_costs ?? ""));
    setPayFrom(payAccounts[0]?.id ?? "");
    setCategoryId(account.budget_category_id ?? "");
  }

  // Desde Vencimientos → Pagar: el formulario de la cuota ya abierto
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoOpen || owed <= 0) return;
    openForm();
    const t = setTimeout(() => box.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

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
        // Con presupuesto del crédito, los intereses van al hogar para que cuenten en él
        kind: "EXPENSE", scope: account.budget_category_id && categoryId === account.budget_category_id ? "HOUSEHOLD" : "PERSONAL",
        amount: interestN + costsN, occurred_on: date,
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
    <div ref={box} className="scroll-mt-2 space-y-2 rounded-2xl border border-border p-3">
      <p className="text-sm font-medium">Cuotas del crédito</p>
      <p className="text-xs text-muted">
        Debe {formatCop(owed)} · cuota estimada {formatCop(next)}{progress ? ` · ${progress}` : ""}
      </p>
      {paidRatio !== null && account.original_amount ? (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(paidRatio * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-olive" style={{ width: `${paidRatio * 100}%` }} />
          </div>
          <p className="text-xs text-muted">Has pagado {formatCop(Math.max(0, account.original_amount - owed))} de {formatCop(account.original_amount)} ({Math.round(paidRatio * 100)} % del capital)</p>
        </div>
      ) : null}
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

/** Categoría existente que parece la del crédito ("Hipotecario" para "Crédito hipotecario"), o "" para crear una. */
function guessCategory(name: string, categories: { id: string; name: string; archived: boolean; kind?: string }[]): string {
  const n = normalizeMerchant(name) ?? "";
  const hit = categories.find((c) => {
    if (c.archived || (c.kind ?? "EXPENSE") !== "EXPENSE") return false;
    const cn = normalizeMerchant(c.name) ?? "";
    return cn.length >= 4 && (n === cn || n.split(" ").includes(cn) || cn.split(" ").includes(n));
  });
  return hit?.id ?? "";
}

/** Crea (o actualiza) el presupuesto del hogar con la cuota del crédito y lo enlaza a la cuenta. */
async function linkCreditBudget(state: ReturnType<typeof useFinance>, account: Account, categoryId: string, amount: number) {
  const { me, partner, settings, limits, supabase } = state;
  const currentStart = periodFor(settings, todayBogota()).start;
  const catId = categoryId || await ensureCategory(state, supabase, account.name, "🏦");
  const existing = limits.find((l) => l.category_id === catId && l.scope === "HOUSEHOLD") ?? null;
  const slot = [me, partner].find((m) => m?.user_id === responsibleOf(account))?.slot ?? me.slot;
  const r = await supabase.rpc("save_category_limit", { p: {
    id: existing?.id ?? null, category_id: catId, scope: "HOUSEHOLD",
    responsibility: slot === "B" ? "MEMBER_B_100" : "MEMBER_A_100",
    // Al cambiar la cuota se respeta si la persona la marcó como obligación del hogar
    is_household_obligation: existing?.is_household_obligation ?? false, rollover_enabled: existing?.rollover_enabled ?? false, shared_with_partner: false,
    budget: { valid_from: currentStart, amount, fixed_amount_a: null, fixed_amount_b: null },
  } });
  if (r.error) throw r.error;
  const u = await supabase.from("accounts").update({ budget_category_id: catId }).eq("id", account.id);
  if (u.error) throw u.error;
}

/**
 * Interruptor "Incluir la cuota en Presupuestos": el crédito queda con un presupuesto del hogar por su cuota
 * (no es obligación: la cuota ya se aparta en el Saldo Seguro) y los pagos que lleguen solos se cruzan con él.
 */
function CreditBudget({ account }: { account: Account }) {
  const state = useFinance();
  const { settings, balances, categories, limits, budgets, supabase, reload } = state;
  const linked = account.budget_category_id ? categories.find((c) => c.id === account.budget_category_id) ?? null : null;
  const currentStart = periodFor(settings, todayBogota()).start;
  const estimate = nextCuota(Math.max(0, -(balances[account.id] ?? 0)), account, todayBogota());
  const limit = linked ? limits.find((l) => l.category_id === linked.id && l.scope === "HOUSEHOLD") ?? null : null;
  const limitAmount = limit ? budgetVersionAt(toBudgetCategories([limit], budgets)[0].budgets, currentStart)?.amount ?? null : null;
  const [editing, setEditing] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const options = categories.filter((c) => !c.archived && c.kind !== "INCOME");

  function startEdit() {
    setErr(null);
    setCategoryId(account.budget_category_id ?? guessCategory(account.name, categories));
    setAmount(String(limitAmount ?? estimate ?? ""));
    setEditing(true);
  }

  async function save() {
    setErr(null);
    const value = parseCop(amount) ?? 0;
    if (value <= 0) return setErr("Escribe el valor de la cuota.");
    setBusy(true);
    try {
      await linkCreditBudget(state, account, categoryId, value);
      setEditing(false);
      void reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    const { error } = await supabase.from("accounts").update({ budget_category_id: null }).eq("id", account.id);
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setEditing(false);
    void reload();
  }

  return (
    <div className="space-y-2 rounded-2xl border border-border px-3 pb-3">
      <SwitchRow label="Incluir la cuota en Presupuestos"
        hint="Crea un presupuesto del hogar con la cuota. Cuando llegue solo un pago con ese valor, se marca como pago de este crédito."
        checked={!!linked || editing} disabled={busy}
        onCheckedChange={(v) => (v ? startEdit() : linked ? void unlink() : setEditing(false))} />
      {linked && !editing && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">
            Presupuesto <strong className="text-text">{categoryPath(categories, linked.id)}</strong>
            {limitAmount != null ? <> · <span className="num">{formatCop(limitAmount)}</span> por periodo</> : null}
          </span>
          <Button size="sm" variant="ghost" onClick={startEdit}>Cambiar</Button>
        </div>
      )}
      {editing && (
        <div className="space-y-2">
          <Field label="Categoría del presupuesto">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Nueva categoría: {account.name}</option>
              <CategoryOptions categories={options} />
            </Select>
          </Field>
          <Field label="Cuota por periodo" hint={`Estimada por la app: ${formatCop(estimate)} (incluye seguros). Puedes cambiarla; cada pago queda con su valor real.`}>
            <AmountInput value={amount} onChange={setAmount} />
          </Field>
          <ErrorText>{err}</ErrorText>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>Guardar</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </div>
      )}
      {!editing && <ErrorText>{err}</ErrorText>}
    </div>
  );
}

/** Importar el extracto del crédito (PDF o foto): la IA lo lee y llena el formulario; la persona revisa y guarda. */
function CreditStatementImport({ account, onData }: { account: Account | null; onData: (d: CreditStatementData) => void }) {
  const { balances, transactions, supabase, reload } = useFinance();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [read, setRead] = useState<CreditStatementData | null>(null);
  const [adjusted, setAdjusted] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    setRead(null);
    setAdjusted(false);
    if (!navigator.onLine) return setErr("Sin conexión: para leer el extracto necesitas internet.");
    setBusy(true);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const payload = isPdf ? { data: await toBase64(file), mime: "application/pdf" } : await shrink(file, 2400);
      if (payload.data.length > 4_200_000) throw new Error("El archivo es muy pesado (máximo ~3 MB). Prueba con una foto o el PDF del banco.");
      const res = await fetch("/api/credit-statement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: CreditStatementData; error?: string };
      if (!body.ok || !body.result) throw new Error(body.error ?? "No se pudo leer el extracto.");
      if (Object.keys(body.result).length === 0) throw new Error("No encontré datos del crédito en ese archivo.");
      setRead(body.result);
      onData(body.result);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Deuda de la app a la fecha del extracto (sin los movimientos posteriores)
  const date = read?.statementDate;
  const appOwed = account && date
    ? -((balances[account.id] ?? 0) - transactions.filter((t) => t.occurred_on > date && t.status !== "PENDING_REVIEW").reduce((sum, t) => sum + effectOn(account.id, t), 0))
    : null;
  const diff = read?.capitalBalance !== undefined && appOwed !== null ? Math.round(read.capitalBalance) - Math.round(appOwed) : 0;

  async function adjust() {
    if (!account || !date || diff === 0) return;
    setBusy(true);
    setErr(null);
    const r = await supabase.rpc("save_transaction", { p: {
      kind: "ADJUSTMENT", amount: Math.abs(diff), occurred_on: date, account_id: account.id,
      direction: diff > 0 ? "OUT" : "IN", description: `Ajuste del saldo con el extracto (${account.name})`, tags: ["#conciliacion"],
    } });
    setBusy(false);
    if (r.error) return setErr(errMsg(r.error));
    setAdjusted(true);
    void reload();
  }

  const rows: [string, string][] = read ? [
    ["Saldo a capital", read.capitalBalance !== undefined ? formatCop(Math.round(read.capitalBalance)) : ""],
    ["Fecha del extracto", read.statementDate ?? ""],
    ["Pague hasta", read.dueDate ?? ""],
    ["Tasa", read.rateEa ? `${String(read.rateEa).replace(".", ",")} % EA` : ""],
    ["Cuotas", read.termMonths ? `${read.termMonths}${read.installmentsPending !== undefined ? ` (pendientes ${read.installmentsPending})` : ""}` : ""],
    ["Cuota (capital + intereses)", read.installmentAmount ? formatCop(Math.round(read.installmentAmount)) : ""],
    ["Seguros y costos", read.monthlyCosts !== undefined ? formatCop(Math.round(read.monthlyCosts)) : ""],
    ["Total a pagar", read.amountDue ? formatCop(Math.round(read.amountDue)) : ""],
    ["Valor inicial", read.originalAmount ? formatCop(Math.round(read.originalAmount)) : ""],
  ].filter((r): r is [string, string] => !!r[1]) : [];

  return (
    <div className="space-y-2 rounded-2xl border border-dashed border-border p-3">
      <label className={cn("flex cursor-pointer items-center gap-2 text-sm font-medium text-olive", busy && "pointer-events-none opacity-60")}>
        <FileUp size={18} />
        {busy ? "Leyendo el extracto…" : "Importar extracto (PDF o foto) y llenar los datos"}
        <input type="file" accept="application/pdf,image/*" className="hidden" disabled={busy}
          onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {!read && !err && <p className="text-xs text-muted">La IA lee el extracto del banco y llena tasa, cuotas, cuota, seguros y fechas. Revisa antes de guardar. El archivo no se guarda.</p>}
      {read && (
        <div className="space-y-2">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{k}</dt><dd className="num text-right">{v}</dd></Fragment>))}
          </dl>
          <p className="text-xs text-olive">Listo: revisa los campos de abajo y toca Guardar.</p>
          {account && appOwed !== null && read.capitalBalance !== undefined && (
            diff === 0 || adjusted ? (
              <p className="text-xs text-muted">{adjusted ? "Saldo ajustado al del extracto." : "El saldo de la app coincide con el extracto."}</p>
            ) : (
              <div className="space-y-1.5 rounded-xl bg-warning-soft px-3 py-2 text-xs">
                <p>Al {date} la app dice que debes {formatCop(Math.round(appOwed))} y el extracto {formatCop(Math.round(read.capitalBalance))} ({diff > 0 ? "+" : "−"}{formatCop(Math.abs(diff))}).</p>
                <Button size="sm" variant="outline" onClick={adjust} disabled={busy}>Ajustar el saldo al del extracto</Button>
                <p className="text-muted">Es un ajuste de saldo: no cuenta como gasto ni ingreso.</p>
              </div>
            )
          )}
        </div>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}

/**
 * Crea (o actualiza) el presupuesto del hogar de la tarjeta con lo que vence cada periodo de su deuda anterior
 * (saldo al corte y cuotas de las compras del extracto) y lo enlaza a la cuenta. Al acabarse esa deuda queda en 0.
 */
async function linkCardBudget(state: ReturnType<typeof useFinance>, account: Account, items: CardStatementItem[], categoryId: string) {
  const { me, partner, settings, limits, budgets, supabase } = state;
  const today = todayBogota();
  const versions = cardBudgetVersions(account, items, settings, today);
  if (versions.length === 0) throw new Error("la tarjeta no tiene deuda anterior por pagar (revisa el saldo, la fecha de corte y el día de pago)");
  const catId = categoryId || await ensureCategory(state, supabase, account.name, "💳");
  const existing = limits.find((l) => l.category_id === catId && l.scope === "HOUSEHOLD") ?? null;
  // Versiones futuras que ya existían y no están en el plan nuevo: toman el monto que corresponde en esa fecha
  const amountAt = (d: string) => [...versions].reverse().find((v) => v.valid_from <= d)?.amount ?? versions[0].amount;
  const stale = existing
    ? budgets.filter((b) => b.limit_id === existing.id && b.valid_from >= versions[0].valid_from && !versions.some((v) => v.valid_from === b.valid_from))
      .map((b) => ({ valid_from: b.valid_from, amount: amountAt(b.valid_from) }))
    : [];
  const slot = [me, partner].find((m) => m?.user_id === responsibleOf(account))?.slot ?? me.slot;
  let id: string | null = existing?.id ?? null;
  for (const v of [...versions, ...stale]) {
    const r = await supabase.rpc("save_category_limit", { p: {
      id, category_id: catId, scope: "HOUSEHOLD",
      responsibility: slot === "B" ? "MEMBER_B_100" : "MEMBER_A_100",
      is_household_obligation: existing?.is_household_obligation ?? false, rollover_enabled: existing?.rollover_enabled ?? false, shared_with_partner: false,
      budget: { valid_from: v.valid_from, amount: v.amount, fixed_amount_a: null, fixed_amount_b: null },
    } });
    if (r.error) throw r.error;
    id = (r.data as string) ?? id;
  }
  const u = await supabase.from("accounts").update({ budget_category_id: catId }).eq("id", account.id);
  if (u.error) throw u.error;
}

/**
 * Interruptor "Incluir la cuota del mes en Presupuestos" de una tarjeta: presupuesto del hogar con lo que vence de la
 * deuda que ya traía (las compras nuevas cuentan en su categoría). El pago a la tarjeta lo cruza solo.
 */
function CardBudget({ account }: { account: Account }) {
  const state = useFinance();
  const { settings, categories, limits, budgets, cardItems, supabase, reload } = state;
  const linked = account.budget_category_id ? categories.find((c) => c.id === account.budget_category_id) ?? null : null;
  const today = todayBogota();
  const items = cardItems.filter((i) => i.account_id === account.id);
  const plan = cardBudgetVersions(account, items, settings, today);
  const limit = linked ? limits.find((l) => l.category_id === linked.id && l.scope === "HOUSEHOLD") ?? null : null;
  const current = limit ? budgetVersionAt(toBudgetCategories([limit], budgets)[0].budgets, periodFor(settings, today).start)?.amount ?? null : null;
  const [editing, setEditing] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canPlan = !!(account.statement_day && account.due_day);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await linkCardBudget(state, account, items, categoryId);
      setEditing(false);
      void reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    const { error } = await supabase.from("accounts").update({ budget_category_id: null }).eq("id", account.id);
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setEditing(false);
    void reload();
  }

  return (
    <div className="space-y-2 rounded-2xl border border-border px-3 pb-3">
      <SwitchRow label="Incluir la cuota del mes en Presupuestos"
        hint="Presupuesto del hogar con lo que vence cada mes de la deuda que ya traía la tarjeta (saldo al corte y cuotas de las compras del extracto). Las compras nuevas ya cuentan en su categoría; el pago a la tarjeta se cruza solo."
        checked={!!linked || editing} disabled={busy}
        onCheckedChange={(v) => {
          setErr(null);
          if (v) { setCategoryId(account.budget_category_id ?? guessCategory(account.name, categories)); setEditing(true); }
          else if (linked) void unlink();
          else setEditing(false);
        }} />
      {linked && !editing && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">
            Presupuesto <strong className="text-text">{categoryPath(categories, linked.id)}</strong>
            {current != null ? <> · <span className="num">{formatCop(current)}</span> este periodo</> : null}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save()}>Recalcular</Button>
        </div>
      )}
      {editing && (
        <div className="space-y-2">
          {!canPlan && <p className="text-xs text-warning">Escribe el día de corte y el día de pago de la tarjeta y guarda primero.</p>}
          {canPlan && plan.length === 0 && <p className="text-xs text-muted">La tarjeta no tiene deuda anterior por pagar.</p>}
          {plan.length > 0 && (
            <p className="text-xs text-muted">
              {plan.filter((v) => v.amount > 0).slice(0, 3).map((v) => `${formatCop(v.amount)} desde ${v.valid_from}`).join(" · ")}
              {plan.filter((v) => v.amount > 0).length > 3 ? " · …" : ""}
            </p>
          )}
          <Field label="Categoría del presupuesto">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Nueva categoría: {account.name}</option>
              <CategoryOptions categories={categories.filter((c) => !c.archived && c.kind !== "INCOME")} />
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy || plan.length === 0}>Guardar</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </div>
      )}
      <ErrorText>{err}</ErrorText>
    </div>
  );
}

/** Tarjeta nueva: la IA lee el extracto (PDF o foto) y llena saldo al corte, fechas, cupo, tasa y compras a cuotas. */
function NewCardStatementImport({ onData }: { onData: (d: CardStatementData) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    setDone(null);
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
      if (r.totalDebt === undefined && r.totalPayment === undefined && r.purchases.length === 0) throw new Error("No encontré el saldo ni las compras a cuotas en ese archivo.");
      onData(r);
      setDone(`Listo: llené el saldo al corte${r.statementDate ? ` (${r.statementDate})` : ""}${r.purchases.length ? ` y ${r.purchases.length} compra${r.purchases.length === 1 ? "" : "s"} a cuotas` : ""}. Revisa y toca Guardar.`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-dashed border-border p-3">
      <label className={cn("flex cursor-pointer items-center gap-2 text-sm font-medium text-olive", busy && "pointer-events-none opacity-60")}>
        <FileUp size={18} />
        {busy ? "Leyendo el extracto…" : "Importar extracto (PDF o foto) y llenar los datos"}
        <input type="file" accept="application/pdf,image/*" className="hidden" disabled={busy}
          onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {!done && !err && <p className="text-xs text-muted">La IA lee el saldo al corte, las fechas, el cupo, la tasa y las compras a cuotas. El archivo no se guarda.</p>}
      {done && <p className="text-xs text-olive">{done}</p>}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}
