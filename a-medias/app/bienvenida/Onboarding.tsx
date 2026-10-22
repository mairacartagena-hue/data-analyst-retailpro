"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Home, Link2, LogOut } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { ErrorText, errMsg } from "@/components/ui";

export function Onboarding({ email }: { email: string }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(email.split("@")[0] ?? "");
  const [hogar, setHogar] = useState("Nuestra casa");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    const { error } = await getSupabase().rpc("create_household", { p_nombre_hogar: hogar, p_nombre: nombre });
    setOcupado(false);
    if (error) return setError(errMsg(error));
    router.replace("/");
    router.refresh();
  }

  async function unirse(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    const { error } = await getSupabase().rpc("join_household", { p_codigo: codigo, p_nombre: nombre });
    setOcupado(false);
    if (error) return setError(errMsg(error));
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="titulo text-[48px]">Hola</h1>
      <p className="mt-2 text-[15px] text-sec">Crea el hogar o únete al de tu pareja.</p>

      <div className="mt-6">
        <label className="label" htmlFor="nombre">
          ¿Cómo te llamas?
        </label>
        <input id="nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      </div>

      <form onSubmit={crear} className="card mt-6 space-y-3">
        <h2 className="titulo flex items-center gap-2 text-[24px]">
          <Home size={22} /> Crear un hogar
        </h2>
        <div>
          <label className="label" htmlFor="hogar">
            Nombre del hogar
          </label>
          <input id="hogar" className="input" value={hogar} onChange={(e) => setHogar(e.target.value)} />
        </div>
        <button className="btn btn-primary w-full" disabled={ocupado || !nombre.trim()}>
          Crear hogar
        </button>
      </form>

      <form onSubmit={unirse} className="card mt-4 space-y-3">
        <h2 className="titulo flex items-center gap-2 text-[24px]">
          <Link2 size={22} /> Tengo un código
        </h2>
        <input
          className="input uppercase tracking-[0.25em]"
          maxLength={8}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          placeholder="ABCD2345"
          aria-label="Código de invitación"
        />
        <button className="btn btn-secondary w-full" disabled={ocupado || codigo.length !== 8 || !nombre.trim()}>
          Unirme
        </button>
      </form>

      <ErrorText>{error}</ErrorText>

      <button
        className="mt-8 flex items-center gap-2 text-sm font-semibold text-sec"
        onClick={async () => {
          await getSupabase().auth.signOut();
          router.replace("/login");
        }}
      >
        <LogOut size={16} /> Cerrar sesión ({email})
      </button>
    </main>
  );
}
