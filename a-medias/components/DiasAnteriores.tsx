"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, formatLong, todayStr } from "@/lib/dates";
import type { Occurrence } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { OccurrenceRow, sortOccurrences } from "./OccurrenceRow";

// La app carga al inicio solo las últimas 3 semanas de tareas del hogar
const DIAS_CARGADOS = 21;

/** Hoy → "Días anteriores": un día a la vez, con lo que se hizo, quién lo hizo y lo que no se hizo */
export function DiasAnteriores({ persona }: { persona: string }) {
  const { occurrences, tasks, household, optimistic } = useHousehold();
  const hoy = todayStr();
  const [dia, setDia] = useState(addDays(hoy, -1));
  const [cargando, setCargando] = useState(false);
  const [traidos, setTraidos] = useState<Set<string>>(new Set());

  // Días más antiguos que lo cargado: se traen de la base al llegar a ellos
  useEffect(() => {
    if (!household || dia >= addDays(hoy, -DIAS_CARGADOS) || traidos.has(dia)) return;
    let cancelado = false;
    setCargando(true);
    getSupabase()
      .from("task_occurrences")
      .select("*")
      .eq("household_id", household.id)
      .eq("fecha", dia)
      .returns<Occurrence[]>()
      .then(({ data }) => {
        if (cancelado) return;
        (data ?? []).forEach((o) => optimistic("occurrences", o));
        setTraidos((prev) => new Set(prev).add(dia));
        setCargando(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, household?.id]);

  const existe = new Set(tasks.map((t) => t.id));
  const delDia = sortOccurrences(
    occurrences.filter(
      (o) =>
        o.fecha === dia &&
        existe.has(o.task_id) &&
        (persona === "todas" || o.responsable_id === persona || o.completada_por === persona),
    ),
    tasks,
  );
  const hechas = delDia.filter((o) => o.completada).length;
  const noSeHizo = delDia.filter((o) => !o.completada && o.omitida).length;
  const sinMarcar = delDia.length - hechas - noSeHizo;
  const ayer = addDays(hoy, -1);

  return (
    <section className="card">
      <h2 className="titulo text-[20px]">Días anteriores</h2>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button className="btn btn-secondary btn-sm" onClick={() => setDia(addDays(dia, -1))} aria-label="Día anterior">
          <ChevronLeft size={16} />
        </button>
        <p className="text-center text-sm font-semibold first-letter:uppercase">
          {dia === ayer ? "Ayer · " : ""}
          {formatLong(dia)}
        </p>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setDia(addDays(dia, 1))}
          disabled={dia >= ayer}
          aria-label="Día siguiente"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      {dia !== ayer && (
        <button className="mt-1 text-xs font-semibold text-accion" onClick={() => setDia(ayer)}>
          Volver a ayer
        </button>
      )}

      {cargando ? (
        <p className="mt-3 text-sm text-sec">Cargando...</p>
      ) : delDia.length === 0 ? (
        <p className="mt-3 text-sm text-sec">No había tareas este día.</p>
      ) : (
        <>
          <p className="mt-2 text-xs text-sec">
            {hechas} hechas · {noSeHizo} no se hicieron{sinMarcar > 0 && ` · ${sinMarcar} sin marcar`}
          </p>
          <ul className="mt-1">
            {delDia.map((o) => (
              <OccurrenceRow key={o.id} occurrence={o} pasado />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
