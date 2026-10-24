"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, ChevronRight, Download, LogOut, RefreshCw, Share2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { MemberBadge } from "@/components/MemberBadge";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { getInstallPrompt, isStandalone, subscribeInstallPrompt } from "@/lib/pwa";
import { cn, errMsg } from "@/lib/utils";

const COLORS = ["#6b7a3a", "#a0703f", "#8c5a46", "#4f6d6a", "#7b5c8a", "#b5654a", "#5a6f8f", "#9a8a3c"];
type Theme = "system" | "light" | "dark";

export default function AjustesPage() {
  const { me, partner, household, settings, supabase, reload } = useFinance();
  const router = useRouter();

  const [name, setName] = useState(me.display_name);
  const [color, setColor] = useState(me.color);
  const [avatar, setAvatar] = useState(me.avatar ?? "");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const [cycle, setCycle] = useState(settings.cycle);
  const [monthlyDay, setMonthlyDay] = useState(String(settings.monthlyStartDay));
  const [firstDay, setFirstDay] = useState(String(settings.biweeklyFirstDay));
  const [secondDay, setSecondDay] = useState(String(settings.biweeklySecondDay));
  const [periodMsg, setPeriodMsg] = useState<string | null>(null);

  const [theme, setTheme] = useState<Theme>("system");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try { setTheme((localStorage.getItem("theme") as Theme) || "system"); } catch {}
  }, []);

  function applyTheme(t: Theme) {
    setTheme(t);
    try { localStorage.setItem("theme", t); } catch {}
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }

  async function saveProfile() {
    setError(null);
    setProfileMsg(null);
    if (!name.trim()) return setError("Escribe tu nombre.");
    const { error } = await supabase.rpc("update_my_profile", { p_display_name: name, p_color: color, p_avatar: avatar });
    if (error) return setError(errMsg(error));
    setProfileMsg("Guardado");
    void reload();
  }

  async function savePeriods() {
    setError(null);
    setPeriodMsg(null);
    const clamp = (v: string, min: number) => Math.min(28, Math.max(min, Number(v) || min));
    const a = clamp(firstDay, 1);
    const b = clamp(secondDay, 2);
    if (cycle === "BIWEEKLY" && a >= b) return setError("El segundo corte debe ser después del primero.");
    const { error } = await supabase.from("period_settings").update({
      cycle, monthly_start_day: clamp(monthlyDay, 1), biweekly_first_day: a, biweekly_second_day: b,
    }).eq("household_id", household.id);
    if (error) return setError(errMsg(error));
    setPeriodMsg("Guardado");
    void reload();
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
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <h1 className="py-2 font-display text-3xl">Ajustes</h1>
      <ErrorText>{error}</ErrorText>

      <SectionTitle>Mi perfil</SectionTitle>
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <MemberBadge member={{ ...me, display_name: name || me.display_name, color, avatar: avatar || null }} size={52} />
          <div className="flex-1">
            <Field label="Nombre visible" htmlFor="name"><Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
          </div>
        </div>
        <Field label="Color">
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={color === c}
                className={cn("h-9 w-9 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-text")} style={{ background: c }} />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Otro color" className="h-9 w-9 cursor-pointer rounded-full border border-border bg-transparent" />
          </div>
        </Field>
        <Field label="Avatar (un emoji, opcional)" htmlFor="avatar">
          <Input id="avatar" value={avatar} onChange={(e) => setAvatar(e.target.value)} maxLength={4} placeholder="🌿" className="w-24 text-center text-xl" />
        </Field>
        <div className="flex items-center gap-3">
          <Button onClick={saveProfile}>Guardar perfil</Button>
          {profileMsg && <span className="text-sm text-olive">{profileMsg}</span>}
        </div>
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
        <Link href="/cruce" className="flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-3 text-sm font-medium">
          <span className="flex items-center gap-2"><ArrowRightLeft size={16} /> Cruce de cuentas y préstamos</span>
          <ChevronRight size={16} />
        </Link>
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
        <div className="flex items-center gap-3">
          <Button onClick={savePeriods}>Guardar periodos</Button>
          {periodMsg && <span className="text-sm text-olive">{periodMsg}</span>}
        </div>
      </Card>

      <SectionTitle>Apariencia</SectionTitle>
      <Segmented value={theme} onChange={applyTheme} options={[
        { value: "system", label: "Automático" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" },
      ]} />

      <InstallCard />

      <Button variant="ghost" className="mt-8 w-full text-muted" onClick={logout}><LogOut size={18} /> Cerrar sesión</Button>
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
