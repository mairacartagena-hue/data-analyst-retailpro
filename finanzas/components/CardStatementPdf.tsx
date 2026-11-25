"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { LinkSelect } from "@/components/LinkSelect";
import { ManualCrossCheck, StatementCrossCheck, StatementFields, emptyDraft, statementOf, type StatementDraft } from "@/components/CardStatements";
import { ReviewRow, type RowTone } from "@/components/ReviewRow";
import type { Account } from "@/lib/types";
import type { CardStatementData, CardStatementPurchase } from "@/lib/capture/cardStatement";
import { checkInstallments, checkStatement, diffVerdict, installmentFix, knownItem, onlyExtractCandidates, purchaseLinkCandidates, registeredTx, type InstallmentCheck, type InstallmentDiff, type InstallmentFix, type InstallmentVerdict } from "@/lib/finance/cardStatements";
import { editPayload } from "@/lib/finance/txEdit";
import { installmentsOf, matchedWithItems } from "@/lib/finance/installments";
import { openingDay } from "@/lib/finance/cardBudget";
import { formatCop } from "@/lib/finance/money";
import { formatDay, todayBogota } from "@/lib/finance/periods";
import { shrink, toBase64 } from "@/lib/capture/file";
import { cn, errMsg } from "@/lib/utils";

const VERDICT_LABEL: Record<Exclude<InstallmentVerdict, "OK">, string> = { DIFFERS: "Difiere", ONLY_EXTRACT: "Solo en el extracto", ONLY_APP: "Solo en la app" };
const FIELD_LABEL: Record<InstallmentDiff["field"], string> = { installments: "Total de cuotas", amount: "Valor de la compra", current: "Cuota de este extracto", charge: "Cargo del mes", balance: "Saldo pendiente" };
const diffValue = (field: InstallmentDiff["field"], n: number) => (field === "balance" || field === "charge" || field === "amount" ? formatCop(n) : String(n));

/**
 * Cuotas: lo que dice el extracto contra lo que tiene la app, compra por compra. No cambia nada por sí sola: cuando la diferencia es el
 * total de cuotas, cada compra trae su botón para poner en la app las cuotas del extracto.
 * Si el cruce automático no unió una compra que sí es la misma (valor o fecha distintos), se vincula a mano desde aquí:
 * el vínculo vale mientras tengas el extracto abierto y deja ver en qué se diferencian.
 */
