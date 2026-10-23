"use client";

import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Paperclip, Trash2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatShort, todayStr } from "@/lib/dates";
import type { PetDocument } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { ErrorText, errMsg } from "./ui";

const BUCKET = "mascotas-docs";
const MAX_BYTES = 10 * 1024 * 1024;
const TIPOS = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

export function PetDocs({ petId }: { petId: string }) {
  const { household } = useHousehold();
  const [docs, setDocs] = useState<PetDocument[]>([]);
  const [titulo, setTitulo] = useState("");
  const [fecha, setFecha] = useState(todayStr());
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    const { data, error } = await getSupabase()
      .from("pet_documents")
      .select("*")
      .eq("pet_id", petId)
      .order("fecha", { ascending: false });
    if (error) return setError(errMsg(error));
    setDocs((data ?? []) as PetDocument[]);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId]);

  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !household) return;
    setError(null);
    if (!TIPOS.includes(file.type)) return setError("Solo PDF o fotos (JPG, PNG, WEBP o HEIC).");
    if (file.size > MAX_BYTES) return setError("El archivo pasa de 10 MB.");

    setSubiendo(true);
    const sb = getSupabase();
    const limpio = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ruta = `${household.id}/${petId}/${crypto.randomUUID()}-${limpio}`;
    const { error: errSubida } = await sb.storage.from(BUCKET).upload(ruta, file, { contentType: file.type });
    if (errSubida) {
      setSubiendo(false);
      return setError(errMsg(errSubida));
    }
    const { error } = await sb.from("pet_documents").insert({
      household_id: household.id,
      pet_id: petId,
      titulo: titulo.trim() || file.name,
      fecha,
      tipo: file.type === "application/pdf" ? "pdf" : "imagen",
      ruta,
      tamano: file.size,
    });
    setSubiendo(false);
    if (error) return setError(errMsg(error));
    setTitulo("");
    cargar();
  }

  async function abrir(d: PetDocument) {
    // Se abre la pestaña antes de pedir el enlace, para que el celular no lo bloquee
    const ventana = window.open("", "_blank");
    const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUrl(d.ruta, 300);
    if (error || !data) {
      ventana?.close();
      return setError(error ? errMsg(error) : "No pudimos abrir el archivo.");
    }
    if (ventana) ventana.location.href = data.signedUrl;
  }

  async function borrar(d: PetDocument) {
    if (!window.confirm(`¿Borrar "${d.titulo}"?`)) return;
    const sb = getSupabase();
    const { error: errArchivo } = await sb.storage.from(BUCKET).remove([d.ruta]);
    if (errArchivo) return setError(errMsg(errArchivo));
    const { error } = await sb.from("pet_documents").delete().eq("id", d.id);
    if (error) return setError(errMsg(error));
    setDocs((prev) => prev.filter((x) => x.id !== d.id));
  }

  return (
    <section className="card">
      <h2 className="titulo text-[20px]">Documentos</h2>
      <p className="text-xs text-sec">Historias clínicas, exámenes y fotos. Máximo 10 MB por archivo.</p>

      <div className="mt-3 grid gap-2">
        <input
          className="input"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título (ej. Historia clínica)"
          aria-label="Título del documento"
        />
        <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha del documento" />
        <label className={`btn btn-primary cursor-pointer ${subiendo ? "opacity-60" : ""}`}>
          <Paperclip size={16} /> {subiendo ? "Subiendo…" : "Subir PDF o foto"}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            disabled={subiendo}
            onChange={subir}
          />
        </label>
      </div>
      <ErrorText>{error}</ErrorText>

      {docs.length === 0 ? (
        <p className="mt-4 text-sm text-sec">Todavía no hay documentos.</p>
      ) : (
        <ul className="mt-3">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 border-b-2 border-rosa-claro py-3 last:border-b-0">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => abrir(d)}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-vino bg-crema">
                  {d.tipo === "pdf" ? <FileText size={16} /> : <ImageIcon size={16} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{d.titulo}</span>
                  <span className="block text-xs text-sec">{formatShort(d.fecha)}</span>
                </span>
              </button>
              <button onClick={() => borrar(d)} aria-label={`Borrar ${d.titulo}`} className="p-1 text-sec">
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
