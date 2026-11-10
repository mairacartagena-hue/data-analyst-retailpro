"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, todayStr } from "@/lib/dates";
import type { Occurrence } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { Avatar } from "./ui";

// La app carga al inicio solo las últimas 3 semanas de tareas del hogar
const DIAS_CARGADOS = 21;

/** Semana → consolidado: cuántas tareas hizo cada persona en la semana */
export function SemanaResumen({
  lunes,
  seleccion,
  onSeleccion,
}: {
  lunes: string;
  /** Persona cuyas tareas hechas se están mostrando en la semana */
  seleccion: string | null;
  onSeleccion: (id: string | null) => void;
}) {
  const { occurrences, tasks, members, household, optimistic } = useHousehold();
  const hoy = todayStr();
  const domingo = addDays(lunes, 6);
  const [cargando, setCargando] = useState(false);
  const [traidas, setTraidas] = useState<Set<string>>(new Set());

  // Semanas más antiguas que lo cargado: se traen de la base
  useEffect(() => {
    if (!household || lunes >= addDays(hoy, -DIAS_CARGADOS) || traidas.has(lunes)) return;
    let cancelado = false;
    setCargando(true);
    getSupabase()
      .from("task_occurrences")
      .select("*")
      .eq("household_id", household.id)
      .gte("fecha", lunes)
      .lte("fecha", domingo)
      .returns<Occurrence[]>()
      .then(({ data }) => {
        if (cancelado) return;
        (data ?? []).forEach((o) => optimistic("occurrences", o));
        setTraidas((prev) => new Set(prev).add(lunes));
        setCargando(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lunes, household?.id]);

  if (lunes > hoy) return null;

  const tipoDe = new Map(tasks.map((t) => [t.id, t.tipo]));
  const deLaSemana = occurrences.filter((o) => o.fecha >= lunes && o.fecha <= domingo && tipoDe.has(o.task_id));
  const hechas = deLaSemana.filter((o) => o.completada);
  const contar = (id: string) => {
    const suyas = hechas.filter((o) => o.completada_por === id);
    const meds = suyas.filter((o) => tipoDe.get(o.task_id) === "medicamento").length;
    return { tareas: suyas.length - meds, meds };
  };
  const pasadas = deLaSemana.filter((o) => o.fecha < hoy && !o.completada);
  const noSeHicieron = pasadas.filter((o) => o.omitida).length;
  const sinMarcar = pasadas.length - noSeHicieron;

  return (
    <section className="card mb-4">
      <h2 className="titulo text-[20px]">Quién hizo qué</h2>
      {cargando ? (
        <p className="mt-2 text-sm text-sec">Cargando...</p>
      ) : (
        <>
          <ul className="mt-2 space-y-2">
            {members.map((m) => {
              const c = contar(m.id);
              const on = seleccion === m.id;
              return (
                <li key={m.id}>
                  <button
                    className={`flex w-full items-center gap-3 rounded-[10px] border-2 px-2 py-1.5 text-left ${on ? "border-vino bg-rosa-claro" : "border-transparent"}`}
                    onClick={() => onSeleccion(on ? null : m.id)}
                    aria-pressed={on}
                    aria-label={`Ver lo que hizo ${m.nombre}`}
                  >
                  <Avatar member={m} size={28} />
                  <span className="flex-1 text-[15px] font-semibold">{m.nombre}</span>
                  <span className="text-right text-sm">
                    <span className="font-semibold">
                      {c.tareas} {c.tareas === 1 ? "tarea" : "tareas"}
                    </span>
                    {c.meds > 0 && (
                      <span className="block text-xs text-sec">
                        + {c.meds} {c.meds === 1 ? "toma" : "tomas"} de medicamento
                      </span>
                    )}
                  </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-sec">
            {seleccion ? "Toca de nuevo para ver toda la semana." : "Toca a una persona para ver en la semana lo que hizo."}
          </p>
          {(noSeHicieron > 0 || sinMarcar > 0) && (
            <p className="mt-3 text-xs text-sec">
              {[noSeHicieron > 0 && `${noSeHicieron} no se hicieron`, sinMarcar > 0 && `${sinMarcar} quedaron sin marcar`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
