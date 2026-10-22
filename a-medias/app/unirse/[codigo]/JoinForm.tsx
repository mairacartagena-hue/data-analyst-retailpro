"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { ErrorText, errMsg } from "@/components/ui";

export function JoinForm({ codigo, email, yaTieneHogar }: { codigo: string; email: string; yaTieneHogar: boolean }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(email.split("@")[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <h1 className="titulo text-[48px]">Te invitaron</h1>
      <p className="mt-2 text-[15px] text-sec">
        Únete al hogar con el código <strong className="tracking-widest text-vino">{codigo}</strong> para repartir todo a
        medias.
      </p>
      {yaTieneHogar ? (
        <div className="card mt-6 space-y-3">
          <p className="text-[15px]">
            Ya perteneces a un hogar. Para unirte a este, primero sal del actual en Ajustes.
          </p>
          <Link href="/ajustes" className="btn btn-primary w-full">
            Ir a Ajustes
          </Link>
        </div>
      ) : (
        <form onSubmit={unirse} className="card mt-6 space-y-3">
          <label className="label" htmlFor="nombre">
            ¿Cómo te llamas?
          </label>
          <input id="nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          <button className="btn btn-primary w-full" disabled={ocupado || !nombre.trim()}>
            Unirme al hogar
          </button>
          <ErrorText>{error}</ErrorText>
        </form>
      )}
    </main>
  );
}
