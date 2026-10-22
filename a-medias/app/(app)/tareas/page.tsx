"use client";

import { useState } from "react";
import { Bell, PawPrint, Plus } from "lucide-react";
import { useHousehold } from "@/components/HouseholdProvider";
import { TaskSheet } from "@/components/TaskSheet";
import { MedSheet } from "@/components/MedSheet";
import { Avatar, Empty, PageHeader, Pills } from "@/components/ui";
import { Loading } from "@/components/Loading";
import { DIAS_CORTOS, formatHora } from "@/lib/dates";
import type { Frecuencia, Task } from "@/lib/types";

type Filtro = "todas" | "mias" | "otro" | "rotan" | "mascotas";

const GRUPOS: { f: Frecuencia; titulo: string }[] = [
  { f: "diaria", titulo: "Diarias" },
  { f: "semanal", titulo: "Semanales" },
  { f: "quincenal", titulo: "Quincenales" },
  { f: "mensual", titulo: "Mensuales" },
];

export default function TareasPage() {
  const { ready, tasks, me, other, pets, memberById } = useHousehold();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [abierta, setAbierta] = useState(false);
  const [editar, setEditar] = useState<Task | null>(null);
  const [editarMed, setEditarMed] = useState<Task | null>(null);

  const visibles = tasks
    .filter((t) => t.activa)
    .filter((t) => {
      switch (filtro) {
        case "mias":
          return t.modo === "fija" && t.responsable_fijo === me?.id;
        case "otro":
          return t.modo === "fija" && !!other && t.responsable_fijo === other.id;
        case "rotan":
          return t.modo === "rota";
        case "mascotas":
          return !!t.pet_id;
        default:
          return true;
      }
    })
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));

  function detalle(t: Task) {
    const partes: string[] = [];
    if (t.tipo === "medicamento") {
      partes.push(t.horas_toma.map(formatHora).join(" · "));
      partes.push(t.duracion_dias ? `${t.duracion_dias} días` : "Uso continuo");
    } else if (t.frecuencia === "semanal") {
      partes.push((t.dias_semana.length ? t.dias_semana : []).map((d) => DIAS_CORTOS[d - 1]).join(" "));
    }
    if (t.tipo === "tarea" && t.hora_recordatorio) partes.push(formatHora(t.hora_recordatorio));
    return partes.filter(Boolean).join(" · ");
  }

  return (
    <>
      <PageHeader title="Tareas" subtitle="Todo lo que hay que hacer en la casa" />
      <Pills<Filtro>
        options={[
          { value: "todas", label: "Todas" },
          { value: "mias", label: "Mías" },
          { value: "otro", label: other ? `De ${other.nombre}` : "Del otro" },
          { value: "rotan", label: "Rotan" },
          { value: "mascotas", label: "Mascotas" },
        ]}
        value={filtro}
        onChange={setFiltro}
      />

      {!ready ? (
        <div className="mt-6">
          <Loading />
        </div>
      ) : visibles.length === 0 ? (
        <div className="mt-6">
          <Empty>No hay tareas aquí todavía. Toca + para crear la primera.</Empty>
        </div>
      ) : (
        GRUPOS.map(({ f, titulo }) => {
          const lista = visibles.filter((t) => t.frecuencia === f);
          if (!lista.length) return null;
          return (
            <section key={f}>
              <h2 className="seccion">{titulo}</h2>
              <ul className="card space-y-0 p-0!">
                {lista.map((t) => {
                  const resp = memberById(t.responsable_fijo);
                  const pet = pets.find((p) => p.id === t.pet_id);
                  return (
                    <li key={t.id} className="border-b-2 border-rosa-claro last:border-b-0">
                      <button
                        className="flex w-full items-center gap-3 px-4 py-3 text-left"
                        onClick={() => (t.tipo === "medicamento" ? setEditarMed(t) : setEditar(t))}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                            {pet && t.tipo === "medicamento" ? `${pet.nombre} · ` : ""}
                            {t.titulo}
                            {t.dosis ? ` ${t.dosis}` : ""}
                            {t.modo === "rota" && <span className="tag tag-oscuro">Rota</span>}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-sec">
                            {pet && <PawPrint size={12} />}
                            {t.tipo === "tarea" && t.hora_recordatorio && <Bell size={12} />}
                            {detalle(t) || (t.frecuencia === "diaria" ? "Todos los días" : "")}
                          </p>
                        </div>
                        {t.modo === "juntos" ? (
                          <Avatar juntos size={28} />
                        ) : t.modo === "fija" ? (
                          <Avatar member={resp} size={28} />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      <button
        onClick={() => setAbierta(true)}
        aria-label="Nueva tarea"
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+92px)] right-[max(16px,calc(50%-208px))] z-30 flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-vino bg-accion text-crema"
      >
        <Plus size={30} strokeWidth={2.5} />
      </button>

      <TaskSheet open={abierta || !!editar} task={editar} onClose={() => (setAbierta(false), setEditar(null))} />
      <MedSheet open={!!editarMed} task={editarMed} petId={editarMed?.pet_id ?? undefined} onClose={() => setEditarMed(null)} />
    </>
  );
}
