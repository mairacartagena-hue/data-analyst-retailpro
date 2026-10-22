"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { DIAS_CORTOS, DIAS_NOMBRE, formatShort, horaInput, isoDow, todayStr } from "@/lib/dates";
import { previewTurns } from "@/lib/logic";
import type { Frecuencia, Modo, Task } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { Avatar, ErrorText, Pills, Sheet, Switch, errMsg } from "./ui";

const FRECUENCIAS: { value: Frecuencia; label: string }[] = [
  { value: "diaria", label: "Diaria" },
  { value: "semanal", label: "Semanal" },
  { value: "quincenal", label: "Quincenal" },
  { value: "mensual", label: "Mensual" },
];

export function TaskSheet({ open, onClose, task }: { open: boolean; onClose: () => void; task?: Task | null }) {
  const { members, me, household, pets, memberById, optimisticRemove } = useHousehold();
  const editando = !!task;

  const [titulo, setTitulo] = useState("");
  const [quien, setQuien] = useState<string>("rota"); // id de miembro | 'rota' | 'juntos'
  const [empieza, setEmpieza] = useState<string>("");
  const [frecuencia, setFrecuencia] = useState<Frecuencia>("semanal");
  const [dias, setDias] = useState<number[]>([]);
  const [fechaInicio, setFechaInicio] = useState(todayStr());
  const [conRecordatorio, setConRecordatorio] = useState(false);
  const [hora, setHora] = useState("19:00");
  const [petId, setPetId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (task) {
      setTitulo(task.titulo);
      setQuien(task.modo === "fija" ? task.responsable_fijo ?? me?.id ?? "rota" : task.modo);
      setEmpieza(task.orden_rotacion[0] ?? me?.id ?? "");
      setFrecuencia(task.frecuencia);
      setDias(task.dias_semana);
      setFechaInicio(task.fecha_inicio);
      setConRecordatorio(!!task.hora_recordatorio);
      setHora(horaInput(task.hora_recordatorio) || "19:00");
      setPetId(task.pet_id ?? "");
    } else {
      setTitulo("");
      setQuien("rota");
      setEmpieza(me?.id ?? "");
      setFrecuencia("semanal");
      setDias([isoDow(todayStr())]);
      setFechaInicio(todayStr());
      setConRecordatorio(false);
      setHora("19:00");
      setPetId("");
    }
    // solo al abrir: que un cambio en tiempo real no borre lo que estás escribiendo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const modo: Modo = quien === "rota" ? "rota" : quien === "juntos" ? "juntos" : "fija";
  const otroId = members.find((m) => m.id !== empieza)?.id;
  const orden = modo === "rota" ? [empieza, otroId].filter(Boolean) as string[] : [];
  const ordenCambio = !task || task.orden_rotacion.join() !== orden.join();

  const borrador = {
    frecuencia,
    dias_semana: frecuencia === "semanal" ? [...dias].sort() : [],
    fecha_inicio: fechaInicio,
    fecha_fin: null,
    modo,
    responsable_fijo: modo === "fija" ? quien : null,
    orden_rotacion: orden,
    rotacion_ancla: ordenCambio ? null : task?.rotacion_ancla ?? null,
    rotacion_ancla_miembro: ordenCambio ? null : task?.rotacion_ancla_miembro ?? null,
  };
  const vista = useMemo(
    () => (frecuencia === "semanal" && dias.length === 0 ? [] : previewTurns(borrador, members, 4)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(borrador), members],
  );

  async function guardar() {
    if (!titulo.trim()) return setError("Ponle un nombre a la tarea.");
    if (frecuencia === "semanal" && dias.length === 0) return setError("Elige al menos un día.");
    setOcupado(true);
    setError(null);
    const fila = {
      household_id: household!.id,
      titulo: titulo.trim(),
      tipo: "tarea" as const,
      pet_id: petId || null,
      ...borrador,
      hora_recordatorio: conRecordatorio ? hora : null,
    };
    const sb = getSupabase();
    const { error } = task
      ? await sb.from("tasks").update(fila).eq("id", task.id)
      : await sb.from("tasks").insert(fila);
    setOcupado(false);
    if (error) return setError(errMsg(error));
    onClose();
  }

  async function borrar() {
    if (!task || !confirm(`¿Borrar "${task.titulo}"? También se borran sus turnos.`)) return;
    const { error } = await getSupabase().from("tasks").delete().eq("id", task.id);
    if (error) return setError(errMsg(error));
    optimisticRemove("tasks", task.id);
    onClose();
  }

  const opcionesQuien = [
    ...members.map((m) => ({ value: m.id, label: m.nombre })),
    ...(members.length > 1 ? [{ value: "rota", label: "Rotar" }] : []),
    { value: "juntos", label: "Juntos" },
  ];

  return (
    <Sheet open={open} onClose={onClose} title={editando ? "Editar tarea" : "Nueva tarea"}>
      <div className="space-y-5">
        <div>
          <label className="label" htmlFor="titulo">
            Nombre
          </label>
          <input
            id="titulo"
            className="input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ej: Planchar"
            autoFocus={!editando}
          />
        </div>

        <div>
          <span className="label">¿Quién?</span>
          <Pills options={opcionesQuien} value={quien} onChange={setQuien} />
          {modo === "rota" && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-sec">Empieza:</span>
              {members.map((m) => (
                <button key={m.id} className={`pill ${empieza === m.id ? "pill-on" : ""}`} onClick={() => setEmpieza(m.id)}>
                  {m.nombre}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className="label">Frecuencia</span>
          <Pills options={FRECUENCIAS} value={frecuencia} onChange={setFrecuencia} />
        </div>

        {frecuencia === "semanal" && (
          <div>
            <span className="label">Días</span>
            <div className="flex justify-between gap-1">
              {DIAS_CORTOS.map((d, i) => {
                const n = i + 1;
                const on = dias.includes(n);
                return (
                  <button
                    key={d}
                    aria-label={DIAS_NOMBRE[i]}
                    aria-pressed={on}
                    onClick={() => setDias(on ? dias.filter((x) => x !== n) : [...dias, n])}
                    className={`h-10 w-10 rounded-full border-2 border-vino text-sm font-semibold ${on ? "bg-vino text-crema" : ""}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="inicio">
            {frecuencia === "quincenal" ? "Cada 14 días desde" : frecuencia === "mensual" ? "Cada mes, desde" : "Empieza el"}
          </label>
          <input id="inicio" type="date" className="input" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        </div>

        {pets.length > 0 && (
          <div>
            <label className="label" htmlFor="mascota">
              ¿Es de una mascota? (opcional)
            </label>
            <select id="mascota" className="input" value={petId} onChange={(e) => setPetId(e.target.value)}>
              <option value="">No</option>
              {pets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="card bg-rosa-claro! p-3!">
          <p className="label">Próximos 4 turnos</p>
          {vista.length === 0 ? (
            <p className="text-sm text-sec">Elige los días para ver los turnos.</p>
          ) : (
            <ul className="space-y-1.5">
              {vista.map((v) => {
                const m = memberById(v.responsable);
                return (
                  <li key={v.fecha} className="flex items-center justify-between text-sm">
                    <span className="inline-block first-letter:uppercase">{formatShort(v.fecha)}</span>
                    <span className="flex items-center gap-2">
                      {m ? m.nombre : "Juntos"} <Avatar member={m} juntos={!m} size={22} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold">Recordatorio</p>
            <p className="text-xs text-sec">Te llega una notificación ese día</p>
          </div>
          <div className="flex items-center gap-2">
            {conRecordatorio && (
              <input type="time" className="input w-28! py-2!" value={hora} onChange={(e) => setHora(e.target.value)} aria-label="Hora" />
            )}
            <Switch checked={conRecordatorio} onChange={setConRecordatorio} label="Recordatorio" />
          </div>
        </div>

        <ErrorText>{error}</ErrorText>

        <button className="btn btn-primary w-full text-[16px]" onClick={guardar} disabled={ocupado}>
          {ocupado ? "Guardando..." : "Guardar tarea"} <ArrowRight size={18} />
        </button>
        {editando && (
          <button className="btn btn-secondary w-full" onClick={borrar}>
            <Trash2 size={16} /> Borrar tarea
          </button>
        )}
      </div>
    </Sheet>
  );
}
