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
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") ? "El link venció o ya se usó. Pide uno nuevo." : null);
  const [ocupado, setOcupado] = useState(false);

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
    else {
      router.replace(next);
      router.refresh();
    }
  }

  if (enviado) {
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

  return (
    <form onSubmit={enviar} className="card space-y-4">
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
      <button className="btn btn-primary w-full" disabled={ocupado}>
        <Mail size={18} /> {ocupado ? "Enviando..." : "Enviarme el link para entrar"}
      </button>
      <p className="text-xs text-sec">Sin contraseñas: te llega un link mágico al correo y la sesión queda guardada.</p>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
