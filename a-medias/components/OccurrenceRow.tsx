"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { formatHora, formatShort, nowTimeStr, todayStr } from "@/lib/dates";
import type { Occurrence, Task } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { Avatar, Checkbox, ErrorText, Sheet, errMsg } from "./ui";

/** "Michi · Amoxicilina 5 ml · 8:00" o el título de la tarea */
export function occurrenceLabel(task: Task, petName?: string) {
  if (task.tipo === "medicamento") {
    return [petName ?? "Mascota", [task.titulo, task.dosis].filter(Boolean).join(" ")].join(" · ");
  }
  return task.titulo;
}

export function useToggleOccurrence() {
  const { optimistic, me } = useHousehold();
  return async (o: Occurrence) => {
    const completada = !o.completada;
    optimistic("occurrences", {
      ...o,
      completada,
      completada_por: completada ? me?.id ?? null : null,
      completada_en: completada ? new Date().toISOString() : null,
    });
    const { error } = await getSupabase()
      .from("task_occurrences")
      .update({ completada, completada_por: completada ? me?.id : null })
      .eq("id", o.id);
    if (error) optimistic("occurrences", { ...o }); // revertir
  };
}

export function OccurrenceRow({ occurrence: o, showDate = false }: { occurrence: Occurrence; showDate?: boolean }) {
  const { tasks, pets, memberById, members } = useHousehold();
  const toggle = useToggleOccurrence();
  const [turnoAbierto, setTurnoAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const task = tasks.find((t) => t.id === o.task_id);
  if (!task) return null;
  const pet = pets.find((p) => p.id === task.pet_id);
  const responsable = memberById(o.responsable_id);
  const quien = memberById(o.completada_por);
  const esMed = task.tipo === "medicamento";
  const hoy = todayStr();
  const tieneHora = esMed || !!task.hora_recordatorio;
  const pendiente =
    !o.completada && esMed && (o.fecha < hoy || (o.fecha === hoy && o.hora.slice(0, 5) < nowTimeStr()));

  async function cambiar(memberId: string | null) {
    setError(null);
    const { error } = await getSupabase().rpc("change_turn", { p_occurrence_id: o.id, p_member_id: memberId });
    if (error) return setError(errMsg(error));
    setTurnoAbierto(false);
  }

  return (
    <li className="flex items-center gap-3 border-b-2 border-rosa-claro py-3 last:border-b-0">
      <Checkbox checked={o.completada} onChange={() => toggle(o)} label={`Marcar ${task.titulo}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] font-medium leading-snug ${o.completada ? "text-sec line-through" : ""}`}>
          {occurrenceLabel(task, pet?.nombre)}
          {tieneHora && <span className="text-sec"> · {formatHora(o.hora)}</span>}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-sec">
          {showDate && <span className="inline-block first-letter:uppercase">{formatShort(o.fecha)}</span>}
          {task.modo === "rota" && <span className="tag">Rota</span>}
          {pendiente && <span className="tag tag-alerta">Pendiente</span>}
          {o.completada && quien && <span>Lo hizo {quien.nombre}</span>}
        </div>
      </div>
      <Avatar
        member={responsable}
        juntos={!o.responsable_id}
        onClick={o.completada ? undefined : () => setTurnoAbierto(true)}
        label={`Cambiar quién hace ${task.titulo}`}
      />

      <Sheet open={turnoAbierto} onClose={() => setTurnoAbierto(false)} title="¿Quién lo hace?">
        <p className="mb-4 text-sm text-sec">
          {occurrenceLabel(task, pet?.nombre)}
          {task.modo === "rota" && " · La rotación se reacomoda desde este día."}
        </p>
        <div className="grid gap-2">
          {members.map((m) => (
            <button
              key={m.id}
              className={`btn ${o.responsable_id === m.id ? "btn-primary" : "btn-secondary"} justify-start`}
              onClick={() => cambiar(m.id)}
            >
              <Avatar member={m} size={26} /> {m.nombre}
            </button>
          ))}
          {task.modo !== "rota" && (
            <button className={`btn ${!o.responsable_id ? "btn-primary" : "btn-secondary"} justify-start`} onClick={() => cambiar(null)}>
              <Avatar juntos size={26} /> Los dos
            </button>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
      </Sheet>
    </li>
  );
}

/** Ordena: primero lo que no tiene hora, luego por hora */
export function sortOccurrences(list: Occurrence[], tasks: Task[]) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const conHora = (o: Occurrence) => {
    const t = byId.get(o.task_id);
    return !!t && (t.tipo === "medicamento" || !!t.hora_recordatorio);
  };
  return [...list].sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
    const ha = conHora(a) ? a.hora : "";
    const hb = conHora(b) ? b.hora : "";
    return ha.localeCompare(hb);
  });
}
