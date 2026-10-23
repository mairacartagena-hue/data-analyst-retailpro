"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { fechaDesdeTexto, horaDesdeTexto, normalizar, parseCsv, plantillaCsv } from "@/lib/csv";
import { toBogotaISO } from "@/lib/dates";
import { useHousehold } from "./HouseholdProvider";
import { ErrorText, Sheet, errMsg } from "./ui";

const ENC = {
  recordatorios: ["titulo", "fecha", "hora", "para", "repeticion", "aviso_previo_dias", "nota"],
  mascotas: ["nombre", "especie"],
  vacunas: ["mascota", "titulo", "tipo", "fecha", "repeticion", "aviso_previo_dias", "responsable", "nota"],
  notas: ["titulo", "contenido"],
};
type Clase = keyof typeof ENC;
const NOMBRE_CLASE: Record<Clase, string> = {
  recordatorios: "recordatorios",
  mascotas: "mascotas",
  vacunas: "vacunas y controles",
  notas: "notas",
};

type Op = { tabla: "reminders" | "pets" | "pet_events" | "notes"; fila: Record<string, unknown>; idExistente?: string };
type Err = { numero: number; motivo: string };

export function ImportarRecordar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { household, members, pets, reminders, petEvents, notes, reload } = useHousehold();
  const [paso, setPaso] = useState<"inicio" | "revisar">("inicio");
  const [ops, setOps] = useState<Op[]>([]);
  const [errores, setErrores] = useState<Err[]>([]);
  const [clase, setClase] = useState<Clase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const m1 = members[0]?.nombre ?? "Persona 1";
  const m2 = members[1]?.nombre ?? m1;
  const p1 = pets[0]?.nombre ?? "Mascota";

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
      mascotas: pets.length > 0 ? pets.map((p) => [p.nombre, p.especie]) : [["Cleo", "gato"]],
      vacunas: [
        [p1, "Vacuna antirrabica", "vacuna", "15/11/2026", "anual", "7", m1, "Llevar carnet"],
        [p1, "Control veterinario", "control", "20/12/2026", "ninguna", "3", "", ""],
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
    else if (tiene("mascota") && tiene("titulo")) tipo = "vacunas";
    else if (tiene("para") && tiene("fecha")) tipo = "recordatorios";
    else if (tiene("especie") && tiene("nombre")) tipo = "mascotas";
    if (!tipo) {
      setError("No reconozco el archivo. Usa una de las plantillas (recordatorios, mascotas, vacunas o notas).");
      return;
    }

    const col = (fila: string[], nombre: string) => {
      const i = encabezados.indexOf(nombre);
      return i >= 0 ? (fila[i] ?? "").trim() : "";
    };
    const nuevas: Op[] = [];
    const malas: Err[] = [];
    const personaId = (txt: string): string | null | undefined => {
      if (!txt) return null;
      const p = members.find((m) => normalizar(m.nombre) === normalizar(txt));
      return p ? p.id : undefined;
    };

    filas.forEach((fila, idx) => {
      const numero = idx + 2;
      const fallo = (motivo: string) => malas.push({ numero, motivo });

      if (tipo === "mascotas") {
        const nombre = col(fila, "nombre");
        if (!nombre) return fallo("falta el nombre");
        const especie = normalizar(col(fila, "especie"));
        if (especie !== "gato" && especie !== "perro") return fallo(`especie "${col(fila, "especie")}" debe ser gato o perro`);
        const existente = pets.find((p) => normalizar(p.nombre) === normalizar(nombre));
        nuevas.push({
          tabla: "pets",
          idExistente: existente?.id,
          fila: { household_id: household.id, nombre, especie },
        });
        return;
      }

      if (tipo === "notas") {
        const titulo = col(fila, "titulo");
        if (!titulo) return fallo("falta el título");
        const existente = notes.find((n) => normalizar(n.titulo) === normalizar(titulo));
        nuevas.push({
          tabla: "notes",
          idExistente: existente?.id,
          fila: { household_id: household.id, titulo, contenido: col(fila, "contenido") },
        });
        return;
      }

      if (tipo === "vacunas") {
        const titulo = col(fila, "titulo");
        if (!titulo) return fallo("falta el título");
        const mascotaTxt = col(fila, "mascota");
        const pet = pets.find((p) => normalizar(p.nombre) === normalizar(mascotaTxt));
        if (!pet) return fallo(`la mascota "${mascotaTxt}" no existe (impórtala primero en la plantilla de mascotas)`);
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
        const existente = petEvents.find((e) => e.pet_id === pet.id && normalizar(e.titulo) === normalizar(titulo) && e.fecha === fecha);
        nuevas.push({
          tabla: "pet_events",
          idExistente: existente?.id,
          fila: {
            household_id: household.id,
            pet_id: pet.id,
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
      nuevas.push({
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
    setOps(nuevas);
    setErrores(malas);
    setPaso("revisar");
  }

  async function confirmar() {
    setGuardando(true);
    setError(null);
    const sb = getSupabase();
    let fallidas = 0;
    for (const op of ops) {
      const { error } = op.idExistente
        ? await sb.from(op.tabla).update(op.fila).eq("id", op.idExistente)
        : await sb.from(op.tabla).insert(op.fila);
      if (error) {
        fallidas++;
        setError(errMsg(error));
      }
    }
    setGuardando(false);
    reload();
    if (fallidas === 0) cerrar();
    else setError(`${fallidas} filas no se pudieron guardar. Las demás sí.`);
  }

  function cerrar() {
    setPaso("inicio");
    setOps([]);
    setErrores([]);
    setClase(null);
    setError(null);
    onClose();
  }

  const nuevas = ops.filter((o) => !o.idExistente).length;
  const actualizar = ops.length - nuevas;

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
              Plantilla de mascotas
            </button>
            <button className="btn btn-secondary w-full" onClick={() => plantilla("vacunas")}>
              Plantilla de vacunas y controles
            </button>
            <button className="btn btn-secondary w-full" onClick={() => plantilla("notas")}>
              Plantilla de notas
            </button>
          </div>
          <p className="text-xs text-sec">
            En Google Sheets: <b>Archivo → Descargar → Valores separados por comas (.csv)</b>. Primero carga las mascotas y luego las vacunas.
          </p>
          <p className="text-sm">
            <b>2.</b> Carga el archivo. La app reconoce de qué tipo es.
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
            Archivo de <b>{clase ? NOMBRE_CLASE[clase] : ""}</b>. Nuevos: <b>{nuevas}</b> · Se actualizan: <b>{actualizar}</b> · Con error:{" "}
            <b>{errores.length}</b>
          </p>
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
            <button className="btn btn-primary flex-1" onClick={confirmar} disabled={ops.length === 0 || guardando}>
              {guardando ? "Guardando…" : `Confirmar (${ops.length})`}
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Sheet>
  );
}