function InstallmentChecks({ account, checks, fixing, onLink, onUnlink, onSeparate, onFix }: { account: Account; checks: InstallmentCheck[]; fixing: boolean; onLink: (index: number, txId: string) => void; onUnlink: (index: number) => void; onSeparate: (index: number, txId: string) => void; onFix: (fix: InstallmentFix) => void }) {
  const { openTransaction } = useShell();
  const { transactions, cardItems, me } = useFinance();
  const needs = checks.filter((c) => c.verdict !== "OK");
  // Las vinculadas se muestran aunque cuadren, para poder deshacer el vínculo
  const bad = checks.filter((c) => c.verdict !== "OK" || c.linked || c.dateGap !== undefined);
  const ok = checks.length - needs.length;
  // Movimientos que ya tienen su pareja: no se ofrecen para vincular
  const taken = useMemo(() => {
    const mine = transactions.filter((t) => t.account_id === account.id);
    const ids = new Set(matchedWithItems(mine, cardItems.filter((i) => i.account_id === account.id)));
    for (const c of checks) if (c.tx && c.verdict !== "ONLY_APP") ids.add(c.tx.id);
    return ids;
  }, [transactions, cardItems, checks, account.id]);
  const txLabel = (t: { occurred_on: string; merchant?: string | null; description?: string | null; amount: number }) => `${formatDay(t.occurred_on)} · ${(t.merchant || t.description || "Movimiento").slice(0, 28)} · ${formatCop(t.amount)}`;
  return (
    <div className="space-y-1.5">
      <p className="font-medium">Cuotas: extracto vs. app</p>
      <p className={cn("rounded-lg px-2 py-1", needs.length === 0 ? "bg-olive-soft" : "bg-warning-soft")}>
        {needs.length === 0
          ? `Las ${ok} compra${ok === 1 ? "" : "s"} a cuotas cuadran con la app.`
          : `${needs.length} para revisar · ${ok} cuadra${ok === 1 ? "" : "n"}`}
      </p>
      {bad.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {bad.map((c, i) => {
            const fix = installmentFix(c, account, me.user_id);
            return (
            <li key={c.purchase ? `${c.purchase.description}|${c.purchase.purchaseDate}|${c.purchase.amount}|${i}` : `app-${c.tx?.id ?? i}`} className="space-y-0.5 px-3 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{c.purchase?.description ?? c.tx?.merchant ?? c.tx?.description ?? "Compra"}</span>
                {c.verdict === "OK"
                  ? <span className="shrink-0 text-olive">Cuadra</span>
                  : <span className="shrink-0 text-warning">{VERDICT_LABEL[c.verdict as Exclude<InstallmentVerdict, "OK">]}</span>}
              </div>
              {c.linked && c.tx && (
                <p className="text-muted">
                  Vinculada a mano con {txLabel(c.tx)} de la app.{" "}
                  <button className="text-olive underline" onClick={() => onUnlink(c.index!)}>Deshacer</button>
                </p>
              )}
              {c.dateGap !== undefined && c.tx && c.purchase && (
                <p className="text-muted">
                  Unida por valor: la app la tiene el {formatDay(c.tx.occurred_on)} y el extracto el {formatDay(c.purchase.purchaseDate)} ({c.dateGap} días).{" "}
                  <button className="text-olive underline" onClick={() => onSeparate(c.index!, c.tx!.id)}>Separar</button>
                </p>
              )}
              {c.diffs.map((d) => (
                <p key={d.field} className="text-muted">{FIELD_LABEL[d.field]}: la app {diffValue(d.field, d.app)} · el extracto {diffValue(d.field, d.extract)}</p>
              ))}
              {c.verdict === "ONLY_EXTRACT" && c.purchase && c.index !== undefined && (
                <>
                  <p className="text-muted">No la encontré en la app ni en las compras guardadas de la tarjeta (se busca con el mismo valor y fecha a ±1 día). Si ya está en la app con otro valor o fecha, vincúlala; si no, puedes agregarla abajo.</p>
                  <LinkSelect label="Ya está en la app: elegir cuál"
                    options={purchaseLinkCandidates(account, transactions, c.purchase, taken).map((t) => ({ value: t.id, label: txLabel(t) }))}
                    onPick={(txId) => onLink(c.index!, txId)} />
                </>
              )}
              {c.verdict === "ONLY_APP" && c.tx && (
                <>
                  <p className="text-muted">Compra del {c.tx.occurred_on} a {c.tx.installments} cuotas ({formatCop(c.tx.amount)}): ya debería venir en este extracto y no la encontré. Si sí viene con otro valor o fecha, vincúlala.</p>
                  <LinkSelect label="Está en el extracto: elegir cuál"
                    options={onlyExtractCandidates(checks, c.tx).map((o) => ({ value: String(o.index), label: `${(o.purchase!.description || "Compra").slice(0, 28)} · ${formatCop(o.purchase!.amount)} · ${formatDay(o.purchase!.purchaseDate)}` }))}
                    onPick={(index) => onLink(Number(index), c.tx!.id)} />
                </>
              )}
              {fix && (
                <div>
                  <Button size="sm" variant="outline" disabled={fixing} onClick={() => onFix(fix)}>Poner {fix.to} cuotas en la app (hoy {fix.from})</Button>
                </div>
              )}
              {c.tx && <button className="text-olive underline" onClick={() => openTransaction(c.tx!)}>Abrir el movimiento</button>}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * La IA lee el extracto de la tarjeta (PDF o foto). Ni el archivo ni los valores del extracto se guardan:
 *  · corte, fecha de pago, pago mínimo, pago total y deuda quedan en el formulario (editables) y se cruzan al momento con la app;
 *  · las compras a cuotas que no están en la app se pueden agregar, una por una, a la proyección de la tarjeta.
 * Las compras que ya están (como compra del extracto o registradas en la app con las mismas cuotas) no se repiten.
 */
/** `crossCheck`: en el Cierre del mes muestra los valores del extracto y su cruce; en la tarjeta solo las compras a cuotas. */
export function CardStatementPdf({ account, onBalance, onStatus, crossCheck = false, incoming = null, onFile, rows = false, month, idleNote }: {
  account: Account; onBalance?: (v: number) => void; onStatus?: (s: string | null) => void; crossCheck?: boolean;
  /** Revisión de la tarjeta en un solo paso: no trae su propio botón de subir (lee el `incoming`) y muestra dos filas, Deuda y Cuotas, con el detalle plegado. */
  rows?: boolean;
  /** Mes que se cierra (para escribir los valores a mano cuando no hay PDF). Solo con `rows`. */
  month?: string;
  /** Lo que dicen las filas mientras no hay extracto leído (por ejemplo, que se subió un Excel que no trae la deuda). Solo con `rows`. */
  idleNote?: string;
  /** Extracto que la persona subió en el otro paso: se lee aquí también, sin pedirlo otra vez. */
  incoming?: File | null;
  /** Avisa que se subió un extracto para que el otro paso lo lea también. */
  onFile?: (file: File) => void;
}) {
  const { cardItems, transactions, supabase, reload, me } = useFinance();
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [read, setRead] = useState<CardStatementData | null>(null);
  const [draft, setDraft] = useState<StatementDraft>(emptyDraft);
  const [notice, setNotice] = useState<string | null>(null);
  // Compras a cuotas tal como las leyó el extracto (se conservan después de agregarlas a la proyección para seguir comparándolas)
  const [extracted, setExtracted] = useState<CardStatementPurchase[]>([]);
  // Vínculos hechos a mano: posición de la compra en el extracto → movimiento de la app. Valen mientras el extracto está abierto.
  const [links, setLinks] = useState<Record<number, string>>({});
  // Parejas por valor con fechas muy distintas que la persona separó (`posición|movimiento`)
  const [apart, setApart] = useState<string[]>([]);
  /** Último archivo leído, para volver a leerlo si la lectura vino incompleta. */
  const lastFile = useRef<File | null>(null);

  const purchases = read?.purchases ?? [];
  const inCard = (p: CardStatementPurchase) => !!knownItem(p, cardItems, account.id);
  const inApp = (p: CardStatementPurchase) => {
    const t = registeredTx(p, transactions, account.id);
    return !!t && installmentsOf(t) === p.installments;
  };
  const fresh = purchases.filter((p) => !inCard(p) && !inApp(p));
  const already = purchases.length - fresh.length;
  const cutDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.cut) ? draft.cut : null;
  // Sin compras leídas no hay con qué comparar: la lista "solo en la app" sería falsa (la lectura falló, no es que falten)
  const checks = useMemo(
    () => (crossCheck && read && extracted.length > 0 ? checkInstallments(account, transactions, cardItems, extracted, cutDate, links, apart) : []),
    [crossCheck, read, account, transactions, cardItems, extracted, cutDate, links, apart],
  );
  const noPurchasesRead = crossCheck && !!read && extracted.length === 0;
  // Resumen de la deuda en una línea (fila "Deuda"): se recalcula al corregir los valores
  const debtResult = useMemo((): { text: string; tone: RowTone } | null => {
    if (!read) return null;
    const st = statementOf(account.id, draft);
    if (!st) return { text: "Falta la fecha de corte para compararla", tone: "warn" };
    const c = checkStatement(account, transactions, cardItems, st);
    const bad: string[] = [];
    if (c.debtDiff !== null && !diffVerdict(c.debtDiff).ok) bad.push(`la deuda de la app es ${formatCop(Math.abs(c.debtDiff))} ${c.debtDiff > 0 ? "mayor" : "menor"}`);
    if (c.minimumDiff !== null && !diffVerdict(c.minimumDiff).ok) bad.push("la cuota del mes no coincide con el pago mínimo");
    if (bad.length > 0) return { text: bad.join(" · ").replace(/^./, (ch) => ch.toUpperCase()), tone: "warn" };
    if (c.debtDiff === null) return { text: "El extracto no trae la deuda para comparar", tone: "idle" };
    return { text: "La deuda coincide con la app", tone: "ok" };
  }, [read, account, draft, transactions, cardItems]);

  // El extracto que se subió en el otro paso: se lee aquí también
  useEffect(() => {
    if (incoming) void pick(incoming, true);
  }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(file: File | undefined, fromOtherStep = false) {
    if (!file) return;
    lastFile.current = file;
    if (!fromOtherStep) onFile?.(file);
    setErr(null);
    setNotice(null);
    setRead(null);
    setExtracted([]);
    setLinks({});
    setApart([]);
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
      setExtracted(r.purchases);
      const s = (v?: number) => (v === undefined ? "" : String(v));
      setDraft({ cut: r.statementDate ?? "", due: r.dueDate ?? "", minimum: s(r.minimumPayment), total: s(r.totalPayment), debt: s(r.totalDebt) });
      if (r.totalDebt !== undefined) onBalance?.(r.totalDebt);
      onStatus?.("Extracto leído: revisa el cruce de la deuda abajo");
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
    // Compras de un extracto posterior al registro de la tarjeta: su saldo se factura desde el corte siguiente a este
    const open = account.opening_at ? openingDay(account.opening_at) : null;
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(draft.cut) && open && draft.cut > open ? draft.cut : null;
    const { error } = await supabase.from("card_statement_items").insert(fresh.map((p) => ({
      account_id: account.id, description: p.description, purchase_date: p.purchaseDate, amount: p.amount, installments: p.installments,
      paid_installments: p.paidInstallments, remaining_balance: p.remainingBalance, rate_ea: p.rateEa ?? null,
      household_id: me.household_id, owner_user_id: me.user_id, ...(asOf ? { as_of: asOf } : {}),
    })));
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setNotice(`Agregué ${fresh.length} compra${fresh.length === 1 ? "" : "s"} a cuotas a la proyección de la tarjeta.`);
    setRead({ ...read!, purchases: [] });
    void reload();
  }

  /** Pone en la app el total de cuotas que dice el extracto, en una sola compra. */
  async function fixInstallments(fix: InstallmentFix) {
    setFixing(true);
    setErr(null);
    setNotice(null);
    const { error } = await supabase.rpc("save_transaction", { p: editPayload(fix.tx, { installments: fix.to }) });
    setFixing(false);
    if (error) return setErr(errMsg(error));
    setNotice(`Puse ${fix.to} cuotas en ${(fix.tx.merchant || fix.tx.description || "la compra").slice(0, 40)} (antes ${fix.from}).`);
    void reload();
  }

  if (rows) {
    const reading = { text: "Leyendo el extracto…", tone: "busy" as RowTone };
    const failed = !read && err ? { text: "No pude leerlo (toca para ver por qué)", tone: "warn" as RowTone } : null;
    const needs = checks.filter((c) => c.verdict !== "OK").length;
    const debtRow = busy && !read ? reading : failed ?? debtResult ?? { text: idleNote ?? "Sube el extracto o escribe los valores a mano", tone: "idle" as RowTone };
    const instRow = busy && !read ? reading : failed
      ?? (!read ? { text: idleNote ?? "Sube el extracto para comparar las compras a cuotas", tone: "idle" as RowTone }
        : noPurchasesRead ? { text: "No pude leer las compras a cuotas (toca para volver a leer)", tone: "warn" as RowTone }
        : needs === 0 ? { text: `Las ${checks.length} compra${checks.length === 1 ? "" : "s"} a cuotas cuadran`, tone: "ok" as RowTone }
        : { text: `${needs} por revisar · ${checks.length - needs} cuadra${checks.length - needs === 1 ? "" : "n"}`, tone: "warn" as RowTone });
    const retry = (
      <Button size="sm" variant="outline" disabled={busy || !lastFile.current} onClick={() => void pick(lastFile.current ?? undefined, true)}>Volver a leer el extracto</Button>
    );
    return (
      <>
        <ReviewRow order={1} title="Deuda" status={debtRow.text} tone={debtRow.tone}>
          {err && !read && <><p className="text-danger">{err}</p>{retry}</>}
          {read ? (
            <>
              <p className="text-muted">Esto es lo que leí del extracto; puedes corregirlo. No se guarda.</p>
              <StatementFields value={draft} onChange={setDraft} />
              <StatementCrossCheck account={account} draft={draft} />
            </>
          ) : !err && month ? <ManualCrossCheck account={account} month={month} /> : null}
        </ReviewRow>
        <ReviewRow order={3} title="Cuotas" status={instRow.text} tone={instRow.tone}>
          {err && !read && <><p className="text-danger">{err}</p>{retry}</>}
          {notice && <p className="text-olive">{notice}</p>}
          {err && read && <p className="text-danger">{err}</p>}
          {noPurchasesRead && (
            <div className="space-y-1.5 rounded-xl bg-warning-soft px-3 py-2">
              <p className="font-medium">No pude leer ninguna compra a cuotas de este extracto.</p>
              <p className="text-muted">
                {read?.rawPurchases ? `La IA devolvió ${read.rawPurchases} fila${read.rawPurchases === 1 ? "" : "s"}, pero ninguna pasó la validación.` : "La IA no devolvió ninguna compra."}
                {" "}Es un fallo de la lectura, no que falten en el extracto, así que no comparo las cuotas. Vuelve a leerlo.
              </p>
              {retry}
            </div>
          )}
          {checks.length > 0 && (
            <InstallmentChecks account={account} checks={checks} fixing={fixing} onFix={(f) => void fixInstallments(f)}
              onLink={(index, txId) => setLinks((l) => ({ ...l, [index]: txId }))}
              onUnlink={(index) => setLinks((l) => Object.fromEntries(Object.entries(l).filter(([k]) => Number(k) !== index)))}
              onSeparate={(index, txId) => setApart((a) => [...a, `${index}|${txId}`])} />
          )}
          {fresh.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-medium">{fresh.length} compra{fresh.length === 1 ? "" : "s"} a cuotas nueva{fresh.length === 1 ? "" : "s"} del extracto</p>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {fresh.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0 truncate">{p.description} <span className="text-muted">· cuota {p.paidInstallments} de {p.installments}</span></span>
                    <span className="num shrink-0">{formatCop(p.remainingBalance)}</span>
                  </li>
                ))}
              </ul>
              <Button size="sm" onClick={() => void addPurchases()} disabled={busy}>Agregar las compras a la proyección</Button>
            </div>
          )}
        </ReviewRow>
      </>
    );
  }

  return (
    <div className={cn("space-y-2", !crossCheck && "rounded-2xl border border-dashed border-border p-3")}>
      <label className={cn("flex cursor-pointer items-center gap-2 text-sm font-medium",
        crossCheck ? "w-full justify-center rounded-full border border-border px-4 py-2 hover:bg-surface-2" : "text-olive",
        busy && "pointer-events-none opacity-60")}>
        <FileUp size={crossCheck ? 16 : 18} />
        {busy ? "Leyendo el extracto…" : crossCheck ? "Subir PDF o foto del extracto" : "Cargar el PDF o foto del extracto de la tarjeta"}
        <input type="file" accept="application/pdf,image/*" className="hidden" disabled={busy}
          onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {!read && !err && !notice && <p className="text-xs text-muted">{crossCheck
        ? "La IA lo lee y lo cruza con la app. Nada del extracto se guarda."
        : "La IA lee cada compra a cuotas del extracto para agregarla a la proyección. El archivo no se guarda."}</p>}
      {read && (
        <div className="space-y-3 text-xs">
          {crossCheck && (
            <>
              <p className="font-medium">Lo que leí (puedes corregirlo; no se guarda):</p>
              <StatementFields value={draft} onChange={setDraft} />
              <StatementCrossCheck account={account} draft={draft} />
              {noPurchasesRead && (
                <div className="space-y-1.5 rounded-xl bg-warning-soft px-3 py-2">
                  <p className="font-medium">No pude leer ninguna compra a cuotas de este extracto.</p>
                  <p className="text-muted">
                    {read.rawPurchases ? `La IA devolvió ${read.rawPurchases} fila${read.rawPurchases === 1 ? "" : "s"}, pero ninguna pasó la validación.` : "La IA no devolvió ninguna compra."}
                    {" "}Es un fallo de la lectura, no que falten en el extracto, así que no comparo las cuotas (saldrían todas como “solo en la app”). Vuelve a leerlo.
                  </p>
                  <Button size="sm" variant="outline" disabled={busy || !lastFile.current} onClick={() => void pick(lastFile.current ?? undefined, true)}>Volver a leer el extracto</Button>
                </div>
              )}
              {checks.length > 0 && (
                <InstallmentChecks account={account} checks={checks} fixing={fixing} onFix={(f) => void fixInstallments(f)}
                  onLink={(index, txId) => setLinks((l) => ({ ...l, [index]: txId }))}
                  onUnlink={(index) => setLinks((l) => Object.fromEntries(Object.entries(l).filter(([k]) => Number(k) !== index)))}
                  onSeparate={(index, txId) => setApart((a) => [...a, `${index}|${txId}`])} />
              )}
            </>
          )}
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
            {fresh.length > 0 && <Button size="sm" onClick={() => void addPurchases()} disabled={busy}>Agregar las compras a la proyección</Button>}
            <Button size="sm" variant="ghost" onClick={() => setRead(null)} disabled={busy}>Cerrar</Button>
          </div>
        </div>
      )}
      {notice && <p className="text-xs text-olive">{notice}</p>}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}
