"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Cake, Cat, ChevronDown, ChevronUp, Dog, Pencil, Plus, Repeat, Syringe, Stethoscope } from "lucide-react";
import { useHousehold } from "@/components/HouseholdProvider";
import { OccurrenceRow, sortOccurrences } from "@/components/OccurrenceRow";
import { MedSheet } from "@/components/MedSheet";
import { PetEventSheet, PetSheet } from "@/components/RecordarSheets";
import { Avatar, Empty, SectionHeader } from "@/components/ui";
import { Loading } from "@/components/Loading";
import { dayNum, formatAge, formatDateLong, formatHora, formatShort, monthShort, monthYear, todayStr } from "@/lib/dates";
import { medProgress, nextPetEventDate, taskPetIds } from "@/lib/logic";
import type { Member, Occurrence, PetEvent, Task } from "@/lib/types";

export default function MascotaPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, pets, tasks, occurrences, petEvents, memberById } = useHousehold();
  const [editarPet, setEditarPet] = useState(false);
  const [med, setMed] = useState<Task | "nuevo" | null>(null);
  const [evento, setEvento] = useState<PetEvent | "nuevo" | null>(null);
  const hoy = todayStr();

  if (!ready) return <div className="pt-6"><Loading /></div>;
  const pet = pets.find((p) => p.id === id);
  if (!pet) {
    return (
      <div className="pt-10">
        <Empty>
          No encontramos esta mascota. <Link href="/recordar" className="font-semibold text-accion underline">Volver</Link>
        </Empty>
      </div>
    );
  }

  const Icon = pet.especie === "gato" ? Cat : Dog;
  const meds = tasks.filter((t) => t.pet_id === pet.id && t.tipo === "medicamento");
  const activos = meds.filter((t) => t.activa).sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
  const historial = [...meds].sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));
  const otrasTareas = tasks.filter((t) => t.tipo === "tarea" && t.activa && taskPetIds(t).includes(pet.id));
  const eventos = petEvents
    .filter((e) => e.pet_id === pet.id)
    .map((e) => ({ e, proxima: nextPetEventDate(e) }))
    .sort((a, b) => a.proxima.localeCompare(b.proxima));

  return (
    <>
      <div className="flex items-center justify-between pt-5">
        <Link href="/recordar" className="flex items-center gap-1 text-sm font-semibold">
          <ArrowLeft size={18} /> Recordar
        </Link>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditarPet(true)}>
          <Pencil size={14} /> Editar mascota
        </button>
      </div>

      <header className="flex items-center gap-4 pb-2 pt-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-vino bg-rosa">
          <Icon size={32} />
        </span>
        <div>
          <h1 className="titulo text-[44px]">{pet.nombre}</h1>
          <p className="text-sm text-sec">
            {pet.especie === "gato" ? "Gato" : "Perro"}
            {pet.fecha_nacimiento && ` · ${formatAge(pet.fecha_nacimiento, pet.fecha_nacimiento_aproximada)}`}
          </p>
          {pet.fecha_nacimiento && (
            <p className="flex items-center gap-1.5 text-xs text-sec">
              <Cake size={13} />
              {pet.fecha_nacimiento_aproximada
                ? `Nació aprox. en ${monthYear(pet.fecha_nacimiento)}`
                : `Nació el ${formatDateLong(pet.fecha_nacimiento)}`}
            </p>
          )}
        </div>
      </header>

      {/* Medicamentos */}
      <SectionHeader
        title="Medicamentos"
        action={
          <button className="btn btn-secondary btn-sm" onClick={() => setMed("nuevo")}>
            <Plus size={14} /> Medicamento
          </button>
        }
      />

      {activos.length === 0 && <Empty>Sin tratamientos activos.</Empty>}

      <div className="space-y-4">
        {activos.map((t) => {
          const p = medProgress(t, occurrences, hoy);
          const deHoy = sortOccurrences(
            occurrences.filter((o) => o.task_id === t.id && o.fecha === hoy),
            tasks,
          );
          const pendientes = sortOccurrences(
            occurrences.filter((o) => o.task_id === t.id && o.fecha < hoy && !o.completada && !o.omitida),
            tasks,
          );
          return (
            <section key={t.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[17px] font-semibold">
                    {t.titulo} {t.dosis && <span className="text-sec">{t.dosis}</span>}
                  </p>
                  <p className="text-xs text-sec">
                    {t.horas_toma.map(formatHora).join(" · ")} ·{" "}
                    {t.fecha_fin ? `hasta el ${formatShort(t.fecha_fin)}` : "uso continuo"}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  {!(t.modo === "rota" && !deHoy[0]) && (
                    <Avatar
                      member={t.modo === "fija" ? memberById(t.responsable_fijo) : t.modo === "rota" ? memberById(deHoy[0]?.responsable_id) : null}
                      juntos={t.modo === "juntos" || (t.modo === "rota" && !!deHoy[0] && !deHoy[0].responsable_id)} size={28} />
                  )}
                  <button aria-label={`Editar ${t.titulo}`} className="btn btn-secondary btn-sm" onClick={() => setMed(t)}>
                    <Pencil size={14} /> Editar
                  </button>
                </div>
              </div>

              <p className="mt-3 text-[15px] font-semibold">
                {p.dias ? `Día ${p.dia} de ${p.dias}` : `Día ${p.dia}`} · Toma {p.tomaHoy} de {p.tomasDia}
              </p>
              {p.total !== null && (
                <>
                  <div className="mt-2 h-4 overflow-hidden rounded-full border-[3px] border-vino" role="progressbar" aria-valuenow={p.pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-accion" style={{ width: `${p.pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-sec">
                    {p.hechas} de {p.total} tomas dadas
                  </p>
                </>
              )}

              <h3 className="mt-4 text-sm font-semibold">Tomas de hoy</h3>
              {deHoy.length === 0 ? (
                <p className="text-sm text-sec">Hoy no hay tomas.</p>
              ) : (
                <ul>
                  {deHoy.map((o) => (
                    <OccurrenceRow key={o.id} occurrence={o} />
                  ))}
                </ul>
              )}

              {pendientes.length > 0 && (
                <>
                  <h3 className="mt-3 text-sm font-semibold text-accion">Pendientes de días anteriores</h3>
                  <ul>
                    {pendientes.map((o) => (
                      <OccurrenceRow key={o.id} occurrence={o} showDate />
                    ))}
                  </ul>
                </>
              )}
            </section>
          );
        })}
      </div>

      {historial.length > 0 && (
        <>
          <SectionHeader title="Historial de tratamientos" small />
          <ul className="card p-0!">
            {historial.map((t) => (
              <HistorialTratamiento
                key={t.id}
                task={t}
                occurrences={occurrences}
                hoy={hoy}
                memberById={memberById}
                onEditar={() => setMed(t)}
              />
            ))}
          </ul>
        </>
      )}

      {otrasTareas.length > 0 && (
        <>
          <SectionHeader title={`Otras tareas de ${pet.nombre}`} small />
          <ul className="card p-0!">
            {otrasTareas.map((t) => (
              <li key={t.id} className="border-b-2 border-rosa-claro px-4 py-3 text-[15px] font-medium last:border-b-0">
                {t.titulo}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Vacunas y controles */}
      <SectionHeader
        title="Vacunas y controles"
        action={
          <button className="btn btn-secondary btn-sm" onClick={() => setEvento("nuevo")}>
            <Plus size={14} /> Agregar
          </button>
        }
      />
      {eventos.length === 0 ? (
        <Empty>Registra vacunas y controles para que les llegue el aviso.</Empty>
      ) : (
        <ul className="space-y-2">
          {eventos.map(({ e, proxima }) => {
            const EIcon = e.tipo === "vacuna" ? Syringe : Stethoscope;
            const pasada = proxima < hoy;
            return (
              <li key={e.id}>
                <button className={`card flex w-full items-center gap-4 p-3! text-left ${pasada ? "opacity-60" : ""}`} onClick={() => setEvento(e)}>
                  <div className="w-12 shrink-0 text-center">
                    <p className="titulo text-[30px]">{dayNum(proxima)}</p>
                    <p className="text-[11px] font-semibold uppercase text-sec">{monthShort(proxima)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                      <EIcon size={15} /> {e.titulo}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-sec">
                      {e.tipo === "vacuna" ? "Vacuna" : e.tipo === "control" ? "Control" : "Otro"}
                      {e.repeticion === "anual" && (
                        <>
                          · <Repeat size={12} /> cada año
                        </>
                      )}
                      {pasada && " · Ya pasó"}
                    </p>
                  </div>
                  {e.responsable_id ? <Avatar member={memberById(e.responsable_id)} size={26} /> : <Avatar juntos size={26} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <PetSheet open={editarPet} pet={pet} onClose={() => setEditarPet(false)} />
      <MedSheet open={!!med} petId={pet.id} task={med === "nuevo" ? null : med} onClose={() => setMed(null)} />
      <PetEventSheet open={!!evento} petId={pet.id} event={evento === "nuevo" ? null : evento} onClose={() => setEvento(null)} />
    </>
  );
}

/** Un tratamiento en el historial: resumen y, al abrirlo, cada toma con quién la dio */
function HistorialTratamiento({
  task: t,
  occurrences,
  hoy,
  memberById,
  onEditar,
}: {
  task: Task;
  occurrences: Occurrence[];
  hoy: string;
  memberById: (id: string | null | undefined) => Member | undefined;
  onEditar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const tomas = occurrences
    .filter((o) => o.task_id === t.id && o.fecha <= hoy)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora));
  const dadas = tomas.filter((o) => o.completada).length;
  const noSeHizo = tomas.filter((o) => !o.completada && o.omitida).length;
  const porDia = new Map<string, Occurrence[]>();
  for (const o of tomas) porDia.set(o.fecha, [...(porDia.get(o.fecha) ?? []), o]);

  return (
    <li className="border-b-2 border-rosa-claro px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">
            {t.titulo} {t.dosis && <span className="text-sec">{t.dosis}</span>}
          </p>
          <p className="text-xs text-sec">
            {formatShort(t.fecha_inicio)} – {t.fecha_fin ? formatShort(t.fecha_fin) : "sin fin"}
          </p>
          <p className="text-xs text-sec">
            {dadas} dadas{noSeHizo > 0 && ` · ${noSeHizo} no se dieron`}
          </p>
        </div>
        <span className={`tag ${t.activa ? "" : "tag-oscuro"}`}>{t.activa ? "En curso" : "Terminado"}</span>
      </div>
      <div className="mt-2 flex gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onEditar}>
          <Pencil size={14} /> Editar
        </button>
        {tomas.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
            {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {abierto ? "Ocultar tomas" : "Ver tomas"}
          </button>
        )}
      </div>
      {abierto && (
        <div className="mt-3 space-y-2">
          {[...porDia.entries()].map(([fecha, delDia]) => (
            <div key={fecha}>
              <p className="text-xs font-semibold first-letter:uppercase">{formatShort(fecha)}</p>
              <ul className="text-sm">
                {delDia
                  .slice()
                  .sort((a, b) => a.hora.localeCompare(b.hora))
                  .map((o) => {
                    const quien = memberById(o.completada_por);
                    const estado = o.completada
                      ? `Se la dio ${quien?.nombre ?? "alguien"}`
                      : o.omitida
                        ? "No se dio"
                        : o.fecha === hoy
                          ? "Por dar"
                          : "Sin marcar";
                    return (
                      <li key={o.id} className="flex justify-between gap-3 py-0.5">
                        <span className="text-sec">{formatHora(o.hora)}</span>
                        <span className={o.completada ? "" : o.omitida ? "font-semibold text-accion" : "text-sec"}>{estado}</span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
