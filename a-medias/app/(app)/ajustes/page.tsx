"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, LogOut, RefreshCw, Share2 } from "lucide-react";
import { useHousehold } from "@/components/HouseholdProvider";
import { InstallButton } from "@/components/InstallButton";
import { PushButton } from "@/components/PushButton";
import { ErrorText, PageHeader, errMsg } from "@/components/ui";
import { Loading } from "@/components/Loading";
import { getSupabase } from "@/lib/supabase/client";
import type { Color, Member } from "@/lib/types";

export default function AjustesPage() {
  const router = useRouter();
  const { ready, household, members, me, optimistic } = useHousehold();
  const [nombreHogar, setNombreHogar] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origen, setOrigen] = useState("");

  useEffect(() => setOrigen(window.location.origin), []);
  useEffect(() => {
    if (household) setNombreHogar(household.nombre);
  }, [household?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || !household) return <div className="pt-6"><Loading /></div>;

  const link = `${origen}/unirse/${household.codigo_invitacion}`;

  async function guardarHogar() {
    if (!nombreHogar.trim() || nombreHogar === household!.nombre) return;
    const { error } = await getSupabase().from("households").update({ nombre: nombreHogar.trim() }).eq("id", household!.id);
    setError(error ? errMsg(error) : null);
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError("No se pudo copiar. Mantén presionado el link para copiarlo.");
    }
  }

  async function compartir() {
    if (navigator.share) {
      await navigator.share({ title: "A Medias", text: "Únete a nuestro hogar en A Medias", url: link }).catch(() => {});
    } else copiar();
  }

  async function regenerar() {
    if (!confirm("El link anterior dejará de funcionar. ¿Generar un código nuevo?")) return;
    const { error } = await getSupabase().rpc("regenerate_invite_code", { p_household_id: household!.id });
    setError(error ? errMsg(error) : null);
  }

  async function salir() {
    const ultimo = members.length <= 1;
    const msg = ultimo
      ? "Eres la única persona del hogar: al salir se borran todos los datos. ¿Seguro?"
      : "Vas a salir del hogar. Tu pareja conserva los datos. ¿Seguro?";
    if (!confirm(msg)) return;
    const { error } = await getSupabase().rpc("leave_household");
    if (error) return setError(errMsg(error));
    router.replace("/bienvenida");
    router.refresh();
  }

  async function cerrarSesion() {
    await getSupabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <div className="pt-5">
        <Link href="/" className="flex items-center gap-1 text-sm font-semibold">
          <ArrowLeft size={18} /> Hoy
        </Link>
      </div>
      <PageHeader title="Ajustes" />

      <section className="card space-y-3">
        <label className="label" htmlFor="hogar">
          Nombre del hogar
        </label>
        <input id="hogar" className="input" value={nombreHogar} onChange={(e) => setNombreHogar(e.target.value)} onBlur={guardarHogar} />
      </section>

      <h2 className="seccion">Personas</h2>
      <div className="space-y-3">
        {members.map((m) => (
          <MemberEditor key={m.id} member={m} esYo={m.id === me?.id} onChange={(row) => optimistic("members", row)} onError={setError} />
        ))}
      </div>

      <h2 className="seccion">Invitar</h2>
      <section className="card space-y-3">
        {members.length >= 2 ? (
          <p className="text-sm text-sec">El hogar ya tiene dos personas.</p>
        ) : (
          <p className="text-sm">Envíale este link a tu pareja para que se una:</p>
        )}
        <p className="break-all rounded-[10px] border-2 border-vino bg-white px-3 py-2 text-sm">{link}</p>
        <p className="text-sm">
          Código: <strong className="tracking-[0.25em]">{household.codigo_invitacion}</strong>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn btn-primary" onClick={copiar}>
            {copiado ? <Check size={16} /> : <Copy size={16} />} {copiado ? "Copiado" : "Copiar link"}
          </button>
          <button className="btn btn-secondary" onClick={compartir}>
            <Share2 size={16} /> Compartir
          </button>
        </div>
        <button className="btn btn-secondary btn-sm w-full" onClick={regenerar}>
          <RefreshCw size={14} /> Regenerar código
        </button>
      </section>

      <h2 className="seccion">Notificaciones</h2>
      <section className="card">
        <PushButton />
      </section>

      <h2 className="seccion">App</h2>
      <section className="card">
        <InstallButton className="w-full" />
      </section>

      <ErrorText>{error}</ErrorText>

      <div className="mt-8 space-y-3">
        <button className="btn btn-secondary w-full" onClick={cerrarSesion}>
          <LogOut size={16} /> Cerrar sesión
        </button>
        <button className="btn w-full border-accion text-accion" onClick={salir}>
          Salir del hogar
        </button>
      </div>
    </>
  );
}

function MemberEditor({
  member,
  esYo,
  onChange,
  onError,
}: {
  member: Member;
  esYo: boolean;
  onChange: (m: Member) => void;
  onError: (e: string | null) => void;
}) {
  const [nombre, setNombre] = useState(member.nombre);
  useEffect(() => setNombre(member.nombre), [member.nombre]);

  async function guardarNombre() {
    if (!nombre.trim() || nombre === member.nombre) return;
    onChange({ ...member, nombre: nombre.trim() });
    const { error } = await getSupabase().from("members").update({ nombre: nombre.trim() }).eq("id", member.id);
    onError(error ? errMsg(error) : null);
  }

  async function color(c: Color) {
    if (c === member.color) return;
    const { error } = await getSupabase().rpc("set_member_color", { p_member_id: member.id, p_color: c });
    onError(error ? errMsg(error) : null);
  }

  return (
    <section className="card space-y-3">
      <label className="label" htmlFor={`m-${member.id}`}>
        {esYo ? "Tu nombre" : "Nombre de tu pareja"}
      </label>
      <input id={`m-${member.id}`} className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} onBlur={guardarNombre} />
      <div className="flex gap-2">
        {(["rosa", "bordo"] as Color[]).map((c) => (
          <button
            key={c}
            onClick={() => color(c)}
            aria-pressed={member.color === c}
            className={`flex flex-1 items-center justify-center gap-2 rounded-[10px] border-[3px] py-2.5 text-sm font-semibold ${
              c === "rosa" ? "bg-rosa text-vino" : "bg-vino text-crema"
            } ${member.color === c ? "border-accion outline-2 outline-offset-2 outline-accion" : "border-vino"}`}
          >
            {member.color === c && <Check size={16} />} {c === "rosa" ? "Rosa" : "Bordó"}
          </button>
        ))}
      </div>
    </section>
  );
}
