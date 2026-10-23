"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { fechaDesdeTexto, horaDesdeTexto, normalizar, parseCsv, plantillaCsv } from "@/lib/csv";
import { toBogotaISO } from "@/lib/dates";
import { useHousehold } from "./HouseholdProvider";
import { ErrorText, Sheet, errMsg } from "./ui";

const ENC = {
  recordatorios: ["titulo", "fecha", "hora", "para", "repeticion", "aviso_previo_dias", "nota"],
  mascotas: ["mascota", "especie", "evento", "tipo", "fecha", "repeticion", "aviso_previo_dias", "responsable", "nota"],
  notas: ["titulo", "contenido"],
};
type Clase = keyof typeof ENC;

type Err = { numero: number; motivo: string };
type PetOp = { clave: string; nombre: string; especie?: string; idExistente?: string };
type EvOp = { clave: string; fila: Record<string, unknown>; idExistente?: string };
type OtraOp = { tabla: "reminders" | "notes"; fila: Record<string, unknown>; idExistente?: string };

export function ImportarRecordar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { household, members, pets, reminders, petEvents, notes, reload } = useHousehold();
  const [paso, setPaso] = useState<"inicio" | "revisar">("inicio");
  const [mascotas, setMascotas] = useState<PetOp[]>([]);
  const [eventos, setEventos] = useState<EvOp[]>([]);
  const [otras, setOtras] = useState<OtraOp[]>([]);
  const [errores, setErrores] = useState<Err[]>([]);
  const [clase, setClase] = useState<Clase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const m1 = members[0]?.nombre ?? "Persona 1";

  function descargar(nombre: string, texto: string) {
    const blob = new Blob([texto], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  function plantilla(c: Clase) {
    const ejemplos: Record<Clase, string[][]> = {
      recordatorios: [
        ["Pagar administracion y arriendo", "05/11/2026", "09:00", "Los dos", "mensual", "2", "Transferir antes del corte"],
        ["Revision gas natural", "15/12/2026", "10:00", m1, "anual", "7", "Llamar a agendar"],
      ],
      mascotas: [
        [pets[0]?.nombre ?? "Cleo", pets[0]?.especie ?? "gato", "Vacuna antirrabica", "vacuna", "15/11/2026", "anual", "7", m1, "Llevar carnet"],
        [pets[0]?.nombre ?? "Cleo", "", "Control veterinario", "control", "20/12/2026", "ninguna", "3", "", ""],
        [pets[1]?.nombre ?? "Ragnar", pets[1]?.especie ?? "perro", "", "", "", "", "", "", ""],
        ["Nombre nueva", "gato", "", "", "", "", "", "", ""],
      ],
      notas: [
        ["Wifi de la casa", "Clave en la caja de la sala"],
        ["Telefonos clave", "Veterinario: 300 000 0000"],
      ],
    };
    descargar(`plantilla_${c}.csv`, plantillaCsv(ENC[c], ejemplos[c]));
  }

  async function leer(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo || !household) return;
    setError(null);
    const { encabezados, filas } = parseCsv(await archivo.text());
    const tiene = (c: string) => encabezados.includes(c);

    let tipo: Clase | null = null;
    if (tiene("contenido") && tiene("titulo")) tipo = "notas";
    else if (tiene("para") && tiene("fecha")) tipo = "recordatorios";
    else if (tiene("mascota")) tipo = "mascotas";
    if (!tipo) {
      setError("No reconozco el archivo. Usa una de las plantillas (recordatorios, mascotas y vacunas, o notas).");
      return;
    }

    const col = (fila: string[], nombre: string) => {
      const i = encabezados.indexOf(nombre);
      return i >= 0 ? (fila[i] ?? "").trim() : "";
    };
    const malas: Err[] = [];
    const mascotaOps = new Map<string, PetOp>();
    const eventoOps: EvOp[] = [];
    const otrasOps: OtraOp[] = [];
    const personaId = (txt: string): string | null | undefined => {
      if (!txt) return null;
      const p = members.find((m) => normalizar(m.nombre) === normalizar(txt));
      return p ? p.id : undefined;
    };

    filas.forEach((fila, idx) => {
      const numero = idx + 2;
      const fallo = (motivo: string) => malas.push({ numero, motivo });

      if (tipo === "mascotas") {
        const nombre = col(fila, "mascota");
        if (!nombre) return fallo("falta el nombre de la mascota");
        const clave = normalizar(nombre);
        const existente = pets.find((p) => normalizar(p.nombre) === clave);
        const especieTxt = normalizar(col(fila, "especie"));
        if (especieTxt && especieTxt !== "gato" && especieTxt !== "perro") return fallo(`especie "${col(fila, "especie")}" debe ser gato o perro`);
        if (!existente && !especieTxt) return fallo(`la mascota "${nombre}" es nueva: falta la especie (gato o perro)`);

        // Una mascota puede aparecer varias veces (una fila por vacuna): se junta
        const previa = mascotaOps.get(clave);
        if (!previa) {
          mascotaOps.set(clave, {
            clave,
            nombre: existente?.nombre ?? nombre,
            especie: especieTxt ? especieTxt : undefined,
            idExistente: existente?.id,
          });
        } else if (especieTxt) {
          previa.especie = especieTxt;
        }

        const titulo = col(fila, "evento");
        if (!titulo) return;
        const fecha = fechaDesdeTexto(col(fila, "fecha"));
        if (!fecha) return fallo(`fecha "${col(fila, "fecha")}" no es DD/MM/AAAA`);
        const tipoTxt = normalizar(col(fila, "tipo")) || "vacuna";
        if (!["vacuna", "control", "otro"].includes(tipoTxt)) return fallo(`tipo "${col(fila, "tipo")}" debe ser vacuna, control u otro`);
        const rep = normalizar(col(fila, "repeticion")) || "ninguna";
        if (rep !== "ninguna" && rep !== "anual") return fallo(`repeticion "${col(fila, "repeticion")}" debe ser ninguna o anual`);
        const aviso = Number(col(fila, "aviso_previo_dias") || "0");
        if (!(aviso >= 0)) return fallo("aviso_previo_dias debe ser un número (0 o más)");
        const resp = personaId(col(fila, "responsable"));
        if (resp === undefined) return fallo(`la persona "${col(fila, "responsable")}" no existe en el hogar`);
        const existeEvento = existente
          ? petEvents.find((ev) => ev.pet_id === existente.id && normalizar(ev.titulo) === normalizar(titulo) && ev.fecha === fecha)
          : undefined;
        eventoOps.push({
          clave,
          idExistente: existeEvento?.id,
          fila: {
            household_id: household.id,
            titulo,
            fecha,
            tipo: tipoTxt,
            repeticion: rep,
            aviso_previo_dias: aviso,
            responsable_id: resp,
            nota: col(fila, "nota") || null,
          },
        });
        return;
      }

      if (tipo === "notas") {
        const titulo = col(fila, "titulo");
        if (!titulo) return fallo("falta el título");
        const existente = notes.find((n) => normalizar(n.titulo) === normalizar(titulo));
        otrasOps.push({
          tabla: "notes",
          idExistente: existente?.id,
          fila: { household_id: household.id, titulo, contenido: col(fila, "contenido") },
        });
        return;
      }

      // recordatorios
      const titulo = col(fila, "titulo");
      if (!titulo) return fallo("falta el título");
      const fecha = fechaDesdeTexto(col(fila, "fecha"));
      if (!fecha) return fallo(`fecha "${col(fila, "fecha")}" no es DD/MM/AAAA`);
      const horaTxt = col(fila, "hora");
      const hora = horaTxt ? horaDesdeTexto(horaTxt) : "09:00";
      if (!hora) return fallo(`hora "${horaTxt}" no es HH:MM`);
      const paraTxt = col(fila, "para");
      const paraN = normalizar(paraTxt);
      let responsables: string[] = [];
      if (paraN && paraN !== "los dos") {
        const id = personaId(paraTxt);
        if (!id) return fallo(`la persona "${paraTxt}" no existe en el hogar`);
        responsables = [id];
      }
      const rep = normalizar(col(fila, "repeticion")) || "ninguna";
      if (!["ninguna", "mensual", "anual"].includes(rep)) return fallo(`repeticion "${col(fila, "repeticion")}" debe ser ninguna, mensual o anual`);
      const aviso = Number(col(fila, "aviso_previo_dias") || "0");
      if (!(aviso >= 0)) return fallo("aviso_previo_dias debe ser un número (0 o más)");
      const iso = toBogotaISO(fecha, hora);
      const existente = reminders.find(
        (r) => normalizar(r.titulo) === normalizar(titulo) && new Date(r.fecha_hora).getTime() === new Date(iso).getTime(),
      );
      otrasOps.push({
        tabla: "reminders",
        idExistente: existente?.id,
        fila: {
          household_id: household.id,
          titulo,
          fecha_hora: iso,
          responsables,
          repeticion: rep,
          aviso_previo_dias: aviso,
          nota: col(fila, "nota") || null,
        },
      });
    });

    setClase(tipo);
    setMascotas([...mascotaOps.values()]);
    setEventos(eventoOps);
    setOtras(otrasOps);
    setErrores(malas);
    setPaso("revisar");
  }

  async function confirmar() {
    setGuardando(true);
    setError(null);
    const sb = getSupabase();
    let fallidas = 0;
    const ids = new Map<string, string>(); // mascota (normalizada) -> id

    for (const m of mascotas) {
      if (m.idExistente) {
        ids.set(m.clave, m.idExistente);
        if (m.especie) {
          const { error } = await sb.from("pets").update({ especie: m.especie }).eq("id", m.idExistente);
          if (error) { fallidas++; setError(errMsg(error)); }
        }
      } else {
        const { data, error } = await sb
          .from("pets")
          .insert({ household_id: household!.id, nombre: m.nombre, especie: m.especie })
          .select("id")
          .single();
        if (error || !data) { fallidas++; setError(error ? errMsg(error) : "No se pudo crear la mascota."); continue; }
        ids.set(m.clave, (data as { id: string }).id);
      }
    }

    for (const ev of eventos) {
      const petId = ids.get(ev.clave);
      if (!petId) { fallidas++; continue; }
      const fila = { ...ev.fila, pet_id: petId };
      const { error } = ev.idExistente
        ? await sb.from("pet_events").update(fila).eq("id", ev.idExistente)
        : await sb.from("pet_events").insert(fila);
      if (error) { fallidas++; setError(errMsg(error)); }
    }

    for (const o of otras) {
      const { error } = o.idExistente
        ? await sb.from(o.tabla).update(o.fila).eq("id", o.idExistente)
        : await sb.from(o.tabla).insert(o.fila);
      if (error) { fallidas++; setError(errMsg(error)); }
    }

    setGuardando(false);
    reload();
    if (fallidas === 0) cerrar();
    else setError(`${fallidas} filas no se pudieron guardar. Las demás sí.`);
  }

  function cerrar() {
    setPaso("inicio");
    setMascotas([]);
    setEventos([]);
    setOtras([]);
    setErrores([]);
    setClase(null);
    setError(null);
    onClose();
  }

  const totalOps = mascotas.length + eventos.length + otras.length;
  const nuevasMascotas = mascotas.filter((m) => !m.idExistente).length;
  const actualizadasMascotas = mascotas.length - nuevasMascotas;
  const nuevos =
    mascotas.filter((m) => !m.idExistente).length + eventos.filter((e) => !e.idExistente).length + otras.filter((o) => !o.idExistente).length;
  const actualizan = totalOps - nuevos;

  return (
    <Sheet open={open} onClose={cerrar} title="Importar recordar">
      {paso === "inicio" ? (
        <div className="space-y-4">
          <p className="text-sm">
            <b>1.</b> Descarga la plantilla que necesitas y llénala en <b>Google Sheets</b> (recomendado) o Excel.
          </p>
          <div className="grid gap-2">
            <button className="btn btn-secondary w-full" onClick={() => plantilla("recordatorios")}>
              Plantilla de recordatorios
            </button>
            <button className="btn btn-secondary w-full" onClick={() => plantilla("mascotas")}>
              Plantilla de mascotas y vacunas
            </button>
            <button className="btn btn-secondary w-full" onClick={() => plantilla("notas")}>
              Plantilla de notas
            </button>
          </div>
          <p className="text-xs text-sec">
            En Google Sheets: <b>Archivo → Descargar → Valores separados por comas (.csv)</b>.
          </p>
          <p className="text-sm">
            <b>2.</b> En la plantilla de mascotas, una fila por mascota. Si la mascota no existe, se crea; si ya existe, se actualiza. Las vacunas y controles van en la misma fila, en las columnas de evento.
          </p>
          <label className="btn btn-primary w-full cursor-pointer">
            Cargar archivo
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={leer} />
          </label>
          <ErrorText>{error}</ErrorText>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            Archivo de <b>{clase === "mascotas" ? "mascotas y vacunas" : clase === "notas" ? "notas" : "recordatorios"}</b>. Nuevos:{" "}
            <b>{nuevos}</b> · Se actualizan: <b>{actualizan}</b> · Con error: <b>{errores.length}</b>
          </p>
          {clase === "mascotas" && (
            <p className="text-sm text-sec">
              Mascotas nuevas: {nuevasMascotas} · Actualizadas: {actualizadasMascotas} · Vacunas y controles: {eventos.length}
            </p>
          )}
          {errores.length > 0 && (
            <div className="rounded-xl border-2 border-accion p-3 text-sm">
              <p className="mb-1 font-semibold">Estas filas no se cargan:</p>
              <ul className="space-y-1">
                {errores.slice(0, 10).map((e) => (
                  <li key={e.numero}>
                    Fila {e.numero}: {e.motivo}
                  </li>
                ))}
              </ul>
              {errores.length > 10 && <p className="mt-1 text-sec">Y {errores.length - 10} más.</p>}
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn btn-secondary flex-1" onClick={() => setPaso("inicio")} disabled={guardando}>
              Volver
            </button>
            <button className="btn btn-primary flex-1" onClick={confirmar} disabled={totalOps === 0 || guardando}>
              {guardando ? "Guardando…" : `Confirmar (${totalOps})`}
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Sheet>
  );
}
