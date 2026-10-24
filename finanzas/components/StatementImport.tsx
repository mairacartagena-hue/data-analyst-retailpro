"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, HelpCircle, Landmark, PlusCircle, Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ErrorText, Select } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import type { Account } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/types";
import { formatCop } from "@/lib/finance/money";
import { formatDay } from "@/lib/finance/periods";
import { monthRange } from "@/lib/finance/reconcile";
import { ensureCategory } from "@/lib/finance/ensureCategory";
import {
  BANK_CATEGORY, INTEREST_CATEGORY, UNKNOWN_CATEGORY, bankCharges, closingBalance, isBankLine, parseStatement, reconcileStatement, registerPayload,
  type AppEntry, type ColumnMap, type LineKind, type StatementLine,
} from "@/lib/finance/statement";
import { cn, errMsg } from "@/lib/utils";

const KIND_LABEL: Record<LineKind, string> = {
  GMF: "4x1000", INTEREST_IN: "Interés a favor", INTEREST_OUT: "Interés cobrado", FEE: "Gasto bancario", OTHER: "",
};

const signed = (n: number) => `${n < 0 ? "−" : "+"}${formatCop(Math.abs(n))}`;

/** Importa el extracto del banco (CSV) y lo cruza con la app: faltantes, duplicados, 4x1000, intereses y gastos bancarios. */
export function StatementImport({ account, month, onBalance }: { account: Account; month: string; onBalance: (v: number) => void }) {
  const state = useFinance();
  const { transactions, supabase, reload, uvt, me } = state;
  const { openPayment } = useShell();
  const range = monthRange(month);
  const isCard = account.kind === "CREDIT_CARD";

  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [flip, setFlip] = useState(false);
  const [purchasesPositive, setPurchasesPositive] = useState(true);
  const [map, setMap] = useState<Partial<ColumnMap>>({});
  const [showColumns, setShowColumns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const parsed = useMemo(() => (text === null ? null : parseStatement(text, { map, flip, purchasesPositive, isCard })), [text, map, flip, purchasesPositive, isCard]);
  const inMonth = useMemo(() => (parsed?.lines ?? []).filter((l) => l.date >= range.start && l.date <= range.end), [parsed, range.start, range.end]);
  const rec = useMemo(() => (parsed ? reconcileStatement(account, transactions, parsed.lines, range) : null), [parsed, account, transactions, range.start, range.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const charges = useMemo(() => bankCharges(account, inMonth, uvt), [account, inMonth, uvt]);
  const closing = useMemo(() => (parsed ? closingBalance(inMonth) : null), [parsed, inMonth]);
  const inflow = inMonth.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0);
  const outflow = inMonth.filter((l) => l.amount < 0).reduce((a, l) => a - l.amount, 0);

  const duplicateIds = new Set((rec?.duplicates ?? []).map((d) => d.entry.tx.id));
  const onlyInApp = (rec?.extra ?? []).filter((e) => !duplicateIds.has(e.tx.id));
  const bankMissing = (rec?.missing ?? []).filter(isBankLine);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    if (file.size > 5_000_000) return setError("El archivo es muy grande (más de 5 MB). ¿Es el extracto en CSV?");
    try {
      setText(await file.text());
      setFileName(file.name);
      setMap({});
      setFlip(false);
    } catch {
      setError("No se pudo leer el archivo.");
    }
  }

  async function registerBankLines() {
    if (bankMissing.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let done = 0;
    try {
      const ctx = {
        accountId: account.id, userId: me.user_id,
        bankCategoryId: await ensureCategory(state, supabase, BANK_CATEGORY.name, BANK_CATEGORY.icon),
        unknownCategoryId: await ensureCategory(state, supabase, UNKNOWN_CATEGORY.name, UNKNOWN_CATEGORY.icon),
        interestCategoryId: await ensureCategory(state, supabase, INTEREST_CATEGORY.name, INTEREST_CATEGORY.icon, "INCOME"),
      };
      for (const line of bankMissing) {
        const { error } = await supabase.rpc("save_transaction", { p: registerPayload(line, ctx) });
        if (error) throw error;
        done++;
      }
      setNotice(`Registré ${done} movimiento${done === 1 ? "" : "s"} del banco.`);
    } catch (e) {
      setError(`${done > 0 ? `Alcancé a registrar ${done}. ` : ""}${errMsg(e)}`);
    } finally {
      setBusy(false);
      void reload();
    }
  }

  function registerManually(line: StatementLine) {
    openPayment({ kind: line.amount > 0 ? "INCOME" : "EXPENSE", amount: Math.abs(line.amount), description: line.description.slice(0, 60), date: line.date });
  }

  async function removeDuplicate(entry: AppEntry) {
    if (!confirm("¿Borrar este movimiento de la app? El otro, que sí aparece en el extracto, se queda.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_transaction", { p_id: entry.tx.id });
    setBusy(false);
    if (error) setError(errMsg(error));
    else void reload();
  }

  const columnSelect = (role: keyof ColumnMap, label: string) => (
    <label className="block text-xs text-muted">
      {label}
      <Select value={parsed?.map[role] ?? ""} className="mt-1 h-10 text-sm" aria-label={label}
        onChange={(e) => setMap({ ...map, [role]: e.target.value === "" ? null : Number(e.target.value) })}>
        <option value="">— no trae —</option>
        {(parsed?.headers ?? []).map((h, i) => <option key={i} value={i}>{h}</option>)}
      </Select>
    </label>
  );

  const appRow = (e: AppEntry, extra?: React.ReactNode) => (
    <div key={e.tx.id} className="flex items-center gap-2 py-2 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{e.tx.description || e.tx.merchant || "Movimiento"}</span>
        <span className="block truncate text-xs text-muted">{formatDay(e.date)} · {CHANNEL_LABEL[e.tx.source] ?? e.tx.source}{e.tx.status === "PENDING_REVIEW" ? " · por revisar" : ""}</span>
      </span>
      <span className="num shrink-0 font-semibold">{signed(e.amount)}</span>
      {extra}
    </div>
  );

  return (
    <>
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <FileUp size={16} /> Importar extracto (CSV) y conciliar
      </Button>

      <Sheet open={open} onOpenChange={setOpen} title="Importar extracto" description={`${account.name}${account.last4 ? ` ··${account.last4}` : ""} · ${month}`}>
        <div className="space-y-4 pb-2">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface px-4 py-5 text-sm font-medium hover:bg-surface-2">
              <FileUp size={18} /> {fileName || "Elegir el archivo CSV del banco"}
              <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <p className="text-xs text-muted">El archivo se lee en tu celular; no se sube a ningún lado. Descárgalo desde la página o app de tu banco (extracto o movimientos en CSV).</p>
          </div>

          <ErrorText>{error}</ErrorText>
          {notice && <p className="rounded-xl bg-olive-soft px-3 py-2 text-sm">{notice}</p>}

          {parsed && parsed.warnings.length > 0 && parsed.lines.length === 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{parsed.warnings.join(" ")}</p>
          )}

          {parsed && (
            <>
              <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
                <p className="font-semibold">{inMonth.length} movimiento{inMonth.length === 1 ? "" : "s"} del mes en el extracto</p>
                <p className="num text-muted">Entró {formatCop(inflow)} · Salió {formatCop(outflow)}</p>
                {rec && rec.outOfRange > 0 && <p className="text-xs text-muted">{rec.outOfRange} línea{rec.outOfRange === 1 ? "" : "s"} de otros meses no se comparan.</p>}
                {parsed.skipped > 0 && <p className="text-xs text-muted">{parsed.skipped} fila{parsed.skipped === 1 ? "" : "s"} sin fecha o valor (títulos, totales) se ignoraron.</p>}
                {closing !== null && (
                  <button className="mt-2 text-xs font-medium text-olive underline" onClick={() => { onBalance(Math.abs(closing)); setNotice(`Usé ${formatCop(Math.abs(closing))} como ${isCard ? "deuda" : "saldo"} del banco.`); }}>
                    Usar el saldo final del extracto ({formatCop(closing)}) como {isCard ? "deuda" : "saldo"} del banco
                  </button>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-surface px-3">
                {isCard ? (
                  <SwitchRow label="Las compras aparecen como valores positivos" hint="Lo más común en tarjetas. Si Entró y Salió se ven al revés, apágalo."
                    checked={purchasesPositive} onCheckedChange={setPurchasesPositive} />
                ) : (
                  <SwitchRow label="Los signos están al revés" hint="Actívalo si las salidas aparecen como entradas (Entró y Salió invertidos)."
                    checked={flip} onCheckedChange={setFlip} />
                )}
              </div>

              <button className="text-xs text-muted underline" onClick={() => setShowColumns(!showColumns)}>
                {showColumns ? "Ocultar columnas" : "¿Las columnas no son correctas? Elegirlas a mano"}
              </button>
              {showColumns && (
                <div className="grid grid-cols-2 gap-2">
                  {columnSelect("date", "Fecha")}
                  {columnSelect("description", "Descripción")}
                  {columnSelect("amount", "Valor (con signo)")}
                  {columnSelect("balance", "Saldo")}
                  {columnSelect("debit", "Débitos (salidas)")}
                  {columnSelect("credit", "Créditos (entradas)")}
                </div>
              )}
            </>
          )}

          {rec && inMonth.length > 0 && (
            <>
              <p className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium", rec.matched.length === inMonth.length ? "bg-olive-soft" : "bg-surface-2")}>
                <CheckCircle2 size={16} /> {rec.matched.length} de {inMonth.length} ya están en la app
              </p>

              {rec.missing.length > 0 && (
                <section className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><PlusCircle size={15} /> Faltan en la app ({rec.missing.length})</h3>
                  <p className="text-xs text-muted">Están en el extracto y no los encontré en la app (mismo valor, hasta 3 días de diferencia).</p>
                  {bankMissing.length > 0 && (
                    <Button size="sm" className="w-full" onClick={registerBankLines} disabled={busy}>
                      {busy ? "Registrando…" : `Registrar los ${bankMissing.length} del banco (4x1000, intereses, cuotas)`}
                    </Button>
                  )}
                  <div className="divide-y divide-border">
                    {rec.missing.map((l) => (
                      <div key={l.id} className="flex items-center gap-2 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{l.description || "Sin descripción"}</span>
                          <span className="block text-xs text-muted">{formatDay(l.date)}{KIND_LABEL[l.kind] ? ` · ${KIND_LABEL[l.kind]}` : ""}</span>
                        </span>
                        <span className={cn("num shrink-0 font-semibold", l.amount > 0 && "text-olive")}>{signed(l.amount)}</span>
                        {l.kind === "OTHER" && <Button size="sm" variant="outline" onClick={() => registerManually(l)}>Registrar</Button>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {rec.duplicates.length > 0 && (
                <section className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-warning"><AlertTriangle size={15} /> Posibles duplicados en la app ({rec.duplicates.length})</h3>
                  <p className="text-xs text-muted">Hay más movimientos en la app que líneas en el extracto con ese valor y fecha. Revisa cuál sobra.</p>
                  <div className="divide-y divide-border">
                    {rec.duplicates.map((d) => appRow(d.entry, (
                      <Button size="icon" variant="outline" onClick={() => removeDuplicate(d.entry)} disabled={busy} aria-label="Borrar duplicado"><Trash2 size={16} /></Button>
                    )))}
                  </div>
                </section>
              )}

              {onlyInApp.length > 0 && (
                <section className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><HelpCircle size={15} /> En la app, no en el extracto ({onlyInApp.length})</h3>
                  <p className="text-xs text-muted">Puede que el banco los registre otro día o que no se hayan hecho. Revísalos.</p>
                  <div className="divide-y divide-border">{onlyInApp.map((e) => appRow(e))}</div>
                </section>
              )}

              <section className="space-y-2 rounded-2xl border border-border bg-surface p-3 text-sm">
                <h3 className="flex items-center gap-1.5 font-semibold"><Landmark size={15} /> Cobros del banco en el extracto</h3>
                {charges.gmf.applies ? (
                  <p className={cn("rounded-xl px-3 py-2", charges.gmf.ok ? "bg-olive-soft" : "bg-warning-soft")}>
                    <strong>4x1000:</strong> el banco cobró {formatCop(charges.gmf.charged)}; según tus salidas debería rondar {formatCop(charges.gmf.expected)}.{" "}
                    {charges.gmf.ok
                      ? "Coincide."
                      : charges.gmf.diff > 0
                        ? `Cobró ${formatCop(charges.gmf.diff)} de más: ${account.gmf_mode && account.gmf_mode !== "TAXED" ? "tu cuenta está marcada como exenta, revisa con el banco." : "revisa si hay otra cuenta exenta."}`
                        : `Faltan ${formatCop(-charges.gmf.diff)}: puede haber líneas del 4x1000 que no vinieron en el archivo.`}
                  </p>
                ) : (
                  <p className="text-muted">Las tarjetas de crédito no pagan 4x1000.</p>
                )}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <dt className="text-muted">Intereses a favor</dt><dd className="num text-right text-olive">+{formatCop(charges.interestIn.total)}</dd>
                  <dt className="text-muted">Intereses cobrados</dt><dd className="num text-right">−{formatCop(charges.interestOut.total)}</dd>
                  <dt className="text-muted">Cuotas, comisiones, seguros e IVA</dt><dd className="num text-right">−{formatCop(charges.fees.total)}</dd>
                </dl>
              </section>

              {rec.missing.length === 0 && rec.duplicates.length === 0 && (
                <p className="text-xs text-muted">Todo el extracto está en la app. Ahora cierra la cuenta con el saldo del banco.</p>
              )}
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
