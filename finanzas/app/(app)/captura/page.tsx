"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, Copy, KeyRound, Mail, MessageSquareText, Pencil, Plus, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MemorySheet, memoryTitle } from "@/components/MemorySheet";
import { groupMemory, type MemoryGroup } from "@/lib/finance/memoryApply";
import type { IngestLog, MerchantMemory } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/types";
import { categoryLabel } from "@/lib/finance/labels";
import { appsScript, authHeader, notificationBody, smsBody } from "@/lib/ingest/templates";
import { findAmount } from "@/lib/ingest/normalize";
import { cn, errMsg } from "@/lib/utils";

/** Avisos que no llegaron a ser un movimiento: los cuenta el Cierre del mes y los lista esta pantalla. */
const FAILED_RESULTS = ["UNRECOGNIZED", "ERROR", "DISCARDED"];

const RESULT_LABEL: Record<IngestLog["result"], { text: string; className: string }> = {
  ACCEPTED: { text: "Registrado", className: "bg-olive-soft text-text" },
  MERGED: { text: "Fusionado", className: "bg-wood-soft text-text" },
  IGNORED: { text: "Ignorado", className: "bg-surface-2 text-muted" },
  DISCARDED: { text: "Descartado", className: "bg-surface-2 text-muted" },
  UNRECOGNIZED: { text: "No reconocido", className: "bg-warning-soft text-text" },
  ERROR: { text: "Error", className: "bg-danger-soft text-danger" },
};

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="outline" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {}
    }}>
      {done ? <Check size={15} /> : <Copy size={15} />} {done ? "Copiado" : label}
    </Button>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">{children}</pre>;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-olive text-xs font-bold text-on-olive">{n}</span>
      <div className="min-w-0 flex-1 text-[15px]">{children}</div>
    </li>
  );
}

