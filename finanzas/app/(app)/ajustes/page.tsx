"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, BellOff, Download, LogOut, RefreshCw, Share2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { MemberBadge } from "@/components/MemberBadge";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { getInstallPrompt, isStandalone, subscribeInstallPrompt } from "@/lib/pwa";
import { cn, errMsg } from "@/lib/utils";
import { applyAccent } from "@/lib/accent";
import { clearOffline } from "@/lib/offline/store";
import { SecuritySettings } from "@/components/SecuritySettings";
import { FirstSweep } from "@/components/FirstSweep";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push/client";

const COLORS = ["#6b7a3a", "#a0703f", "#8c5a46", "#4f6d6a", "#7b5c8a", "#b5654a", "#5a6f8f", "#9a8a3c"];
type Theme = "system" | "light" | "dark";

export default function AjustesPage() {
  const { me, partner, household, settings, supabase, reload, uvt, queue } = useFinance();
  const router = useRouter();

  const [name, setName] = useState(me.display_name);
  const [color, setColor] = useState(me.color);
  const [avatar, setAvatar] = useState(me.avatar ?? "");

  const [cycle, setCycle] = useState(settings.cycle);
  const [monthlyDay, setMonthlyDay] = useState(String(settings.monthlyStartDay));
  const [firstDay, setFirstDay] = useState(String(settings.biweeklyFirstDay));
  const [secondDay, setSecondDay] = useState(String(settings.biweeklySecondDay));
  const [savedMsg, setSavedMsg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uvtText, setUvtText] = useState(String(uvt));

  const [theme, setTheme] = useState<Theme>("system");
  const [error, setError] = useState<string | null>(null);

  // Vista previa del color en toda la app mientras se elige; al salir sin guardar vuelve el guardado
  useEffect(() => { applyAccent(color, false); }, [color]);
  const savedColor = useRef(me.color);
  useEffect(() => { savedColor.current = me.color; }, [me.color]);
  useEffect(() => () => applyAccent(savedColor.current), []);

  useEffect(() => {
    try { setTheme((localStorage.getItem("theme") as Theme) || "system"); } catch {}
  }, []);

  function applyTheme(t: Theme) {
    setTheme(t);
    try { localStorage.setItem("theme", t); } catch {}
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }

  // Un solo "Guardar" para el perfil y los periodos: aparece abajo cuando hay algo cambiado
  const profileDirty = name !== me.display_name || color !== me.color || avatar !== (me.avatar ?? "");
  const periodsDirty = cycle !== settings.cycle || monthlyDay !== String(settings.monthlyStartDay)
    || firstDay !== String(settings.biweeklyFirstDay) || secondDay !== String(settings.biweeklySecondDay) || uvtText !== String(uvt);

  async function saveAll() {
    setError(null);
    setSavedMsg(false);
    if (profileDirty && !name.trim()) return setError("Escribe tu nombre.");
    const clamp = (v: string, min: number) => Math.min(28, Math.max(min, Number(v) || min));
    const a = clamp(firstDay, 1);
    const b = clamp(secondDay, 2);
    if (periodsDirty && cycle === "BIWEEKLY" && a >= b) return setError("El segundo corte debe ser después del primero.");
    setSaving(true);
    try {
      if (profileDirty) {
        const { error } = await supabase.rpc("update_my_profile", { p_display_name: name, p_color: color, p_avatar: avatar });
        if (error) throw error;
      }
      if (periodsDirty) {
        const { error } = await supabase.from("period_settings").update({
          cycle, monthly_start_day: clamp(monthlyDay, 1), biweekly_first_day: a, biweekly_second_day: b,
          uvt_value: Math.max(1, Number(uvtText.replace(/\D/g, "")) || 52374),
        }).eq("household_id", household.id);
        if (error) throw error;
      }
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
      await reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (!confirm("El código actual dejará de servir. ¿Generar uno nuevo?")) return;
    const { error } = await supabase.rpc("regenerate_invite_code");
    if (error) setError(errMsg(error));
    else void reload();
  }

  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/unirse/${household.invite_code}` : "";

  async function share() {
    const text = `Únete a nuestro hogar en Finanzas en Pareja: ${inviteUrl}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Finanzas en Pareja", text, url: inviteUrl }); } catch {}
    } else {
      await navigator.clipboard.writeText(inviteUrl);
      alert("Enlace copiado");
    }
  }

  async function logout() {
    if (queue.length > 0 && !confirm(`Hay ${queue.length === 1 ? "1 movimiento" : `${queue.length} movimientos`} guardados sin conexión que no se han enviado. Si cierras sesión se pierden. ¿Cerrar sesión igual?`)) return;
    // Este celular deja de recibir las notificaciones de esta persona
    try { await disablePush(supabase); } catch {}
    await clearOffline();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2 py-2">
        <Link href="/mas" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
        <h1 className="font-display text-3xl">Ajustes</h1>
      </div>
      <ErrorText>{error}</ErrorText>

      <SectionTitle>Mi perfil</SectionTitle>
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <MemberBadge member={{ ...me, display_name: name || me.display_name, color, avatar: avatar || null }} size={52} />
          <div className="flex-1">
            <Field label="Nombre visible" htmlFor="name"><Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
          </div>
        </div>
        <Field label="Color" hint="También es el color de la app: botones, filtros y barras que hoy se ven en verde cambian a este color.">
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={color === c}
                className={cn("h-9 w-9 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-text")} style={{ background: c }} />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Otro color" className="color-swatch h-9 w-9 cursor-pointer overflow-hidden rounded-full border border-border bg-transparent p-0" />
          </div>
        </Field>
        <Field label="Avatar (un emoji, opcional)" htmlFor="avatar">
          <Input id="avatar" value={avatar} onChange={(e) => setAvatar(e.target.value)} maxLength={4} placeholder="🌿" className="w-24 text-center text-xl" />
        </Field>
        {partner && partner.color.toLowerCase() === color.toLowerCase() && (
          <p className="text-xs text-warning">Tu pareja usa el mismo color; conviene elegir otro para diferenciarse.</p>
        )}
      </Card>

      <SectionTitle>Hogar</SectionTitle>
      <Card className="space-y-3">
        <p className="font-semibold">{household.name}</p>
        {partner ? (
          <div className="flex items-center gap-2 text-sm"><MemberBadge member={partner} size={24} /> {partner.display_name} es parte del hogar.</div>
        ) : (
          <>
            <p className="text-sm text-muted">Invita a tu pareja con este código o enlace:</p>
            <p className="num rounded-2xl bg-surface-2 py-3 text-center font-display text-3xl tracking-[0.2em]">{household.invite_code}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={share}><Share2 size={16} /> Compartir enlace</Button>
              <Button variant="outline" onClick={regenerate}><RefreshCw size={16} /> Nuevo código</Button>
            </div>
          </>
        )}
      </Card>

      <SectionTitle>Periodos</SectionTitle>
      <Card className="space-y-4">
        <Segmented value={cycle} onChange={setCycle} options={[{ value: "MONTHLY", label: "Mensual" }, { value: "BIWEEKLY", label: "Quincenal" }]} />
        {cycle === "MONTHLY" ? (
          <Field label="Día en que empieza el mes" htmlFor="md" hint="Por ejemplo 25 si les pagan ese día. Del 1 al 28.">
            <Input id="md" inputMode="numeric" value={monthlyDay} onChange={(e) => setMonthlyDay(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primer corte" htmlFor="b1"><Input id="b1" inputMode="numeric" value={firstDay} onChange={(e) => setFirstDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
            <Field label="Segundo corte" htmlFor="b2"><Input id="b2" inputMode="numeric" value={secondDay} onChange={(e) => setSecondDay(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
          </div>
        )}
        <p className="text-xs text-muted">Aplica a los dos. Los presupuestos se repiten en cada periodo.</p>
        <Field label="Valor de la UVT del año" htmlFor="uvt" hint="Se usa para el tope exento del 4x1000. 2026: $52.374 (Resolución DIAN 000238 de 2025). Actualízalo cada enero.">
          <Input id="uvt" inputMode="numeric" value={uvtText} onChange={(e) => setUvtText(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <FirstSweep disabled={periodsDirty} />
      </Card>

      <SectionTitle>Apariencia</SectionTitle>
      <Segmented value={theme} onChange={applyTheme} options={[
        { value: "system", label: "Automático" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" },
      ]} />

      <NotificationsCard />
      <SecuritySettings />

      <InstallCard />

      <Button variant="ghost" className="mt-8 w-full text-muted" onClick={logout}><LogOut size={18} /> Cerrar sesión</Button>

      {(profileDirty || periodsDirty || savedMsg) && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 border-t border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
            <p className={cn("min-w-0 flex-1 text-sm", error && "text-danger")}>{error ?? (savedMsg && !profileDirty && !periodsDirty ? "Cambios guardados" : "Tienes cambios sin guardar")}</p>
            {(profileDirty || periodsDirty) && <Button className="shrink-0" onClick={saveAll} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>}
          </div>
        </div>
      )}
    </main>
  );
}

function InstallCard() {
  const prompt = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt, () => null);
  const [standalone, setStandalone] = useState(true);
  useEffect(() => setStandalone(isStandalone()), []);
  if (standalone) return null;
  return (
    <>
      <SectionTitle>Instalar</SectionTitle>
      <Card className="space-y-3">
        <p className="text-sm">Instálala en tu Android o computador para abrirla como una app.</p>
        {prompt ? (
          <Button onClick={async () => { await prompt.prompt(); }}><Download size={16} /> Instalar app</Button>
        ) : (
          <p className="text-xs text-muted">En Chrome: menú ⋮ → “Instalar app” o “Agregar a pantalla principal”.</p>
        )}
      </Card>
    </>
  );
}

/** Activar las notificaciones en este celular, probarlas y apagarlas. */
function NotificationsCard() {
  const { supabase } = useFinance();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void pushState().then(setState); }, []);

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      setState(await pushState());
    }
  }

  async function test() {
    const res = await fetch("/api/push/test", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
    if (!body.ok) throw new Error(body.reason ?? "No se pudo enviar la prueba.");
  }

  return (
    <>
      <SectionTitle>Notificaciones</SectionTitle>
      <Card className="space-y-3">
        <p className="text-sm">
          Un aviso al día (8 a. m.) con lo que vence: pagos programados, tarjetas, cuotas de los créditos, el saldo del crédito por confirmar,
          el cierre del mes y los movimientos por revisar.
        </p>
        {state === null ? null : state === "unsupported" ? (
          <p className="text-xs text-muted">Este navegador no recibe notificaciones. Usa Chrome en Android o instala la app.</p>
        ) : state === "needs-install" ? (
          <p className="text-xs text-muted">En iPhone primero instala la app: Compartir → “Agregar a inicio”, y ábrela desde el ícono.</p>
        ) : state === "denied" ? (
          <p className="text-xs text-muted">Las notificaciones están bloqueadas para esta app. Permítelas en los ajustes del navegador (candado junto a la dirección → Notificaciones) y vuelve aquí.</p>
        ) : state === "on" ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run(test, "Prueba enviada: debería llegarte en unos segundos.")} disabled={busy}><Bell size={16} /> Enviar prueba</Button>
            <Button size="sm" variant="outline" onClick={() => run(() => disablePush(supabase), "Notificaciones apagadas en este celular.")} disabled={busy}><BellOff size={16} /> Apagar</Button>
          </div>
        ) : (
          <Button onClick={() => run(() => enablePush(supabase), "Listo: este celular recibirá los avisos.")} disabled={busy}><Bell size={16} /> Activar en este celular</Button>
        )}
        {state === "on" && <p className="text-xs text-muted">Activadas en este celular. Cada persona las activa en el suyo.</p>}
        {msg && <p className="text-xs text-olive">{msg}</p>}
        <ErrorText>{error}</ErrorText>
      </Card>
    </>
  );
}
