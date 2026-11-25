"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, HelpCircle, History, Landmark, Link2, PlusCircle, Scale, Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { LinkSelect } from "@/components/LinkSelect";
import { ErrorText, Select } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import type { Account, ReconcilingItem } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/types";
import { formatCop } from "@/lib/finance/money";
import { formatDay, todayBogota } from "@/lib/finance/periods";
import { cycleRange, monthRange } from "@/lib/finance/reconcile";
import { ensureCategory } from "@/lib/finance/ensureCategory";
import { editPayload } from "@/lib/finance/txEdit";
import { readStatementFile } from "@/lib/finance/statementFile";
import { shrink, toBase64 } from "@/lib/capture/file";
import type { CardLinesData } from "@/lib/capture/cardStatement";
import { parsedFromCardLines } from "@/lib/finance/cardLines";
import {
  BANK_CATEGORY, INTEREST_CATEGORY, UNKNOWN_CATEGORY, VALUE_WINDOW_DAYS, appCandidatesFor, appEntryOf, bankCharges, carryOverStatus, closingBalance, coveredRange, DIFFERENCE_TAG, differencePayload, isBankLine, lineCandidatesFor, pairKey, parseStatementRows, reconcileStatement, registerPayload, valuePairs, withManualLinks,
  type AppEntry, type CarryStatus, type ColumnMap, type LineKind, type ManualLink, type StatementLine, type ValuePair,
} from "@/lib/finance/statement";
import { cn, errMsg } from "@/lib/utils";

const KIND_LABEL: Record<LineKind, string> = {
  GMF: "4x1000", INTEREST_IN: "Interés a favor", INTEREST_OUT: "Interés cobrado", FEE: "Gasto bancario", OTHER: "",
};

const CARRY_LABEL: Record<CarryStatus, string> = {
  FOUND: "ya aparece en este extracto",
  NOT_FOUND: "no aparece en el extracto, ni con el mismo valor en otra fecha: revisa si el banco la cobra en el siguiente o vincúlala si vino con otro valor",
  GONE: "el movimiento ya no está en la app",
  UNKNOWN: "no se puede comprobar con este extracto",
};

const signed = (n: number) => `${n < 0 ? "−" : "+"}${formatCop(Math.abs(n))}`;

/**
 * Importa el extracto del banco (CSV, Excel o, en tarjetas, PDF/foto leído con IA) y lo cruza con la app: faltantes, duplicados, 4x1000, intereses y gastos bancarios.
 * En las tarjetas con día de corte se compara el ciclo del extracto (no el mes calendario) y se comprueba si las partidas
 * conciliatorias del cierre anterior (`carryOver`) ya aparecen en este extracto.
 */
