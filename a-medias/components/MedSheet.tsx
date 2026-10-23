"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { addDays, formatShort, horaInput, todayStr } from "@/lib/dates";
import type { Task } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { ErrorText, Pills, Sheet, errMsg } from "./ui";

const HORAS_POR_DEFECTO: Record<number, string[]> = {
  1: ["08:00"],
  2: ["08:00", "20:00"],
  3: ["08:00", "14:00", "20:00"],
  4: ["06:00", "12:00", "18:00", "00:00"],
};

function sumarHoras(desde: string, horas: number) {
  const [h, m] = desde.split(":").map(Number);
  const total = (h * 60 + m + horas * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function MedSheet({
  open,
  onClose,
  petId,
  task,
}: {
  open: boolean;
  onClose: () => void;
  petId?: string;
  task?: Task | null;
}) {
  const { members, me, household, pets, optimisticRemove, reload } = useHousehold();
  const editando = !!task;

  const [mascota, setMascota] = useState("");
  const [nombre, setNombre] = useState("");
  const [dosis, setDosis] = useState("");
  const [inicio, setInicio] = useState(todayStr());
  const [sinFin, setSinFin] = useState(false);
  const [dias, setDias] = useState(7);
  const [tomas, setTomas] = useState(3);
  const [horas, setHoras] = useState<string[]>(HORAS_POR_DEFECTO[3]);
  const [cadaX, setCadaX] = useState(8);
  const [desde, setDesde] = useState("08:00");
  const [quien, setQuien] = useState("rota");
  const [empieza, setEmpieza] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (task) {
      setMascota(task.pet_id ?? "");
      setNombre(task.titulo);
      setDosis(task.dosis ?? "");
      setInicio(task.fecha_inicio);
      setSinFin(!task.duracion_dias);
      setDias(task.duracion_dias ?? 7);
      setTomas(Math.max(1, task.horas_toma.length));
      setHoras(task.horas_toma.map(horaInput));
      setQuien(task.modo === "fija" ? task.responsable_fijo ?? "rota" : task.modo);
      setEmpieza(task.orden_rotacion[0] ?? me?.id ?? "");
    } else {
      setMascota(petId ?? pets[0]?.id ?? "");
      setNombre("");
      setDosis("");
      setInicio(todayStr());
      setSinFin(false);
      setDias(7);
      setTomas(3);
      setHoras(HORAS_POR_DEFECTO[3]);
      setQuien(members.length > 1 ? "rota" : me?.id ?? "juntos");
      setEmpieza(me?.id ?? "");
    }
    // solo al abrir: que un cambio en tiempo real no borre lo que estás escribiendo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  function cambiarTomas(n: number) {
    setTomas(n);
    setHoras((prev) => (prev.length >= n ? prev.slice(0, n) : [...prev, ...HORAS_POR_DEFECTO[n].slice(prev.length)]));
  }

  function rellenarCadaX() {
    setHoras(Array.from({ length: tomas }, (_, i) => sumarHoras(desde, i * cadaX)));
  }

  const modo = quien === "rota" ? "rota" : quien === "juntos" ? "juntos" : "fija";
  const orden = modo === "rota" ? ([empieza, members.find((m) => m.id !== empieza)?.id].filter(Boolean) as string[]) : [];

  async function guardar() {
    if (!mascota) return setError("Elige la mascota.");
    if (!nombre.trim()) return setError("Escribe el nombre del medicamento.");
    if (!sinFin && (!dias || dias < 1)) return setError("Escribe por cuántos días.");
    if (horas.some((h) => !h)) return setError("Completa la hora de cada toma.");
    setOcupado(true);
    setError(null);
    const ordenCambio = !task || task.orden_rotacion.join() !== orden.join();
    const fila = {
      household_id: household!.id,
      tipo: "medicamento" as const,
      pet_id: mascota,
      titulo: nombre.trim(),
      dosis: dosis.trim() || null,
      frecuencia: "diaria" as const,
      dias_semana: [],
      modo,
      responsable_fijo: modo === "fija" ? quien : null,
      orden_rotacion: orden,
      ...(ordenCambio ? { rotacion_ancla: null, rotacion_ancla_miembro: null } : {}),
      fecha_inicio: inicio,
      duracion_dias: sinFin ? null : dias,
      horas_toma: horas,
      hora_recordatorio: null,
      activa: true,
    };
    const sb = getSupabase();
    const { error } = task ? await sb.from("tasks").update(fila).eq("id", task.id) : await sb.from("tasks").insert(fila);
    setOcupado(false);
    if (error) return setError(errMsg(error));
    // Las tomas se crean en la base: se vuelve a cargar para que aparezcan ya
    reload();
    onClose();
  }

  async function borrar() {
    if (!task || !confirm(`¿Borrar el tratamiento "${task.titulo}" y todas sus tomas?`)) return;
    const { error } = await getSupabase().from("tasks").delete().eq("id", task.id);
    if (error) return setError(errMsg(error));
    optimisticRemove("tasks", task.id);
    onClose();
  }

  const fin = !sinFin && dias > 0 ? addDays(inicio, dias - 1) : null;

  return (
    <Sheet open={open} onClose={onClose} title={editando ? "Editar medicamento" : "Nuevo medicamento"}>
      <div className="space-y-5">
        {!petId && (
          <div>
            <label className="label" htmlFor="med-mascota">
              Mascota
            </label>
            <select id="med-mascota" className="input" value={mascota} onChange={(e) => setMascota(e.target.value)}>
              {pets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <div>
            <label className="label" htmlFor="med-nombre">
              Medicamento
            </label>
            <input id="med-nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Amoxicilina" />
          </div>
          <div>
            <label className="label" htmlFor="med-dosis">
              Dosis
            </label>
            <input id="med-dosis" className="input" value={dosis} onChange={(e) => setDosis(e.target.value)} placeholder="5 ml" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="med-inicio">
              Fecha de inicio
            </label>
            <input id="med-inicio" type="date" className="input" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="med-dias">
              Por cuántos días
            </label>
            <input
              id="med-dias"
              type="number"
              min={1}
              inputMode="numeric"
              className="input"
              value={sinFin ? "" : dias}
              disabled={sinFin}
              onChange={(e) => setDias(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <button className={`pill ${sinFin ? "pill-on" : ""}`} onClick={() => setSinFin(!sinFin)}>
            Sin fecha de fin
          </button>
          <span className="text-xs text-sec">
            {fin ? <>Termina el {formatShort(fin)}</> : "Uso continuo"}
          </span>
        </div>

        <div>
          <span className="label">Tomas por día</span>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} className={`pill w-12 justify-center ${tomas === n ? "pill-on" : ""}`} onClick={() => cambiarTomas(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="card bg-rosa-claro! space-y-3 p-3!">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Cada</span>
            <input
              type="number"
              min={1}
              max={24}
              className="input w-16! px-2! py-1.5!"
              value={cadaX}
              onChange={(e) => setCadaX(Number(e.target.value))}
              aria-label="Cada cuántas horas"
            />
            <span>horas desde las</span>
            <input type="time" className="input w-32! px-2! py-1.5!" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" />
            <button className="btn btn-secondary btn-sm" onClick={rellenarCadaX}>
              Rellenar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {horas.map((h, i) => (
              <div key={i}>
                <label className="label text-xs!" htmlFor={`toma-${i}`}>
                  Toma {i + 1}
                </label>
                <input
                  id={`toma-${i}`}
                  type="time"
                  className="input"
                  value={h}
                  onChange={(e) => setHoras(horas.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <span className="label">¿Quién se la da?</span>
          <Pills
            options={[
              ...members.map((m) => ({ value: m.id, label: m.nombre })),
              ...(members.length > 1 ? [{ value: "rota", label: "Rotar" }] : []),
              { value: "juntos", label: "Juntos" },
            ]}
            value={quien}
            onChange={setQuien}
          />
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
          {modo === "rota" && <p className="mt-2 text-xs text-sec">Cambia cada día: quien tiene el turno da todas las tomas de ese día.</p>}
        </div>

        <ErrorText>{error}</ErrorText>

        <button className="btn btn-primary w-full text-[16px]" onClick={guardar} disabled={ocupado}>
          {ocupado ? "Guardando..." : "Guardar medicamento"} <ArrowRight size={18} />
        </button>
        {editando && (
          <button className="btn btn-secondary w-full" onClick={borrar}>
            <Trash2 size={16} /> Borrar tratamiento
          </button>
        )}
      </div>
    </Sheet>
  );
}
