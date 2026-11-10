"use client";

import { useEffect, useState } from "react";
import { Pill } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, todayStr } from "@/lib/dates";
import type { Occurrence } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { personColors } from "./ui";

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

  if (cargando) return <p className="mb-3 text-xs text-sec">Cargando...</p>;

  const seleccionado = members.find((m) => m.id === seleccion);

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-sec">Hechas:</span>
        {members.map((m) => {
          const c = contar(m.id);
          const on = seleccion === m.id;
          return (
            <button
              key={m.id}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${on ? "border-vino bg-rosa-claro font-semibold" : "border-vino/30"}`}
              onClick={() => onSeleccion(on ? null : m.id)}
              aria-pressed={on}
              aria-label={`${m.nombre}: ${c.tareas} tareas${c.meds ? ` y ${c.meds} tomas de medicamento` : ""}. Ver lo que hizo`}
              title={c.meds ? `${c.tareas} tareas + ${c.meds} tomas de medicamento` : undefined}
            >
              <span className={`h-2.5 w-2.5 rounded-full border border-vino ${personColors(m)}`} />
              {m.nombre} {c.tareas}
              {c.meds > 0 && <span className="inline-flex items-center gap-0.5 text-sec">+{c.meds} <Pill size={11} /></span>}
            </button>
          );
        })}
        {(noSeHicieron > 0 || sinMarcar > 0) && (
          <span className="text-sec">
            {[noSeHicieron > 0 && `${noSeHicieron} no se hicieron`, sinMarcar > 0 && `${sinMarcar} sin marcar`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>
      {seleccionado && (
        <p className="mt-1 text-xs text-sec">
          Viendo lo que hizo {seleccionado.nombre} ·{" "}
          <button className="font-semibold text-accion" onClick={() => onSeleccion(null)}>
            Ver todo
          </button>
        </p>
      )}
    </div>
  );
}
