"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cat, ChevronRight, Dog, PawPrint, Plus, Repeat, StickyNote } from "lucide-react";
import { useHousehold } from "@/components/HouseholdProvider";
import { NoteSheet, PetSheet, ReminderSheet } from "@/components/RecordarSheets";
import { Avatar, Empty, PageHeader } from "@/components/ui";
import { ImportarRecordar } from "@/components/ImportarRecordar";
import { Loading } from "@/components/Loading";
import { dayNum, diffDays, formatAge, formatHora, monthShort, nowTimeStr, splitTimestamp, todayStr, weekdayName } from "@/lib/dates";
import { nextPetEventDate, nextReminderDate } from "@/lib/logic";
import type { Note, Reminder } from "@/lib/types";

interface Proximo {
  key: string;
  fecha: string;
  hora: string | null;
  titulo: string;
  detalle: string;
  repite: boolean;
  responsables: string[];
  reminder?: Reminder;
  petId?: string;
}

function cuandoTexto(fecha: string) {
  const d = diffDays(fecha, todayStr());
  if (d === 0) return "Hoy";
  if (d === 1) return "Mañana";
  if (d < 7) return `El ${weekdayName(fecha)}`;
  return `En ${d} días`;
}

export default function RecordarPage() {
  const router = useRouter();
  const { ready, reminders, petEvents, pets, notes, memberById } = useHousehold();
  const [reminderAbierto, setReminderAbierto] = useState<Reminder | "nuevo" | null>(null);
  const [petAbierta, setPetAbierta] = useState(false);
  const [importar, setImportar] = useState(false);
  const [nota, setNota] = useState<Note | "nueva" | null>(null);

  const ahora = new Date();
  const proximos: Proximo[] = [
    ...reminders.map((r) => {
      const d = nextReminderDate(r, ahora);
      const { fecha, hora } = splitTimestamp(d.toISOString());
      return {
        key: r.id,
        fecha,
        hora,
        titulo: r.titulo,
        detalle: r.nota ?? "",
        repite: r.repeticion !== "ninguna",
        responsables: r.responsables,
        reminder: r,
      };
    }),
    ...petEvents.map((e) => {
      const pet = pets.find((p) => p.id === e.pet_id);
      return {
        key: e.id,
        fecha: nextPetEventDate(e),
        hora: null,
        titulo: `${pet?.nombre ?? "Mascota"} · ${e.titulo}`,
        detalle: e.tipo === "vacuna" ? "Vacuna" : e.tipo === "control" ? "Control" : "Mascota",
        repite: e.repeticion !== "ninguna",
        responsables: e.responsable_id ? [e.responsable_id] : [],
        petId: e.pet_id,
      };
    }),
  ]
    .filter((p) => p.fecha > todayStr() || (p.fecha === todayStr() && (!p.hora || p.hora >= nowTimeStr())))
    .sort((a, b) => (a.fecha + (a.hora ?? "")).localeCompare(b.fecha + (b.hora ?? "")));

  const [destacado, ...resto] = proximos;

  const abrir = (p: Proximo) => (p.reminder ? setReminderAbierto(p.reminder) : router.push(`/mascotas/${p.petId}`));

  return (
    <>
      <PageHeader
        title="Recordar"
        subtitle="Fechas, mascotas y datos de la casa"
        right={
          <button className="btn btn-secondary btn-sm mt-1" onClick={() => setImportar(true)}>
            Importar
          </button>
        }
      />
      <ImportarRecordar open={importar} onClose={() => setImportar(false)} />

      {!ready ? (
        <Loading />
      ) : (
        <>
          {destacado ? (
            <button className="card w-full bg-accion! text-left text-crema" onClick={() => abrir(destacado)}>
              <p className="text-xs font-semibold uppercase tracking-wide text-rosa-claro">Lo próximo · {cuandoTexto(destacado.fecha)}</p>
              <div className="mt-2 flex items-center gap-4">
                <div className="text-center">
                  <p className="titulo text-[52px]">{dayNum(destacado.fecha)}</p>
                  <p className="text-xs font-semibold uppercase">{monthShort(destacado.fecha)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[19px] font-semibold leading-tight">{destacado.titulo}</p>
                  <p className="mt-1 text-sm text-rosa-claro">
                    {destacado.hora ? formatHora(destacado.hora) : "Todo el día"}
                    {destacado.detalle && ` · ${destacado.detalle}`}
                  </p>
                </div>
                <span className="rounded-full bg-crema p-0.5">
                  {destacado.responsables.length === 1 ? (
                    <Avatar member={memberById(destacado.responsables[0])} size={30} />
                  ) : (
                    <Avatar juntos size={30} />
                  )}
                </span>
              </div>
            </button>
          ) : (
            <Empty>No hay recordatorios próximos. Toca &quot;Nuevo&quot; para crear uno.</Empty>
          )}

          {resto.length > 0 && (
            <ul className="mt-4 space-y-2">
              {resto.slice(0, 12).map((p) => (
                <li key={p.key}>
                  <button className="card flex w-full items-center gap-4 p-3! text-left" onClick={() => abrir(p)}>
                    <div className="w-12 shrink-0 text-center">
                      <p className="titulo text-[32px]">{dayNum(p.fecha)}</p>
                      <p className="text-[11px] font-semibold uppercase text-sec">{monthShort(p.fecha)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                        {p.petId && <PawPrint size={14} />}
                        <span className="truncate">{p.titulo}</span>
                      </p>
                      <p className="flex items-center gap-1.5 text-xs text-sec">
                        {cuandoTexto(p.fecha)}
                        {p.hora && ` · ${formatHora(p.hora)}`}
                        {p.repite && <Repeat size={12} />}
                      </p>
                    </div>
                    {p.responsables.length === 1 ? (
                      <Avatar member={memberById(p.responsables[0])} size={26} />
                    ) : (
                      <Avatar juntos size={26} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between">
            <h2 className="seccion">Mascotas</h2>
            <button className="btn btn-secondary btn-sm" onClick={() => setPetAbierta(true)}>
              <Plus size={14} /> Mascota
            </button>
          </div>
          {pets.length === 0 ? (
            <Empty>Agrega a tu gato o perro para llevar sus medicamentos, vacunas y controles.</Empty>
          ) : (
            <ul className="grid grid-cols-2 gap-3">
              {pets.map((p) => {
                const Icon = p.especie === "gato" ? Cat : Dog;
                return (
                  <li key={p.id}>
                    <Link href={`/mascotas/${p.id}`} className="card flex items-center gap-3 p-3!">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-vino bg-rosa-claro">
                        <Icon size={22} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{p.nombre}</span>
                        {p.fecha_nacimiento && (
                          <span className="block truncate text-xs text-sec">
                            {formatAge(p.fecha_nacimiento, p.fecha_nacimiento_aproximada)}
                          </span>
                        )}
                      </span>
                      <ChevronRight size={18} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between">
            <h2 className="seccion">Notas de la casa</h2>
            <button className="btn btn-secondary btn-sm" onClick={() => setNota("nueva")}>
              <Plus size={14} /> Nota
            </button>
          </div>
          {notes.length === 0 ? (
            <Empty>Guarda aquí la clave del wifi, medidas, teléfonos útiles...</Empty>
          ) : (
            <ul className="space-y-2">
              {[...notes]
                .sort((a, b) => a.titulo.localeCompare(b.titulo, "es"))
                .map((n) => (
                  <li key={n.id}>
                    <button className="card w-full p-3! text-left" onClick={() => setNota(n)}>
                      <p className="flex items-center gap-2 text-[15px] font-semibold">
                        <StickyNote size={16} /> {n.titulo}
                      </p>
                      {n.contenido && <p className="mt-1 whitespace-pre-line text-sm text-sec">{n.contenido}</p>}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}

      <ReminderSheet
        open={!!reminderAbierto}
        reminder={reminderAbierto === "nuevo" ? null : reminderAbierto}
        onClose={() => setReminderAbierto(null)}
      />
      <PetSheet open={petAbierta} onClose={() => setPetAbierta(false)} onCreated={(id) => router.push(`/mascotas/${id}`)} />
      <NoteSheet open={!!nota} note={nota === "nueva" ? null : nota} onClose={() => setNota(null)} />
      <button
        onClick={() => setReminderAbierto("nuevo")}
        aria-label="Nuevo recordatorio"
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+92px)] right-[max(16px,calc(50%-208px))] z-30 flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-vino bg-accion text-crema"
      >
        <Plus size={30} strokeWidth={2.5} />
      </button>
    </>
  );
}