export default function CapturaPage() {
  const { supabase, me, categories, memberById, reload } = useFinance();
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState<{ token_hint: string; created_at: string; last_used_at: string | null } | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [logs, setLogs] = useState<IngestLog[]>([]);
  const [memory, setMemory] = useState<MerchantMemory[]>([]);
  const [open, setOpen] = useState<string | null>("android");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<IngestLog[]>([]);
  const [editingMemory, setEditingMemory] = useState<MemoryGroup | null>(null);
  const [retrying, setRetrying] = useState<{ done: number; total: number } | null>(null);
  const [retrySummary, setRetrySummary] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  const webhook = `${origin}/api/webhook/android-ingest`;

  const load = useCallback(async () => {
    const [t, l, m, f] = await Promise.all([
      supabase.from("ingest_tokens").select("token_hint, created_at, last_used_at").eq("user_id", me.user_id).maybeSingle(),
      supabase.from("ingest_logs").select("id, channel, source, raw_text, parser, result, reason, transaction_id, received_at")
        .eq("user_id", me.user_id).order("received_at", { ascending: false }).limit(40),
      supabase.from("merchant_memory").select("id, identifier_type, identifier, category_id, responsible_user_id, tag, auto_apply, hits, label, scope, creates_debt, movement_kind")
        .eq("user_id", me.user_id).order("hits", { ascending: false }),
      // Todos los avisos que no se pudieron leer (no solo los más recientes): los mismos que cuenta el Cierre del mes
      supabase.from("ingest_logs").select("id, channel, source, raw_text, parser, result, reason, transaction_id, received_at").eq("user_id", me.user_id)
        .in("result", FAILED_RESULTS).order("received_at", { ascending: false }).limit(300),
    ]);
    if (t.error || l.error || m.error) setError(errMsg(t.error || l.error || m.error));
    setToken(t.data ?? null);
    setLogs((l.data ?? []) as IngestLog[]);
    setMemory((m.data ?? []) as MerchantMemory[]);
    setFailed((f.data ?? []) as IngestLog[]);
  }, [supabase, me.user_id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (window.location.hash === "#sin-reconocer" && failed.length > 0) document.getElementById("sin-reconocer")?.scrollIntoView({ behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed.length > 0]);

  async function generate() {
    if (token && !confirm("El token anterior deja de funcionar y tendrás que pegar el nuevo en MacroDroid y en el Apps Script. ¿Continuar?")) return;
    const { data, error } = await supabase.rpc("create_ingest_token");
    if (error) return setError(errMsg(error));
    setNewToken(data as string);
    void load();
  }

  /** Un solo botón: vuelve a leer, uno por uno, todos los avisos que no se pudieron reconocer. */
  async function retryAll() {
    const ids = failed.filter((l) => l.raw_text).map((l) => l.id);
    if (ids.length === 0 || retrying) return;
    setRetrySummary(null);
    setRetrying({ done: 0, total: ids.length });
    const tally = { ACCEPTED: 0, MERGED: 0, IGNORED: 0, DUPLICATE: 0, stillFailed: 0, errors: 0 };
    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await fetch("/api/ingest/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ log_id: ids[i] }) });
        const data = (await res.json()) as { ok: boolean; result?: string };
        if (!data.ok) tally.errors++;
        else if (data.result === "ACCEPTED") tally.ACCEPTED++;
        else if (data.result === "MERGED") tally.MERGED++;
        else if (data.result === "IGNORED") tally.IGNORED++;
        else if (data.result === "DUPLICATE") tally.DUPLICATE++;
        else tally.stillFailed++;
      } catch {
        tally.errors++;
      }
      setRetrying({ done: i + 1, total: ids.length });
    }
    setRetrying(null);
    const parts = [
      tally.ACCEPTED && `${tally.ACCEPTED} quedaron en Por revisar`,
      tally.MERGED && `${tally.MERGED} se unieron con movimientos que ya estaban`,
      tally.IGNORED && `${tally.IGNORED} no eran movimientos`,
      tally.DUPLICATE && `${tally.DUPLICATE} ya estaban procesados`,
      tally.stillFailed && `${tally.stillFailed} siguen sin reconocerse (regístralos a mano abajo)`,
      tally.errors && `${tally.errors} fallaron por conexión: vuelve a intentar`,
    ].filter(Boolean);
    setRetrySummary(parts.length ? `Listo: ${parts.join("; ")}.` : "No había nada que reintentar.");
    await load();
    void reload();
  }

  async function toggleAuto(g: MemoryGroup, v: boolean) {
    const { error } = await supabase.from("merchant_memory").update({ auto_apply: v }).in("id", g.all.map((m) => m.id));
    if (error) setError(errMsg(error)); else void load();
  }

  async function forget(g: MemoryGroup) {
    if (!confirm(`¿Olvidar “${g.main.identifier}”?`)) return;
    const { error } = await supabase.from("merchant_memory").delete().in("id", g.all.map((m) => m.id));
    if (error) setError(errMsg(error)); else void load();
  }

  const section = (id: string, icon: React.ReactNode, title: string, children: React.ReactNode) => (
    <Card className="p-0">
      <button className="flex w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
        <span className="flex items-center gap-2 font-semibold">{icon}{title}</span>
        <ChevronDown size={18} className={cn("text-muted transition-transform", open === id && "rotate-180")} />
      </button>
      {open === id && <div className="space-y-4 border-t border-border p-4">{children}</div>}
    </Card>
  );

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2 py-2">
        <Link href="/mas" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
        <h1 className="font-display text-3xl">Captura automática</h1>
      </div>
      <p className="px-1 text-sm text-muted">
        Tus notificaciones, SMS y correos bancarios llegan solos a la app. Lo que no se pueda conciliar queda en “Por revisar” en el inicio.
      </p>
      <ErrorText>{error}</ErrorText>

      <SectionTitle>1 · Tu token</SectionTitle>
      <Card className="space-y-3">
        {newToken ? (
          <>
            <p className="text-sm font-semibold text-warning">Cópialo ahora: no se vuelve a mostrar.</p>
            <Code>{newToken}</Code>
            <CopyButton text={newToken} label="Copiar token" />
          </>
        ) : token ? (
          <p className="text-sm">
            Token activo terminado en <strong>…{token.token_hint}</strong>.{" "}
            {token.last_used_at ? `Último uso: ${new Date(token.last_used_at).toLocaleString("es-CO")}.` : "Aún no se ha usado."}
          </p>
        ) : (
          <p className="text-sm">Genera tu token personal. Es la llave con la que MacroDroid y Gmail envían tus movimientos.</p>
        )}
        {token && !newToken && !token.last_used_at && (
          <p className="rounded-2xl bg-warning-soft px-3 py-2 text-sm">Tu token todavía no ha recibido nada: falta conectar MacroDroid o el Apps Script de Gmail (paso 2).</p>
        )}
        <Button variant={token ? "outline" : "primary"} onClick={generate}><KeyRound size={16} /> {token ? "Generar uno nuevo" : "Generar token"}</Button>
        <div>
          <p className="mb-1 text-sm text-muted">Dirección (URL) del webhook:</p>
          <Code>{webhook}</Code>
          <div className="mt-2"><CopyButton text={webhook} label="Copiar URL" /></div>
        </div>
      </Card>

      <SectionTitle>2 · Conectar</SectionTitle>
      <p className="mb-2 px-1 text-xs text-muted">
        Cada persona lo hace una vez, con su propio token y en su propio celular o Gmail. Al generar el token, los botones de copiar ya lo incluyen; si sales de esta pantalla no se vuelve a mostrar y tendrás que generar uno nuevo.
      </p>
      <div className="space-y-3">
        {section("android", <Smartphone size={18} />, "Notificaciones de Android (MacroDroid)", (
          <ol className="space-y-3">
            <Step n={1}>Instala <strong>MacroDroid</strong> desde Play Store (gratis, hasta 5 macros; usaremos 2).</Step>
            <Step n={2}>Crea una macro → <strong>Disparador</strong>: Dispositivo/Aplicaciones → <strong>Notificación recibida</strong>. Elige las apps: Nequi, Bancolombia, BBVA, Banco de Bogotá y Google Wallet (Billetera de Google). Concede el acceso a notificaciones cuando lo pida.</Step>
            <Step n={3}><strong>Acción</strong>: Conectividad → <strong>Solicitud HTTP</strong>. Método <strong>POST</strong>, URL la del paso 1.</Step>
            <Step n={4}>En <strong>Encabezados</strong> agrega <code>Authorization</code> con el valor <code>Bearer TU_TOKEN</code> (la palabra Bearer, un espacio y tu token).
              {newToken && <div className="mt-2"><CopyButton text={authHeader(newToken)} label="Copiar el valor con tu token" /></div>}
            </Step>
            <Step n={5}>
              En <strong>Cuerpo</strong>, tipo <strong>application/json</strong>, pega esto. Si MacroDroid te muestra los campos con otro nombre, elígelos con el botón de “texto mágico”: nombre de la app, título y texto de la notificación.
              <div className="mt-2 space-y-2"><Code>{notificationBody()}</Code><CopyButton text={notificationBody()} /></div>
            </Step>
            <Step n={6}>Guarda la macro, ponle de nombre “Finanzas notificaciones” y desactiva la optimización de batería para MacroDroid en Ajustes de Android.</Step>
          </ol>
        ))}
        {section("sms", <MessageSquareText size={18} />, "SMS bancarios (MacroDroid)", (
          <ol className="space-y-3">
            <Step n={1}>Crea otra macro → <strong>Disparador</strong>: Llamadas/SMS → <strong>SMS recibido</strong>. Puedes limitarlo a los números de tus bancos.</Step>
            <Step n={2}><strong>Acción</strong>: <strong>Solicitud HTTP</strong> igual que antes (POST, misma URL y mismo encabezado Authorization).</Step>
            <Step n={3}>
              Cuerpo (application/json):
              <div className="mt-2 space-y-2"><Code>{smsBody()}</Code><CopyButton text={smsBody()} /></div>
            </Step>
          </ol>
        ))}
        {section("gmail", <Mail size={18} />, "Correos bancarios (Gmail + Apps Script)", (
          <ol className="space-y-3">
            <Step n={1}>En Gmail (en computador): busca un correo de alerta de tu banco → menú ⋮ → <strong>Filtrar mensajes similares</strong> → <strong>Crear filtro</strong> → <strong>Aplicar la etiqueta</strong> nueva <code>Finanzas/Bancos</code>. Repite por cada banco.</Step>
            <Step n={2}>Entra a <strong>script.google.com</strong> → Proyecto nuevo. Borra lo que hay y pega este código.{" "}
              {newToken ? "Ya trae tu token puesto." : <>Reemplaza <code>PEGA_AQUI_TU_TOKEN</code> por tu token (o genera uno nuevo arriba y se copia ya con el token).</>}
              <div className="mt-2 space-y-2"><Code>{appsScript(webhook, newToken ?? undefined)}</Code><CopyButton text={appsScript(webhook, newToken ?? undefined)} label={newToken ? "Copiar código con mi token" : "Copiar código"} /></div>
            </Step>
            <Step n={3}>Arriba elige la función <strong>instalar</strong> → <strong>Ejecutar</strong> → acepta los permisos (Google avisa que la app no está verificada porque es tuya: Configuración avanzada → Ir al proyecto).</Step>
            <Step n={4}>Listo: cada 5 minutos revisa la etiqueta y marca con <code>Finanzas/Procesado</code> lo que ya envió, así nada llega dos veces.</Step>
          </ol>
        ))}
      </div>

      <section id="sin-reconocer" className="scroll-mt-4">
        <SectionTitle>Avisos sin reconocer{failed.length > 0 ? ` (${failed.length})` : ""}</SectionTitle>
        {failed.length === 0 && !retrySummary ? (
          <p className="px-1 text-sm text-muted">No hay avisos pendientes. Todo lo que llegó se reconoció o se ignoró.</p>
        ) : (
          <>
            <Card className="mb-3 space-y-2">
              {failed.length > 0 && (
                <>
                  <p className="text-sm">
                    Se vuelven a leer con las reglas actuales (y Gemini si hace falta). Los que sigan sin reconocerse se registran a mano.
                    {failed.some((l) => !l.raw_text) ? ` ${failed.filter((l) => !l.raw_text).length} ya no tienen su texto (pasaron 30 días) y solo se pueden registrar a mano.` : ""}
                  </p>
                  <Button className="w-full" onClick={retryAll} disabled={!!retrying || !failed.some((l) => l.raw_text)}>
                    <RefreshCw size={16} className={retrying ? "animate-spin" : ""} />
                    {retrying ? `Reintentando ${retrying.done} de ${retrying.total}…` : `Reintentar los ${failed.filter((l) => l.raw_text).length} pendientes`}
                  </Button>
                </>
              )}
              {retrySummary && <p className="text-sm text-olive">{retrySummary}</p>}
            </Card>
            {failed.length > 0 && (
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {failed.map((l) => <LogRow key={l.id} log={l} />)}
              </div>
            )}
          </>
        )}
      </section>

      <SectionTitle>Últimos eventos</SectionTitle>
      {logs.filter((l) => !FAILED_RESULTS.includes(l.result)).length === 0 ? (
        <p className="px-1 text-sm text-muted">Aún no ha llegado nada reconocido. Cuando conectes MacroDroid o Gmail verás aquí cada aviso y qué se hizo con él.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {logs.filter((l) => !FAILED_RESULTS.includes(l.result)).map((l) => <LogRow key={l.id} log={l} />)}
        </div>
      )}

      <SectionTitle>Memoria de comercios</SectionTitle>
      {memory.length === 0 ? (
        <p className="px-1 text-sm text-muted">Cuando revises un movimiento con “Recordar este comercio”, aparecerá aquí.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {groupMemory(memory).map((g) => {
            const m = g.main;
            const cat = categoryLabel(categories, m.category_id);
            const resp = memberById(m.responsible_user_id);
            return (
              <div key={m.id} className="flex items-center gap-3 px-3.5 py-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setEditingMemory(g)} aria-label={`Editar ${memoryTitle(m)}`}>
                  <p className="flex items-center gap-1.5 truncate font-medium">{memoryTitle(m)} <Pencil size={12} className="shrink-0 text-muted" /></p>
                  <p className="truncate text-xs text-muted">
                    {m.movement_kind === "REFUND" ? "Reembolso de " : ""}{cat.icon} {cat.name} · {resp ? (resp.user_id === me.user_id ? "tú" : resp.display_name) : ""} · {m.scope === "HOUSEHOLD" ? "hogar" : "personal"} · {g.hits} uso{g.hits === 1 ? "" : "s"}
                    {m.label ? ` · ${m.identifier}` : ""}
                  </p>
                </button>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  Siempre <Switch checked={m.auto_apply} onCheckedChange={(v) => toggleAuto(g, v)} aria-label="Aplicar siempre" />
                </label>
                <button className="p-1 text-muted" onClick={() => forget(g)} aria-label="Olvidar"><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 px-1 text-xs text-muted">Toca un nombre para cambiar dónde se guarda. El texto original de cada aviso se borra solo a los 30 días.</p>
      <MemorySheet group={editingMemory} onClose={() => setEditingMemory(null)} onChanged={load} />
    </main>
  );
}

function LogRow({ log }: { log: IngestLog }) {
  const { openPayment } = useShell();
  const [show, setShow] = useState(FAILED_RESULTS.includes(log.result));
  const r = RESULT_LABEL[log.result];
  const failed = log.result === "UNRECOGNIZED" || log.result === "ERROR" || log.result === "DISCARDED";

  function manual() {
    const text = (log.raw_text ?? "").replace(/\s+/g, " ");
    const day = new Date(Date.parse(log.received_at) - 5 * 3_600_000).toISOString().slice(0, 10);
    openPayment({
      amount: findAmount(text) ?? undefined,
      description: text.replace(/^.*?(?:bancolombia|nequi|bbva)\s*:\s*/i, "").slice(0, 60),
      date: day,
      logId: log.id,
    });
  }

  return (
    <div className="px-3.5 py-3">
      <button className="flex w-full items-center gap-3 text-left" onClick={() => setShow(!show)}>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", r.className)}>{r.text}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{log.source || CHANNEL_LABEL[log.channel] || log.channel}</span>
        <span className="shrink-0 text-xs text-muted">{new Date(log.received_at).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
      </button>
      {show && (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-muted">{CHANNEL_LABEL[log.channel] ?? log.channel}{log.parser ? ` · leído con ${log.parser === "gemini" ? "Gemini" : log.parser}` : ""}{log.reason ? ` · ${log.reason}` : ""}</p>
          {log.raw_text ? <Code>{log.raw_text}</Code> : <p className="text-xs text-muted">Texto original ya borrado.</p>}
          {failed && (
            <Button size="sm" variant="outline" className="w-full" onClick={manual}><Plus size={15} /> Registrar a mano</Button>
          )}
        </div>
      )}
    </div>
  );
}
