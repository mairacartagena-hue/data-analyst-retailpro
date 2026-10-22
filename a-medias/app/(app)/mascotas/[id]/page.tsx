"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Cat, Dog, Pencil, Plus, Repeat, Syringe, Stethoscope } from "lucide-react";
import { useHousehold } from "@/components/HouseholdProvider";
import { OccurrenceRow, sortOccurrences } from "@/components/OccurrenceRow";
import { MedSheet } from "@/components/MedSheet";
import { PetEventSheet, PetSheet } from "@/components/RecordarSheets";
import { Avatar, Empty } from "@/components/ui";
import { Loading } from "@/components/Loading";
import { dayNum, formatHora, formatShort, monthShort, todayStr } from "@/lib/dates";
import { medProgress, nextPetEventDate } from "@/lib/logic";
import type { PetEvent, Task } from "@/lib/types";

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
  const terminados = meds.filter((t) => !t.activa).sort((a, b) => (b.fecha_fin ?? "").localeCompare(a.fecha_fin ?? ""));
  const otrasTareas = tasks.filter((t) => t.pet_id === pet.id && t.tipo === "tarea" && t.activa);
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
          <Pencil size={14} /> Editar
        </button>
      </div>

      <header className="flex items-center gap-4 pb-2 pt-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-vino bg-rosa">
          <Icon size={32} />
        </span>
        <div>
          <h1 className="titulo text-[44px]">{pet.nombre}</h1>
          <p className="text-sm text-sec">{pet.especie === "gato" ? "Gato" : "Perro"}</p>
        </div>
      </header>

      {/* Medicamentos */}
      <div className="flex items-baseline justify-between">
        <h2 className="seccion">Medicamentos</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setMed("nuevo")}>
          <Plus size={14} /> Medicamento
        </button>
      </div>

      {activos.length === 0 && <Empty>Sin tratamientos activos.</Empty>}

      <div className="space-y-4">
        {activos.map((t) => {
          const p = medProgress(t, occurrences, hoy);
          const deHoy = sortOccurrences(
            occurrences.filter((o) => o.task_id === t.id && o.fecha === hoy),
            tasks,
          );
          const pendientes = sortOccurrences(
            occurrences.filter((o) => o.task_id === t.id && o.fecha < hoy && !o.completada),
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
                <button aria-label={`Editar ${t.titulo}`} className="rounded-[10px] border-2 border-vino p-1.5" onClick={() => setMed(t)}>
                  <Pencil size={14} />
                </button>
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

      {terminados.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-sec">Historial</h3>
          <ul className="card p-0!">
            {terminados.map((t) => {
              const p = medProgress(t, occurrences, hoy);
              return (
                <li key={t.id} className="flex items-center gap-3 border-b-2 border-rosa-claro px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">
                      {t.titulo} {t.dosis && <span className="text-sec">{t.dosis}</span>}
                    </p>
                    <p className="text-xs text-sec">
                      {formatShort(t.fecha_inicio)} – {t.fecha_fin ? formatShort(t.fecha_fin) : "sin fin"}
                      {p.total !== null && ` · ${p.hechas} de ${p.total} tomas`}
                    </p>
                  </div>
                  <span className="tag tag-oscuro">Terminado</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {otrasTareas.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-sec">Otras tareas de {pet.nombre}</h3>
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
      <div className="flex items-baseline justify-between">
        <h2 className="seccion">Vacunas y controles</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setEvento("nuevo")}>
          <Plus size={14} /> Agregar
        </button>
      </div>
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
