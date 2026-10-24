"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, Copy, KeyRound, Mail, MessageSquareText, Plus, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { IngestLog, MerchantMemory } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/types";
import { categoryLabel } from "@/lib/finance/labels";
import { appsScript, notificationBody, smsBody } from "@/lib/ingest/templates";
import { findAmount } from "@/lib/ingest/normalize";
import { cn, errMsg } from "@/lib/utils";

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
  const { supabase, me, categories, memberById } = useFinance();
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState<{ token_hint: string; created_at: string; last_used_at: string | null } | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [logs, setLogs] = useState<IngestLog[]>([]);
  const [memory, setMemory] = useState<MerchantMemory[]>([]);
  const [open, setOpen] = useState<string | null>("android");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  const webhook = `${origin}/api/webhook/android-ingest`;

  const load = useCallback(async () => {
    const [t, l, m] = await Promise.all([
      supabase.from("ingest_tokens").select("token_hint, created_at, last_used_at").eq("user_id", me.user_id).maybeSingle(),
      supabase.from("ingest_logs").select("id, channel, source, raw_text, parser, result, reason, transaction_id, received_at")
        .eq("user_id", me.user_id).order("received_at", { ascending: false }).limit(40),
      supabase.from("merchant_memory").select("id, identifier_type, identifier, category_id, responsible_user_id, tag, auto_apply, hits")
        .eq("user_id", me.user_id).order("hits", { ascending: false }),
    ]);
    if (t.error || l.error || m.error) setError(errMsg(t.error || l.error || m.error));
    setToken(t.data ?? null);
    setLogs((l.data ?? []) as IngestLog[]);
    setMemory((m.data ?? []) as MerchantMemory[]);
  }, [supabase, me.user_id]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    if (token && !confirm("El token anterior deja de funcionar y tendrás que pegar el nuevo en MacroDroid y en el Apps Script. ¿Continuar?")) return;
    const { data, error } = await supabase.rpc("create_ingest_token");
    if (error) return setError(errMsg(error));
    setNewToken(data as string);
    void load();
  }

  async function toggleAuto(m: MerchantMemory, v: boolean) {
    const { error } = await supabase.from("merchant_memory").update({ auto_apply: v }).eq("id", m.id);
    if (error) setError(errMsg(error)); else void load();
  }

  async function forget(m: MerchantMemory) {
    if (!confirm(`¿Olvidar “${m.identifier}”?`)) return;
    const { error } = await supabase.from("merchant_memory").delete().eq("id", m.id);
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
        <Link href="/ajustes" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
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
        <Button variant={token ? "outline" : "primary"} onClick={generate}><KeyRound size={16} /> {token ? "Generar uno nuevo" : "Generar token"}</Button>
        <div>
          <p className="mb-1 text-sm text-muted">Dirección (URL) del webhook:</p>
          <Code>{webhook}</Code>
          <div className="mt-2"><CopyButton text={webhook} label="Copiar URL" /></div>
        </div>
      </Card>

      <SectionTitle>2 · Conectar</SectionTitle>
      <div className="space-y-3">
        {section("android", <Smartphone size={18} />, "Notificaciones de Android (MacroDroid)", (
          <ol className="space-y-3">
            <Step n={1}>Instala <strong>MacroDroid</strong> desde Play Store (gratis, hasta 5 macros; usaremos 2).</Step>
            <Step n={2}>Crea una macro → <strong>Disparador</strong>: Dispositivo/Aplicaciones → <strong>Notificación recibida</strong>. Elige las apps: Nequi, Bancolombia, Banco de Bogotá y Google Wallet. Concede el acceso a notificaciones cuando lo pida.</Step>
            <Step n={3}><strong>Acción</strong>: Conectividad → <strong>Solicitud HTTP</strong>. Método <strong>POST</strong>, URL la del paso 1.</Step>
            <Step n={4}>En <strong>Encabezados</strong> agrega <code>Authorization</code> con el valor <code>Bearer TU_TOKEN</code> (la palabra Bearer, un espacio y tu token).</Step>
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
            <Step n={2}>Entra a <strong>script.google.com</strong> → Proyecto nuevo. Borra lo que hay y pega este código. Reemplaza <code>PEGA_AQUI_TU_TOKEN</code> por tu token.
              <div className="mt-2 space-y-2"><Code>{appsScript(webhook)}</Code><CopyButton text={appsScript(webhook)} label="Copiar código" /></div>
            </Step>
            <Step n={3}>Arriba elige la función <strong>instalar</strong> → <strong>Ejecutar</strong> → acepta los permisos (Google avisa que la app no está verificada porque es tuya: Configuración avanzada → Ir al proyecto).</Step>
            <Step n={4}>Listo: cada 5 minutos revisa la etiqueta y marca con <code>Finanzas/Procesado</code> lo que ya envió, así nada llega dos veces.</Step>
          </ol>
        ))}
      </div>

      <SectionTitle>Últimos eventos</SectionTitle>
      {logs.length === 0 ? (
        <p className="px-1 text-sm text-muted">Aún no ha llegado nada. Cuando conectes MacroDroid o Gmail verás aquí cada aviso y qué se hizo con él.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {logs.map((l) => <LogRow key={l.id} log={l} onChanged={load} />)}
        </div>
      )}

      <SectionTitle>Memoria de comercios</SectionTitle>
      {memory.length === 0 ? (
        <p className="px-1 text-sm text-muted">Cuando revises un movimiento con “Recordar este comercio”, aparecerá aquí.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {memory.map((m) => {
            const cat = categoryLabel(categories, m.category_id);
            const resp = memberById(m.responsible_user_id);
            return (
              <div key={m.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.identifier}</p>
                  <p className="truncate text-xs text-muted">{cat.icon} {cat.name} · {resp ? (resp.user_id === me.user_id ? "tú" : resp.display_name) : ""} · {m.hits} uso{m.hits === 1 ? "" : "s"}</p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  Siempre <Switch checked={m.auto_apply} onCheckedChange={(v) => toggleAuto(m, v)} aria-label="Aplicar siempre" />
                </label>
                <button className="p-1 text-muted" onClick={() => forget(m)} aria-label="Olvidar"><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 px-1 text-xs text-muted">El texto original de cada aviso se borra solo a los 30 días.</p>
    </main>
  );
}

function LogRow({ log, onChanged }: { log: IngestLog; onChanged: () => void }) {
  const { openPayment } = useShell();
  const { reload } = useFinance();
  const [show, setShow] = useState(log.result === "UNRECOGNIZED" || log.result === "ERROR");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const r = RESULT_LABEL[log.result];
  const failed = log.result === "UNRECOGNIZED" || log.result === "ERROR" || log.result === "DISCARDED";

  async function retry() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ingest/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ log_id: log.id }) });
      const data = (await res.json()) as { ok: boolean; error?: string; result?: string; reason?: string | null };
      if (!data.ok) setMsg(data.error ?? "No se pudo reintentar");
      else if (data.result === "ACCEPTED") setMsg("Listo: quedó en Por revisar.");
      else if (data.result === "MERGED") setMsg("Ya estaba registrado; se unió con ese movimiento.");
      else if (data.result === "IGNORED") setMsg("No es un movimiento; se ignoró.");
      else setMsg(data.reason ?? "Sigue sin reconocerse. Regístralo a mano.");
      onChanged();
      void reload();
    } catch {
      setMsg("Sin conexión. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

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
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={retry} disabled={busy || !log.raw_text}>
                <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Reintentar
              </Button>
              <Button size="sm" className="flex-1" onClick={manual}><Plus size={15} /> Registrar</Button>
            </div>
          )}
          {msg && <p className="text-xs">{msg}</p>}
        </div>
      )}
    </div>
  );
}
