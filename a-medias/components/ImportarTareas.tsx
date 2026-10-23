"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { fechaDesdeTexto, horaDesdeTexto, normalizar, parseCsv, plantillaCsv } from "@/lib/csv";
import { todayStr } from "@/lib/dates";
import type { Frecuencia, Task } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { ErrorText, Sheet, errMsg } from "./ui";

const ENCABEZADOS = ["titulo", "frecuencia", "dias", "responsable", "hora", "fecha_inicio"];
const EJEMPLOS = [
  ["Lavar los platos de la noche", "diaria", "", "Rotar", "21:00", "25/10/2026"],
  ["Sacar la basura y reciclaje", "semanal", "lun;jue", "Rotar", "20:00", "26/10/2026"],
  ["Limpiar el bano a fondo", "semanal", "sab", "Ari", "", "31/10/2026"],
  ["Pagar administracion", "mensual", "", "Los dos", "09:00", "05/11/2026"],
];
const FRECUENCIAS: Frecuencia[] = ["diaria", "semanal", "quincenal", "mensual"];
const DIAS: Record<string, number> = { lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6, dom: 7 };

type FilaValida = { numero: number; titulo: string; fila: Record<string, unknown>; idExistente?: string };
type FilaError = { numero: number; motivo: string };

export function ImportarTareas({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { household, members, tasks, reload } = useHousehold();
  const [paso, setPaso] = useState<"inicio" | "revisar">("inicio");
  const [validas, setValidas] = useState<FilaValida[]>([]);
  const [errores, setErrores] = useState<FilaError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function descargar() {
    const texto = plantillaCsv(ENCABEZADOS, EJEMPLOS);
    const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_tareas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function leer(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo || !household) return;
    setError(null);
    const { encabezados, filas } = parseCsv(await archivo.text());

    const faltan = ENCABEZADOS.filter((h) => h !== "dias" && h !== "hora" && h !== "fecha_inicio" && !encabezados.includes(h));
    if (faltan.length > 0) {
      setError(
        `Al archivo le faltan columnas: ${faltan.join(", ")}. La app leyó estos encabezados: ${encabezados.join(" | ") || "(ninguno)"}`,
      );
      return;
    }

    const col = (fila: string[], nombre: string) => {
      const i = encabezados.indexOf(nombre);
      return i >= 0 ? (fila[i] ?? "").trim() : "";
    };

    const buenas: FilaValida[] = [];
    const malas: FilaError[] = [];
    const hoy = todayStr();

    filas.forEach((fila, idx) => {
      const numero = idx + 2; // fila 1 es el encabezado
      const titulo = col(fila, "titulo");
      if (!titulo) return malas.push({ numero, motivo: "falta el título" });

      const frecuencia = normalizar(col(fila, "frecuencia")) as Frecuencia;
      if (!FRECUENCIAS.includes(frecuencia)) {
        return malas.push({ numero, motivo: `frecuencia "${col(fila, "frecuencia")}" no existe (usa diaria, semanal, quincenal o mensual)` });
      }

      const fechaTexto = col(fila, "fecha_inicio");
      const fecha = fechaTexto ? fechaDesdeTexto(fechaTexto) : hoy;
      if (!fecha) return malas.push({ numero, motivo: `fecha_inicio "${fechaTexto}" no es DD/MM/AAAA` });

      const horaTexto = col(fila, "hora");
      const hora = horaTexto ? horaDesdeTexto(horaTexto) : null;
      if (horaTexto && !hora) return malas.push({ numero, motivo: `hora "${horaTexto}" no es HH:MM` });

      let dias: number[] = [];
      if (frecuencia === "semanal") {
        const tokens = col(fila, "dias").split(/[;,\s]+/).filter(Boolean);
        dias = tokens.map((t) => DIAS[normalizar(t).slice(0, 3)]);
        if (tokens.length === 0) {
          const d = new Date(fecha + "T12:00:00").getDay();
          dias = [d === 0 ? 7 : d];
        } else if (dias.some((d) => d === undefined)) {
          return malas.push({ numero, motivo: `días "${col(fila, "dias")}" no reconocidos (usa lun, mar, mie, jue, vie, sab, dom)` });
        }
      }

      const responsableTexto = col(fila, "responsable");
      const r = normalizar(responsableTexto);
      if (!r) return malas.push({ numero, motivo: "falta el responsable (Rotar, Los dos o un nombre)" });
      let modo: Task["modo"];
      let responsable: string | null = null;
      if (r === "rotar") modo = "rota";
      else if (r === "los dos") modo = "juntos";
      else {
        const persona = members.find((m) => normalizar(m.nombre) === r);
        if (!persona) return malas.push({ numero, motivo: `la persona "${responsableTexto}" no existe en el hogar` });
        modo = "fija";
        responsable = persona.id;
      }

      const existente = tasks.find((t) => t.tipo === "tarea" && normalizar(t.titulo) === normalizar(titulo));
      buenas.push({
        numero,
        titulo,
        idExistente: existente?.id,
        fila: {
          household_id: household.id,
          titulo,
          tipo: "tarea",
          frecuencia,
          dias_semana: frecuencia === "semanal" ? dias : [],
          modo,
          responsable_fijo: responsable,
          hora_recordatorio: hora,
          fecha_inicio: fecha,
          activa: true,
        },
      });
    });

    setValidas(buenas);
    setErrores(malas);
    setPaso("revisar");
  }

  async function confirmar() {
    setGuardando(true);
    setError(null);
    const sb = getSupabase();
    let fallidas = 0;
    for (const f of validas) {
      const { error } = f.idExistente
        ? await sb.from("tasks").update(f.fila).eq("id", f.idExistente)
        : await sb.from("tasks").insert(f.fila);
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
    setValidas([]);
    setErrores([]);
    setError(null);
    onClose();
  }

  const nuevas = validas.filter((f) => !f.idExistente).length;
  const actualizar = validas.length - nuevas;

  return (
    <Sheet open={open} onClose={cerrar} title="Importar tareas">
      {paso === "inicio" ? (
        <div className="space-y-4">
          <p className="text-sm">
            <b>1.</b> Descarga la plantilla y ábrela en <b>Google Sheets</b> (recomendado) o en Excel. Llénala y guárdala como CSV.
          </p>
          <button className="btn btn-secondary w-full" onClick={descargar}>
            Descargar plantilla
          </button>
          <p className="text-xs text-sec">
            En Google Sheets: <b>Archivo → Descargar → Valores separados por comas (.csv)</b>.
          </p>
          <p className="text-sm">
            <b>2.</b> Carga el archivo que llenaste. Si una tarea ya existe (mismo título), se actualiza.
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
            Nuevas: <b>{nuevas}</b> · Se actualizan: <b>{actualizar}</b> · Con error: <b>{errores.length}</b>
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
            <button className="btn btn-primary flex-1" onClick={confirmar} disabled={validas.length === 0 || guardando}>
              {guardando ? "Guardando…" : `Confirmar (${validas.length})`}
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Sheet>
  );
}