export function StatementImport({ account, month, onBalance, onStatus, carryOver }: { account: Account; month: string; onBalance: (v: number) => void; onStatus?: (s: string | null) => void; carryOver?: ReconcilingItem[] }) {
  const state = useFinance();
  const { transactions, supabase, reload, uvt, me } = state;
  const { openPayment } = useShell();
  const isCard = account.kind === "CREDIT_CARD";
  const byCycle = isCard && !!account.statement_day;
  const base = isCard ? cycleRange(account.statement_day, month) : monthRange(month);
  const scope = byCycle ? "ciclo" : "mes";

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [flip, setFlip] = useState(false);
  const [purchasesPositive, setPurchasesPositive] = useState(true);
  const [map, setMap] = useState<Partial<ColumnMap>>({});
  const [showColumns, setShowColumns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  /** Movimientos leídos del PDF o la foto con la IA (solo tarjetas); reemplaza a las filas del CSV. */
  const [pdf, setPdf] = useState<CardLinesData | null>(null);
  /** Vínculos hechos a mano entre una línea del extracto y un movimiento de la app que no se unieron solos. Valen mientras el extracto está abierto. */
  const [links, setLinks] = useState<ManualLink[]>([]);
  /** Parejas que el cruce por valor unió con fechas muy distintas y la persona separó ("esta no es"). */
  const [apart, setApart] = useState<ManualLink[]>([]);
  /** Parejas "mismo movimiento con otro valor" que la persona descartó (`línea|movimiento`). */
  const [notPairs, setNotPairs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pdfRead = useMemo(() => (pdf ? parsedFromCardLines(pdf) : null), [pdf]);
  const parsed = useMemo(() => (pdfRead ? pdfRead.parsed : rows === null ? null : parseStatementRows(rows, { map, flip, purchasesPositive, isCard, yearHint: Number(month.slice(0, 4)) })), [pdfRead, rows, map, flip, purchasesPositive, isCard, month]);
  // Tarjetas: el ciclo del extracto recortado a lo que cubre el archivo (si trae el mes calendario, solo la parte que se cruza con el ciclo)
  const range = useMemo(() => (byCycle && parsed ? coveredRange(base, parsed.lines, parsed.period) : base), [byCycle, parsed, base.start, base.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const inMonth = useMemo(() => (parsed?.lines ?? []).filter((l) => l.date >= range.start && l.date <= range.end), [parsed, range.start, range.end]);
  // Las partidas del cierre anterior pueden estar fechadas antes del ciclo (la app las dejó en octubre y el banco las cobró en noviembre): se cruzan por valor
  const carryTxIds = useMemo(() => (carryOver ?? []).flatMap((i) => (i.transaction_id ? [i.transaction_id] : [])), [carryOver]);
  const auto = useMemo(() => (parsed ? reconcileStatement(account, transactions, parsed.lines, range, 3, { carryTxIds, apart }) : null), [parsed, account, transactions, range.start, range.end, carryTxIds, apart]); // eslint-disable-line react-hooks/exhaustive-deps
  // El resultado con los vínculos manuales: todo lo de abajo (totales, estado, partidas del cierre anterior) parte de este
  const rec = useMemo(() => (auto ? withManualLinks(auto, links, account, transactions) : null), [auto, links, account, transactions]);
  const accountTxs = useMemo(() => transactions.filter((t) => t.account_id === account.id || t.to_account_id === account.id), [transactions, account.id]);
  const manual = (rec?.matched ?? []).filter((m) => m.manual && m.entry);
  const byValue = (rec?.matched ?? []).filter((m) => m.dateGap !== undefined && !m.manual && m.entry);
  // Líneas fechadas justo fuera del ciclo que el banco facturó en este extracto (se cruzaron con la app) y las que quedan sin comparar
  const edgeMatched = (rec?.matched ?? []).filter((m) => m.edge).length;
  const notCompared = useMemo(() => {
    const used = new Set((rec?.matched ?? []).filter((m) => m.edge).map((m) => m.line.id));
    return (parsed?.lines ?? []).filter((l) => (l.date < range.start || l.date > range.end) && !used.has(l.id)).sort((a, b) => a.date.localeCompare(b.date));
  }, [parsed, rec, range.start, range.end]);
  const charges = useMemo(() => bankCharges(account, inMonth, uvt), [account, inMonth, uvt]);
  const closing = useMemo(() => (parsed ? closingBalance(parsed.raw.filter((l) => l.date >= range.start && l.date <= range.end)) : null), [parsed, range.start, range.end]);
  const inflow = inMonth.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0);
  const outflow = inMonth.filter((l) => l.amount < 0).reduce((a, l) => a - l.amount, 0);

  const carry = useMemo(() => (carryOver?.length ? carryOverStatus(carryOver, transactions, rec, range) : []), [carryOver, transactions, rec, range.start, range.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const carryMissing = carry.filter((c) => c.status === "NOT_FOUND").length;
  const duplicateIds = new Set((rec?.duplicates ?? []).map((d) => d.entry.tx.id));
  // Las partidas del cierre anterior se muestran en su propia sección: aquí no deben salir otra vez
  const carryIds = new Set(carry.flatMap((c) => (c.item.transaction_id ? [c.item.transaction_id] : [])));
  // Las diferencias que esta pantalla registró (#diferencia) son parte del arreglo: no se muestran como "solo en la app"
  const onlyInApp = (rec?.extra ?? []).filter((e) => !duplicateIds.has(e.tx.id) && !carryIds.has(e.tx.id) && !e.tx.tags.includes(DIFFERENCE_TAG));
  // Lo que falta y lo que sobra pero se parecen (mismo movimiento con otro valor): se proponen como pareja en vez de aparecer sueltos
  const pairs = rec ? valuePairs(rec.missing, onlyInApp, account, me.user_id, notPairs) : [];
  const pairedLines = new Set(pairs.map((p) => p.line.id));
  const pairedTxs = new Set(pairs.map((p) => p.entry.tx.id));
  const missingShown = (rec?.missing ?? []).filter((l) => !pairedLines.has(l.id));
  const onlyInAppShown = onlyInApp.filter((e) => !pairedTxs.has(e.tx.id));

  // PDF: si lo leído no suma lo que dice el resumen del extracto, puede faltar algún movimiento y "no falta nada" no sería confiable
  const totalsOff = (pdfRead?.totals ?? []).filter((t) => !t.ok);
  const status = !rec ? null
    : rec.missing.length + rec.duplicates.length + carryMissing + totalsOff.length === 0 ? "Revisado: no falta ni sobra ningún movimiento"
    : `Revisado: ${[rec.missing.length && `${rec.missing.length} falta${rec.missing.length === 1 ? "" : "n"} en la app`, rec.duplicates.length && `${rec.duplicates.length} repetido${rec.duplicates.length === 1 ? "" : "s"}`, carryMissing && `${carryMissing} partida${carryMissing === 1 ? "" : "s"} del cierre anterior sin aparecer`, totalsOff.length && "la lectura del PDF no cuadra con los totales del extracto (puede faltar algún movimiento)"].filter(Boolean).join(" · ")}`;
  useEffect(() => { onStatus?.(status); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    const isDoc = file.type === "application/pdf" || file.type.startsWith("image/") || /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name);
    if (isDoc && isCard) return readCardPdf(file);
    if (file.size > 5_000_000) return setError("El archivo es muy grande (más de 5 MB). ¿Es el extracto en CSV o Excel?");
    try {
      setRows(await readStatementFile(file));
      setPdf(null);
      setLinks([]);
      setApart([]);
      setNotPairs([]);
      setFileName(file.name);
      setMap({});
      setFlip(false);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error && e.message ? e.message : "No se pudo leer el archivo.");
    }
  }

  /** Tarjetas: la IA lee la lista de movimientos del PDF o la foto. Es una lectura aparte de la de totales y cuotas. */
  async function readCardPdf(file: File) {
    if (!navigator.onLine) return setError("Sin conexión: para leer el PDF necesitas internet. El Excel o CSV se lee sin conexión.");
    setReading(true);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const payload = isPdf ? { data: await toBase64(file), mime: "application/pdf" } : await shrink(file, 2400);
      if (payload.data.length > 4_200_000) throw new Error("El archivo es muy pesado (máximo ~3 MB). Prueba con el Excel o CSV del banco.");
      const res = await fetch("/api/card-statement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, today: todayBogota(), mode: "lines" }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: CardLinesData; error?: string };
      if (!body.ok || !body.result) throw new Error(body.error ?? "No se pudo leer el extracto.");
      setPdf(body.result);
      setLinks([]);
      setApart([]);
      setNotPairs([]);
      setRows(null);
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "No se pudo leer el extracto.");
    } finally {
      setReading(false);
    }
  }

  async function registerContext() {
    return {
      accountId: account.id, userId: me.user_id,
      bankCategoryId: await ensureCategory(state, supabase, BANK_CATEGORY.name, BANK_CATEGORY.icon),
      unknownCategoryId: await ensureCategory(state, supabase, UNKNOWN_CATEGORY.name, UNKNOWN_CATEGORY.icon),
      interestCategoryId: await ensureCategory(state, supabase, INTEREST_CATEGORY.name, INTEREST_CATEGORY.icon, "INCOME"),
    };
  }

  /** Una acción sobre un solo movimiento: la persona decide uno a uno. */
  async function act(run: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await run());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      void reload();
    }
  }

  /** Registra esta línea del banco (4x1000, intereses, cuota, seguro) tal como la trae el extracto. */
  const registerBankLine = (line: StatementLine) => act(async () => {
    const { error } = await supabase.rpc("save_transaction", { p: registerPayload(line, await registerContext()) });
    if (error) throw error;
    return `Registré ${(line.description || "el movimiento").slice(0, 40)} (${formatCop(Math.abs(line.amount))}).`;
  });

  /** El movimiento de la app queda con el valor que cobró el banco. */
  const setPairAmount = (pair: ValuePair) => act(async () => {
    const { error } = await supabase.rpc("save_transaction", { p: editPayload(pair.entry.tx, { amount: Math.abs(pair.line.amount) }) });
    if (error) throw error;
    return `Dejé ${(pair.entry.tx.description || pair.entry.tx.merchant || "el movimiento").slice(0, 40)} en ${formatCop(Math.abs(pair.line.amount))}, como dice el extracto.`;
  });

  /** El movimiento de la app no se toca: se registra aparte lo que el banco cobró de más (o de menos) y se unen. */
  const registerPairDifference = (pair: ValuePair) => act(async () => {
    const { error } = await supabase.rpc("save_transaction", { p: differencePayload(pair, await registerContext()) });
    if (error) throw error;
    setLinks((k) => [...k, { lineId: pair.line.id, txId: pair.entry.tx.id }]);
    return `Registré la diferencia de ${formatCop(Math.abs(pair.diff))} y uní los dos movimientos.`;
  });

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
        <FileUp size={16} /> {isCard ? "Subir el extracto (PDF, Excel o CSV)" : "Subir Excel o CSV de movimientos"}
      </Button>

      <Sheet open={open} onOpenChange={setOpen} title="Revisar los movimientos" description={`${account.name}${account.last4 ? ` ··${account.last4}` : ""} · ${month}`}>
        <div className="space-y-4 pb-2">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface px-4 py-5 text-sm font-medium hover:bg-surface-2">
              <FileUp size={18} /> {reading ? "Leyendo el extracto…" : fileName || (isCard ? "Elegir el extracto (PDF, Excel o CSV)" : "Elegir el extracto (Excel o CSV)")}
              <input type="file" disabled={reading} accept={`.csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet${isCard ? ",application/pdf,.pdf,image/*" : ""}`} className="sr-only" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <p className="text-xs text-muted">{isCard
              ? "El Excel o CSV se lee en tu celular y no se sube a ningún lado. El PDF o la foto del extracto sí se envía a la IA (Gemini) para leerlo y no se guarda; la lectura puede tardar hasta un minuto y a veces se equivoca, por eso se compara con los totales del extracto. "
              : "El archivo se lee en tu celular; no se sube a ningún lado. Descárgalo desde la página o app de tu banco (extracto en Excel .xlsx o CSV). "}Si trae varios meses, se compara solo {byCycle ? "el ciclo" : "el mes"} que estás cerrando.</p>
          </div>

          <ErrorText>{error}</ErrorText>
          {notice && <p className="rounded-xl bg-olive-soft px-3 py-2 text-sm">{notice}</p>}

          {parsed && parsed.warnings.length > 0 && parsed.lines.length === 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{parsed.warnings.join(" ")}</p>
          )}

          {parsed && (
            <>
              <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
                <p className="font-semibold">{inMonth.length} movimiento{inMonth.length === 1 ? "" : "s"} del {scope} en el extracto</p>
                {byCycle && <p className="text-xs text-muted">Fechas que se comparan: {formatDay(range.start)} – {formatDay(range.end)} (ciclo de la tarjeta)</p>}
                <p className="num text-muted">Entró {formatCop(inflow)} · Salió {formatCop(outflow)}</p>
                {rec && rec.outOfRange > 0 && (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">{rec.outOfRange} línea{rec.outOfRange === 1 ? "" : "s"} de otros {byCycle ? "ciclos" : "meses"} no se comparan (ver cuáles)</summary>
                    <ul className="mt-1 space-y-0.5">
                      {notCompared.slice(0, 40).map((l) => (
                        <li key={l.id} className="flex justify-between gap-2"><span className="truncate">{formatDay(l.date)} · {(l.description || "Sin descripción").slice(0, 30)}</span><span className="num shrink-0">{signed(l.amount)}</span></li>
                      ))}
                    </ul>
                  </details>
                )}
                {edgeMatched > 0 && <p className="text-xs text-muted">{edgeMatched} línea{edgeMatched === 1 ? "" : "s"} fechada{edgeMatched === 1 ? "" : "s"} justo fuera del ciclo (el banco {edgeMatched === 1 ? "la facturó" : "las facturó"} en este extracto) ya {edgeMatched === 1 ? "está" : "están"} en la app.</p>}
                {parsed.skipped > 0 && <p className="text-xs text-muted">{parsed.skipped} fila{parsed.skipped === 1 ? "" : "s"} sin fecha o valor (títulos, totales) se ignoraron.</p>}
                {closing !== null && (
                  <button className="mt-2 text-xs font-medium text-olive underline" onClick={() => { onBalance(Math.abs(closing)); setNotice(`Usé ${formatCop(Math.abs(closing))} como ${isCard ? "deuda" : "saldo"} del banco.`); }}>
                    Usar el saldo final del extracto ({formatCop(closing)}) como {isCard ? "deuda" : "saldo"} del banco
                  </button>
                )}
              </div>

              {pdfRead && (
                <div className="space-y-2 rounded-2xl border border-border bg-surface p-3 text-sm">
                  <p className="font-semibold">Leído del PDF con IA</p>
                  {pdfRead.totals.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs text-muted">Lo que sumé de los movimientos contra el resumen que imprime el extracto:</p>
                      {pdfRead.totals.map((t) => (
                        <div key={t.key} className="flex flex-wrap items-center justify-between gap-2">
                          <span className={cn("flex items-center gap-1.5", !t.ok && "text-warning")}>{t.ok ? <CheckCircle2 size={14} className="text-olive" /> : <AlertTriangle size={14} />}{t.label}</span>
                          <span className="num text-right text-xs">{formatCop(t.read)} · extracto {formatCop(t.printed)}</span>
                          {t.note && <span className="basis-full text-xs text-muted">{t.note}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted">Este extracto no trae un resumen de totales, así que no puedo comprobar que la lectura esté completa. Revisa que estén todos los movimientos.</p>
                  )}
                  {totalsOff.length > 0 && (
                    <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      Lo leído no cuadra con el resumen: puede que la IA se haya saltado o repetido algún movimiento. Antes de registrar o borrar algo, confírmalo en el extracto. Si insiste, usa el Excel o CSV del banco.
                    </p>
                  )}
                  {pdfRead.installmentLines.length > 0 && (
                    <p className="text-xs text-muted">{pdfRead.installmentLines.length} cuota{pdfRead.installmentLines.length === 1 ? "" : "s"} de compras a cuotas no se cruzan aquí (en la app la compra es una sola): se revisan en la validación de cuotas del extracto.</p>
                  )}
                </div>
              )}

              {!pdf && (
              <>
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
            </>
          )}

          {rec && inMonth.length > 0 && (
            <>
              <p className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium", rec.matched.length === inMonth.length + edgeMatched ? "bg-olive-soft" : "bg-surface-2")}>
                <CheckCircle2 size={16} /> {rec.matched.length} de {inMonth.length + edgeMatched} ya están en la app
              </p>
              {rec.matched.some((m) => m.approx) && (
                <p className="px-1 text-xs text-muted">
                  {rec.matched.filter((m) => m.approx).length} coinciden con una pequeña diferencia de valor (compras internacionales: el banco cobra comisión de cambio):{" "}
                  {rec.matched.filter((m) => m.approx).map((m) => `${(m.line.description || "").slice(0, 24)} ${formatCop(Math.abs(m.line.amount))} vs ${formatCop(Math.abs(m.entry?.amount ?? 0))} en la app`).join("; ")}.
                </p>
              )}

              {byValue.length > 0 && (
                <section className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Scale size={15} /> Unidos por valor con otra fecha ({byValue.length})</h3>
                  <p className="text-xs text-muted">Valen exactamente lo mismo, pero la app los tiene en una fecha y el extracto en otra (hasta {VALUE_WINDOW_DAYS} días). Si alguno no es la misma compra, sepáralo.</p>
                  <div className="divide-y divide-border">
                    {byValue.map((m) => (
                      <div key={m.line.id} className="flex items-center gap-2 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.line.description || "Sin descripción"}</span>
                          <span className="block truncate text-xs text-muted">Extracto {formatDay(m.line.date)} · app {formatDay(m.entry!.date)} ({m.dateGap} días) · {m.entry!.tx.description || m.entry!.tx.merchant || "Movimiento"}</span>
                        </span>
                        <span className="num shrink-0 text-right text-xs">{signed(m.line.amount)}</span>
                        <Button size="sm" variant="outline" onClick={() => setApart((a) => [...a, { lineId: m.line.id, txId: m.entry!.tx.id }])}>Separar</Button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {manual.length > 0 && (
                <section className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Link2 size={15} /> Vinculados a mano ({manual.length})</h3>
                  <p className="text-xs text-muted">Los uniste tú porque la app no los reconoció solos. Valen mientras tengas este extracto abierto.</p>
                  <div className="divide-y divide-border">
                    {manual.map((m) => (
                      <div key={m.line.id} className="flex items-center gap-2 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.line.description || "Sin descripción"}</span>
                          <span className="block truncate text-xs text-muted">{formatDay(m.line.date)} · en la app: {m.entry!.tx.description || m.entry!.tx.merchant || "Movimiento"} {formatDay(m.entry!.date)}</span>
                        </span>
                        <span className="num shrink-0 text-right text-xs">{signed(m.line.amount)}<span className="block text-muted">app {signed(m.entry!.amount)}</span></span>
                        <Button size="sm" variant="outline" onClick={() => setLinks((l) => l.filter((k) => k.lineId !== m.line.id))}>Deshacer</Button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {pairs.length > 0 && (
                <section className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Scale size={15} /> Parecen el mismo movimiento, con otro valor ({pairs.length})</h3>
                  <p className="text-xs text-muted">Están en el extracto y en la app, con fecha parecida pero no el mismo valor (un avance con comisión, puntos redimidos…). Tú decides qué hacer con cada una; si no es el mismo movimiento, pulsa “No es”.</p>
                  <div className="divide-y divide-border">
                    {pairs.map((pr) => (
                      <div key={pr.line.id} className="space-y-1.5 py-2 text-sm">
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{pr.line.description || "Sin descripción"}</span>
                            <span className="block truncate text-xs text-muted">Extracto {formatDay(pr.line.date)} · app {formatDay(pr.entry.date)} · {pr.entry.tx.description || pr.entry.tx.merchant || "Movimiento"}</span>
                          </span>
                          <span className="num shrink-0 text-right text-xs">{signed(pr.line.amount)}<span className="block text-muted">app {signed(pr.entry.amount)}</span></span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {pr.editable && <Button size="sm" variant="outline" disabled={busy} onClick={() => setPairAmount(pr)}>Poner {formatCop(Math.abs(pr.line.amount))} en la app</Button>}
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => registerPairDifference(pr)}>Registrar la diferencia ({formatCop(Math.abs(pr.diff))})</Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setNotPairs((n) => [...n, pairKey(pr.line, pr.entry.tx)])}>No es</Button>
                        </div>
                        {!pr.editable && <p className="text-xs text-muted">Este movimiento de la app es una transferencia, tiene cuotas o lo registró otra persona: no le cambio el valor, solo puedo registrar la diferencia.</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {missingShown.length > 0 && (
                <section className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><PlusCircle size={15} /> Faltan en la app ({missingShown.length})</h3>
                  <p className="text-xs text-muted">Están en el extracto y no los encontré en la app (ni con el mismo valor en otra fecha). Registra cada uno con su botón; si alguno sí está en la app con otro valor o nombre, vincúlalo con su movimiento.</p>
                  <div className="divide-y divide-border">
                    {missingShown.map((l) => (
                      <div key={l.id} className="py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{l.description || "Sin descripción"}</span>
                            <span className="block text-xs text-muted">{formatDay(l.date)}{KIND_LABEL[l.kind] ? ` · ${KIND_LABEL[l.kind]}` : ""}</span>
                          </span>
                          <span className={cn("num shrink-0 font-semibold", l.amount > 0 && "text-olive")}>{signed(l.amount)}</span>
                          {isBankLine(l)
                            ? <Button size="sm" variant="outline" disabled={busy} onClick={() => registerBankLine(l)}>Registrar</Button>
                            : <Button size="sm" variant="outline" onClick={() => registerManually(l)}>Registrar</Button>}
                        </div>
                        {!l.id.startsWith("G:") && (
                          <LinkSelect label="Ya está en la app: elegir cuál"
                            options={appCandidatesFor(l, account, accountTxs, rec).map((e) => ({ value: e.tx.id, label: `${formatDay(e.date)} · ${(e.tx.description || e.tx.merchant || "Movimiento").slice(0, 28)} · ${signed(e.amount)}` }))}
                            onPick={(txId) => setLinks((k) => [...k, { lineId: l.id, txId }])} />
                        )}
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

              {onlyInAppShown.length > 0 && (
                <section className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><HelpCircle size={15} /> En la app, no en el extracto ({onlyInAppShown.length})</h3>
                  <p className="text-xs text-muted">Puede que el banco los registre otro día o que no se hayan hecho. Si alguno sí está en el extracto con otro valor o nombre, vincúlalo.</p>
                  <div className="divide-y divide-border">
                    {onlyInAppShown.map((e) => (
                      <div key={e.tx.id}>
                        {appRow(e)}
                        <LinkSelect label="Está en el extracto: elegir cuál"
                          options={lineCandidatesFor(e, rec).map((l) => ({ value: l.id, label: `${formatDay(l.date)} · ${(l.description || "Sin descripción").slice(0, 28)} · ${signed(l.amount)}` }))}
                          onPick={(lineId) => setLinks((k) => [...k, { lineId, txId: e.tx.id }])} />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {carry.length > 0 && (
                <section className="space-y-1">
                  <h3 className={cn("flex items-center gap-1.5 text-sm font-semibold", carryMissing > 0 && "text-warning")}><History size={15} /> Partidas del cierre anterior ({carry.length})</h3>
                  <p className="text-xs text-muted">Eran movimientos que el banco todavía no había cobrado al cerrar el mes pasado. Deberían venir en este extracto.</p>
                  <div className="divide-y divide-border">
                    {carry.map((c, i) => {
                      const tx = c.status === "NOT_FOUND" ? transactions.find((t) => t.id === c.item.transaction_id) : undefined;
                      const entry = tx ? appEntryOf(account, tx) : null;
                      return (
                        <div key={c.item.transaction_id ?? `sin-mov-${i}`}>
                          <div className="flex items-center gap-2 py-2 text-sm">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{c.item.description}</span>
                              <span className={cn("block text-xs", c.status === "NOT_FOUND" ? "text-warning" : "text-muted")}>
                                {c.item.occurred_on ? `${formatDay(c.item.occurred_on)} · ` : ""}{CARRY_LABEL[c.status]}
                                {c.status === "FOUND" && c.line ? ` (${formatDay(c.line.date)})` : ""}
                              </span>
                            </span>
                            <span className="num shrink-0 font-semibold">{signed(c.item.amount)}</span>
                          </div>
                          {entry && rec && (
                            <LinkSelect label="Está en el extracto: elegir cuál"
                              options={lineCandidatesFor(entry, rec, 8, VALUE_WINDOW_DAYS).map((l) => ({ value: l.id, label: `${formatDay(l.date)} · ${(l.description || "Sin descripción").slice(0, 28)} · ${signed(l.amount)}` }))}
                              onPick={(lineId) => setLinks((k) => [...k, { lineId, txId: entry.tx.id }])} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="space-y-2 rounded-2xl border border-border bg-surface p-3 text-sm">
                <h3 className="flex items-center gap-1.5 font-semibold"><Landmark size={15} /> Cobros del banco en el extracto</h3>
                {charges.gmf.applies ? (
                  <p className={cn("rounded-xl px-3 py-2", charges.gmf.ok || charges.gmf.charged === 0 ? "bg-olive-soft" : "bg-warning-soft")}>
                    <strong>4x1000:</strong> el banco cobró {formatCop(charges.gmf.charged)}; según tus salidas debería rondar {formatCop(charges.gmf.expected)}.{" "}
                    {charges.gmf.charged === 0
                      ? `El extracto no trae cobros de 4x1000: ${charges.gmf.expected <= 0 ? "coincide con una cuenta exenta." : "tu cuenta parece exenta (lo que sale está por debajo del tope de 350 UVT). Si es así, cámbialo en Cuentas → 4x1000 para que la app no lo estime."}`
                      : charges.gmf.ok
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

              {rec.missing.length === 0 && rec.duplicates.length === 0 && carryMissing === 0 && (
                <p className="text-xs text-muted">Todo el extracto está en la app. Ahora cierra la cuenta con el saldo del banco.</p>
              )}
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
