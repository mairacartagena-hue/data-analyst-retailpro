"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { errMsg } from "@/lib/utils";

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const nextParam = params.get("next") || "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const [mode, setMode] = useState<"password" | "link">("password");
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(params.get("error") ? "El enlace venció o ya se usó. Pide uno nuevo." : null);
  const [busy, setBusy] = useState(false);

  function enter() {
    router.replace(next);
    router.refresh();
  }

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const sb = getSupabase();
    if (creating) {
      const { data, error } = await sb.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      setBusy(false);
      if (error) return setError(errMsg(error));
      if (data.session) return enter();
      setNotice("Cuenta creada. Te enviamos un correo para confirmarla; ábrelo y luego entra aquí.");
      setCreating(false);
      setPassword("");
      return;
    }
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(errMsg(error));
    enter();
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) setError(errMsg(error));
    else setSent(true);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setError("Ese código no funcionó. Revisa el correo o pide uno nuevo.");
    else enter();
  }

  if (mode === "link" && sent) {
    return (
      <Card className="space-y-4">
        <h2 className="font-display text-2xl">Revisa tu correo</h2>
        <p className="text-[15px]">
          Te enviamos un enlace a <strong>{email}</strong>. Ábrelo en este mismo dispositivo.
        </p>
        <form onSubmit={verifyCode} className="space-y-3 border-t border-border pt-4">
          <Field label="¿El correo trae un código? Escríbelo aquí" htmlFor="code">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
              onChange={(e) => setCode(e.target.value)} placeholder="123456" className="tracking-[0.3em]" />
          </Field>
          <Button type="submit" variant="secondary" className="w-full" disabled={busy || code.length < 6}>
            Entrar con el código
          </Button>
        </form>
        <ErrorText>{error}</ErrorText>
        <button className="text-sm font-semibold text-olive underline" onClick={() => setSent(false)}>
          Usar otro correo
        </button>
      </Card>
    );
  }

  if (mode === "link") {
    return (
      <Card>
        <form onSubmit={sendLink} className="space-y-4">
          <Field label="Tu correo" htmlFor="email-link">
            <Input id="email-link" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" />
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            <Mail size={18} /> {busy ? "Enviando..." : "Enviarme un enlace para entrar"}
          </Button>
          <ErrorText>{error}</ErrorText>
          <button type="button" className="w-full text-sm font-semibold text-olive underline" onClick={() => setMode("password")}>
            Entrar con contraseña
          </button>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={withPassword} className="space-y-4">
        <h2 className="font-display text-2xl">{creating ? "Crear cuenta" : "Entrar"}</h2>
        <Field label="Tu correo" htmlFor="email">
          <Input id="email" type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <Input id="password" type="password" required minLength={8}
            autoComplete={creating ? "new-password" : "current-password"} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Un momento..." : creating ? "Crear cuenta" : "Entrar"}
        </Button>
        <button type="button" className="w-full text-sm font-semibold text-olive underline"
          onClick={() => { setCreating(!creating); setError(null); setNotice(null); }}>
          {creating ? "Ya tengo cuenta" : "Es mi primera vez: crear cuenta"}
        </button>
        {notice && <p className="rounded-xl bg-olive-soft px-3 py-2 text-sm">{notice}</p>}
        <ErrorText>{error}</ErrorText>
        <button type="button" className="w-full text-xs text-muted underline" onClick={() => setMode("link")}>
          Prefiero recibir un enlace al correo
        </button>
      </form>
    </Card>
  );
}
