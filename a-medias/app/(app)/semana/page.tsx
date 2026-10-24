"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";
import { useHousehold } from "@/components/HouseholdProvider";
import { sortOccurrences } from "@/components/OccurrenceRow";
import { Avatar, ErrorText, JUNTOS, PageHeader, Pills, errMsg, personColors } from "@/components/ui";
import { Loading } from "@/components/Loading";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, dayNum, formatHora, formatShort, mondayOf, monthShort, todayStr, weekDays, weekdayName, weekdayShort } from "@/lib/dates";
import { findSuggestion } from "@/lib/logic";

export default function SemanaPage() {
  const { ready, occurrences, tasks, pets, members, dismissals, memberById, household, optimistic } = useHousehold();
  const hoy = todayStr();
  const [lunes, setLunes] = useState(mondayOf(hoy));
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState<string>("todas");
  const dias = weekDays(lunes);
  const activas = new Map(tasks.filter((t) => t.activa || t.tipo === "medicamento").map((t) => [t.id, t]));
  const semana = occurrences.filter((o) => o.fecha >= dias[0] && o.fecha <= dias[6] && activas.has(o.task_id));
  const sugerencia = ready ? findSuggestion(semana, tasks, members, dismissals, lunes, hoy) : null;

  async function mover() {
    if (!sugerencia) return;
    setError(null);
    optimistic("occurrences", { ...sugerencia.occurrence, fecha: sugerencia.hacia });
    const { error } = await getSupabase().rpc("move_occurrence", {
      p_occurrence_id: sugerencia.occurrence.id,
      p_fecha: sugerencia.hacia,
    });
    if (error) {
      optimistic("occurrences", { ...sugerencia.occurrence });
      setError(errMsg(error));
    }
  }

  async function dejar() {
    if (!sugerencia) return;
    setError(null);
    const fila = { household_id: household!.id, occurrence_id: sugerencia.occurrence.id, fecha_destino: sugerencia.hacia };
    optimistic("dismissals", { id: `tmp-${sugerencia.occurrence.id}-${sugerencia.hacia}`, ...fila });
    const { error } = await getSupabase().from("suggestion_dismissals").insert(fila);
    if (error) setError(errMsg(error));
  }

  const rango = `${dayNum(dias[0])} ${monthShort(dias[0])} – ${dayNum(dias[6])} ${monthShort(dias[6])}`;

  return (
    <>
      <PageHeader title="Semana" subtitle={rango} />

      <div className="mb-4 flex items-center justify-between">
        <button className="btn btn-secondary btn-sm" onClick={() => setLunes(addDays(lunes, -7))} aria-label="Semana anterior">
          <ChevronLeft size={16} /> Anterior
        </button>
        {lunes !== mondayOf(hoy) && (
          <button className="text-sm font-semibold text-accion" onClick={() => setLunes(mondayOf(hoy))}>
            Esta semana
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => setLunes(addDays(lunes, 7))} aria-label="Semana siguiente">
          Siguiente <ChevronRight size={16} />
        </button>
      </div>

      <Pills<string>
        className="mb-4"
        options={[{ value: "todas", label: "Todas" }, ...members.map((m) => ({ value: m.id, label: m.nombre }))]}
        value={persona}
        onChange={setPersona}
      />

      {sugerencia && (
        <section className="card mb-4 bg-rosa-claro!">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sec">
            <Lightbulb size={16} /> Sugerencia para {sugerencia.member.nombre}
          </p>
          <p className="mt-2 text-[17px] font-semibold">
            ¿Pasamos &apos;{sugerencia.task.titulo}&apos; al {weekdayName(sugerencia.hacia)}?
          </p>
          <p className="mt-1 text-sm text-sec">
            El {weekdayName(sugerencia.desde)} tiene mucho y el {weekdayName(sugerencia.hacia)} está libre.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary flex-1" onClick={mover}>
              Sí, mover
            </button>
            <button className="btn btn-secondary flex-1" onClick={dejar}>
              Dejar así
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
        </section>
      )}

      {!ready ? (
        <Loading />
      ) : (
        <div className="card p-0!">
          {dias.map((d) => {
            const delDia = sortOccurrences(
              semana.filter((o) => o.fecha === d && (persona === "todas" || o.responsable_id === persona)),
              tasks,
            );
            const esHoy = d === hoy;
            return (
              <div
                key={d}
                className={`grid grid-cols-[52px_1fr] gap-3 border-b-2 border-rosa-claro px-3 py-3 last:border-b-0 ${esHoy ? "bg-rosa-claro/60" : ""}`}
              >
                <div className="text-center" aria-label={formatShort(d)}>
                  <p className={`text-[11px] font-semibold uppercase ${esHoy ? "text-accion" : "text-sec"}`}>{weekdayShort(d)}</p>
                  <p className="titulo text-[26px]">{dayNum(d)}</p>
                </div>
                <div className="flex min-w-0 flex-wrap content-start gap-1.5">
                  {delDia.length === 0 && <span className="self-center text-xs text-sec">Libre</span>}
                  {delDia.map((o) => {
                    const t = activas.get(o.task_id)!;
                    const m = memberById(o.responsable_id);
                    const pet = pets.find((p) => p.id === t.pet_id);
                    const texto =
                      t.tipo === "medicamento" ? `${pet?.nombre ?? ""} · ${t.titulo} ${formatHora(o.hora)}` : t.titulo;
                    return (
                      <span
                        key={o.id}
                        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border-2 border-vino py-1 text-[12px] font-medium ${
                          m ? `px-2.5 ${personColors(m)}` : "bg-rosa-claro pl-1 pr-2.5 text-vino"
                        } ${o.completada ? "line-through opacity-60" : ""} ${o.omitida ? "opacity-40" : ""}`}
                        title={m ? m.nombre : JUNTOS}
                      >
                        {!m && <Avatar juntos size={18} />}
                        <span className="truncate">{texto}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        {members.map((m) => (
          <span key={m.id} className="flex items-center gap-1.5">
            <span className={`h-4 w-4 rounded-full border-2 border-vino ${personColors(m)}`} /> {m.nombre}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <Avatar juntos size={16} /> {JUNTOS}
        </span>
      </div>
    </>
  );
}
