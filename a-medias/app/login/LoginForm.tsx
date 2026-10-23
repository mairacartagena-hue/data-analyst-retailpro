"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { ErrorText, errMsg } from "@/components/ui";

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get("next") || "/";
  const [modo, setModo] = useState<"clave" | "link">("clave");
  const [crear, setCrear] = useState(false);
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(params.get("error") ? "El link venció o ya se usó. Pide uno nuevo." : null);
  const [ocupado, setOcupado] = useState(false);

  function entrar() {
    router.replace(next);
    router.refresh();
  }

  async function conClave(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    setAviso(null);
    const sb = getSupabase();
    if (crear) {
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password: clave });
      setOcupado(false);
      if (error) return setError(errMsg(error));
      if (data.session) return entrar();
      // Si Supabase pide confirmar el correo, la cuenta existe pero aún no entra
      setAviso("Cuenta creada. Ahora entra con tu correo y contraseña.");
      setCrear(false);
      setClave("");
      return;
    }
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: clave });
    setOcupado(false);
    if (error) return setError("Correo o contraseña incorrectos. Si es tu primera vez, toca “Crear cuenta”.");
    entrar();
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setOcupado(false);
    if (error) setError(errMsg(error));
    else setEnviado(true);
  }

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    const { error } = await getSupabase().auth.verifyOtp({ email: email.trim(), token: codigo.trim(), type: "email" });
    setOcupado(false);
    if (error) setError("Ese código no funcionó. Revisa el correo o pide uno nuevo.");
    else entrar();
  }

  if (modo === "link" && enviado) {
    return (
      <div className="card space-y-4">
        <h2 className="titulo text-[26px]">Revisa tu correo</h2>
        <p className="text-[15px]">
          Te enviamos un link a <strong>{email}</strong>. Ábrelo en este mismo celular para entrar.
        </p>
        <form onSubmit={verificar} className="space-y-2 border-t-2 border-rosa pt-4">
          <label className="label" htmlFor="codigo">
            ¿El correo trae un código? Escríbelo aquí
          </label>
          <input
            id="codigo"
            className="input tracking-[0.3em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="123456"
          />
          <button className="btn btn-secondary w-full" disabled={ocupado || codigo.length < 6}>
            Entrar con el código
          </button>
        </form>
        <ErrorText>{error}</ErrorText>
        <button className="text-sm font-semibold text-accion underline" onClick={() => setEnviado(false)}>
          Usar otro correo
        </button>
      </div>
    );
  }

  if (modo === "link") {
    return (
      <form onSubmit={enviar} className="card space-y-4">
        <div>
          <label className="label" htmlFor="email-link">
            Tu correo
          </label>
          <input
            id="email-link"
            type="email"
            required
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
          />
        </div>
        <button className="btn btn-primary w-full" disabled={ocupado}>
          <Mail size={18} /> {ocupado ? "Enviando..." : "Enviarme el link para entrar"}
        </button>
        <ErrorText>{error}</ErrorText>
        <button className="text-sm font-semibold text-accion underline" onClick={() => setModo("clave")}>
          Entrar con contraseña
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={conClave} className="card space-y-4">
      <h2 className="titulo text-[24px]">{crear ? "Crear cuenta" : "Entrar"}</h2>
      <div>
        <label className="label" htmlFor="email">
          Tu correo
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@correo.com"
        />
      </div>
      <div>
        <label className="label" htmlFor="clave">
          Contraseña
        </label>
        <input
          id="clave"
          type="password"
          required
          minLength={6}
          autoComplete={crear ? "new-password" : "current-password"}
          className="input"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          placeholder="Mínimo 6 caracteres"
        />
      </div>
      <button className="btn btn-primary w-full" disabled={ocupado}>
        {ocupado ? "Un momento..." : crear ? "Crear cuenta" : "Entrar"}
      </button>
      <button
        type="button"
        className="w-full text-sm font-semibold text-accion underline"
        onClick={() => {
          setCrear(!crear);
          setError(null);
          setAviso(null);
        }}
      >
        {crear ? "Ya tengo cuenta" : "Es mi primera vez: crear cuenta"}
      </button>
      {aviso && <p className="text-sm text-sec">{aviso}</p>}
      <ErrorText>{error}</ErrorText>
      <button type="button" className="w-full text-xs text-sec underline" onClick={() => setModo("link")}>
        Prefiero recibir un link al correo
      </button>
    </form>
  );
}
