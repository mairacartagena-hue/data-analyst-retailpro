"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { ErrorText, errMsg } from "./ui";

/** Define o cambia la contraseña de la cuenta con la que se entró. */
export function CambiarClave() {
  const [clave, setClave] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    setMensaje(null);
    const { error } = await getSupabase().auth.updateUser({ password: clave });
    setOcupado(false);
    if (error) return setError(errMsg(error));
    setClave("");
    setMensaje("Listo. Desde ahora puedes entrar con tu correo y esta contraseña.");
  }

  return (
    <form onSubmit={guardar} className="space-y-2">
      <label className="label" htmlFor="nueva-clave">
        Nueva contraseña
      </label>
      <input
        id="nueva-clave"
        type="password"
        required
        minLength={6}
        autoComplete="new-password"
        className="input"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        placeholder="Mínimo 6 caracteres"
      />
      <button className="btn btn-secondary w-full" disabled={ocupado || clave.length < 6}>
        {ocupado ? "Guardando…" : "Guardar contraseña"}
      </button>
      {mensaje && <p className="text-sm">{mensaje}</p>}
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
