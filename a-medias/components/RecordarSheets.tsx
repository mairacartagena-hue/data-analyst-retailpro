"use client";

import { useEffect, useState } from "react";
import { Cat, Dog, Trash2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { ageParts, birthFromAge, formatAge, splitTimestamp, toBogotaISO, todayStr } from "@/lib/dates";
import type { Note, Pet, PetEvent, Reminder } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { ErrorText, Pills, Sheet, errMsg, quienOptions } from "./ui";

// ---------------------------------------------------------------
// Recordatorio
// ---------------------------------------------------------------
export function ReminderSheet({ open, onClose, reminder }: { open: boolean; onClose: () => void; reminder?: Reminder | null }) {
  const { household, members, optimistic, optimisticRemove } = useHousehold();
  const [titulo, setTitulo] = useState("");
  const [fecha, setFecha] = useState(todayStr());
  const [hora, setHora] = useState("09:00");
  const [para, setPara] = useState<string>("juntos");
  const [repeticion, setRepeticion] = useState<Reminder["repeticion"]>("ninguna");
  const [aviso, setAviso] = useState(0);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const r = reminder;
    const fh = r ? splitTimestamp(r.fecha_hora) : null;
    setTitulo(r?.titulo ?? "");
    setFecha(fh?.fecha ?? todayStr());
    setHora(fh?.hora ?? "09:00");
    setPara(r && r.responsables.length === 1 ? r.responsables[0] : "juntos");
    setRepeticion(r?.repeticion ?? "ninguna");
    setAviso(r?.aviso_previo_dias ?? 0);
    setNota(r?.nota ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reminder?.id]);

  async function guardar() {
    if (!titulo.trim()) return setError("Escribe qué hay que recordar.");
    const fila = {
      household_id: household!.id,
      titulo: titulo.trim(),
      fecha_hora: toBogotaISO(fecha, hora),
      responsables: para === "juntos" ? [] : [para],
      repeticion,
      aviso_previo_dias: aviso,
      nota: nota.trim() || null,
    };
    const sb = getSupabase();
    const { data, error } = reminder
      ? await sb.from("reminders").update(fila).eq("id", reminder.id).select().single()
      : await sb.from("reminders").insert(fila).select().single();
    if (error) return setError(errMsg(error));
    if (data) optimistic("reminders", data as Reminder);
    onClose();
  }

  async function borrar() {
    if (!reminder) return;
    optimisticRemove("reminders", reminder.id);
    await getSupabase().from("reminders").delete().eq("id", reminder.id);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={reminder ? "Recordatorio" : "Nuevo recordatorio"}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="r-titulo">
            ¿Qué hay que recordar?
          </label>
          <input id="r-titulo" className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Pagar el arriendo" />
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <div>
            <label className="label" htmlFor="r-fecha">
              Fecha
            </label>
            <input id="r-fecha" type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="r-hora">
              Hora
            </label>
            <input id="r-hora" type="time" className="input" value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
        </div>
        <div>
          <span className="label">¿Para quién?</span>
          <Pills
            options={quienOptions(members)}
            value={para}
            onChange={setPara}
          />
        </div>
        <div>
          <span className="label">Se repite</span>
          <Pills<Reminder["repeticion"]>
            options={[
              { value: "ninguna", label: "No" },
              { value: "mensual", label: "Cada mes" },
              { value: "anual", label: "Cada año" },
            ]}
            value={repeticion}
            onChange={setRepeticion}
          />
        </div>
        <AvisoPrevio value={aviso} onChange={setAviso} />
        <div>
          <label className="label" htmlFor="r-nota">
            Nota (opcional)
          </label>
          <textarea id="r-nota" className="input min-h-20" value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary w-full" onClick={guardar}>
          Guardar recordatorio
        </button>
        {reminder && (
          <button className="btn btn-secondary w-full" onClick={borrar}>
            <Trash2 size={16} /> Borrar
          </button>
        )}
      </div>
    </Sheet>
  );
}

function AvisoPrevio({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <span className="label">Avisar antes</span>
      <Pills
        options={[
          { value: "0", label: "Solo ese día" },
          { value: "1", label: "1 día" },
          { value: "3", label: "3 días" },
          { value: "7", label: "1 semana" },
        ]}
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
      />
    </div>
  );
}

// ---------------------------------------------------------------
// Mascota
// ---------------------------------------------------------------
export function PetSheet({
  open,
  onClose,
  pet,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  pet?: Pet | null;
  onCreated?: (id: string) => void;
}) {
  const { household, optimistic, optimisticRemove } = useHousehold();
  const [nombre, setNombre] = useState("");
  const [especie, setEspecie] = useState<Pet["especie"]>("gato");
  const [modoNac, setModoNac] = useState<"fecha" | "aprox" | "no">("no");
  const [fechaNac, setFechaNac] = useState("");
  const [anios, setAnios] = useState(0);
  const [meses, setMeses] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNombre(pet?.nombre ?? "");
    setEspecie(pet?.especie ?? "gato");
    const nac = pet?.fecha_nacimiento ?? null;
    setModoNac(!nac ? "no" : pet?.fecha_nacimiento_aproximada ? "aprox" : "fecha");
    setFechaNac(nac ?? "");
    const partes = nac ? ageParts(nac) : { anios: 0, meses: 0 };
    setAnios(partes.anios);
    setMeses(partes.meses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pet?.id]);

  // Fecha que se guarda: la exacta, una estimada desde la edad, o ninguna
  const nacimiento =
    modoNac === "fecha" ? fechaNac || null : modoNac === "aprox" && anios * 12 + meses > 0 ? birthFromAge(anios, meses) : null;

  async function guardar() {
    if (!nombre.trim()) return setError("¿Cómo se llama?");
    if (modoNac === "fecha" && !fechaNac) return setError("Elige la fecha de nacimiento.");
    if (modoNac === "fecha" && fechaNac > todayStr()) return setError("La fecha de nacimiento no puede ser futura.");
    if (modoNac === "aprox" && anios * 12 + meses <= 0) return setError("Escribe la edad aproximada.");
    const datos = {
      nombre: nombre.trim(),
      especie,
      fecha_nacimiento: nacimiento,
      fecha_nacimiento_aproximada: modoNac === "aprox",
    };
    const sb = getSupabase();
    if (pet) {
      const { error } = await sb.from("pets").update(datos).eq("id", pet.id);
      if (error) return setError(errMsg(error));
      onClose();
    } else {
      const { data, error } = await sb
        .from("pets")
        .insert({ household_id: household!.id, ...datos })
        .select("*")
        .single<Pet>();
      if (error) return setError(errMsg(error));
      optimistic("pets", data); // para que la ficha la encuentre sin esperar a Realtime
      onClose();
      onCreated?.(data.id);
    }
  }

  async function borrar() {
    if (!pet || !confirm(`¿Borrar a ${pet.nombre}? Se borran sus medicamentos, vacunas y controles.`)) return;
    optimisticRemove("pets", pet.id);
    await getSupabase().from("pets").delete().eq("id", pet.id);
    onClose();
    window.location.href = "/recordar";
  }

  return (
    <Sheet open={open} onClose={onClose} title={pet ? "Editar mascota" : "Nueva mascota"}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="pet-nombre">
            Nombre
          </label>
          <input id="pet-nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Michi" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(["gato", "perro"] as const).map((e) => {
            const Icon = e === "gato" ? Cat : Dog;
            return (
              <button
                key={e}
                className={`btn ${especie === e ? "btn-primary" : "btn-secondary"} flex-col py-4`}
                onClick={() => setEspecie(e)}
                aria-pressed={especie === e}
              >
                <Icon size={30} />
                {e === "gato" ? "Gato" : "Perro"}
              </button>
            );
          })}
        </div>
        <div>
          <span className="label">Nacimiento</span>
          <Pills<"fecha" | "aprox" | "no">
            options={[
              { value: "fecha", label: "Sé la fecha" },
              { value: "aprox", label: "Edad aproximada" },
              { value: "no", label: "No sé" },
            ]}
            value={modoNac}
            onChange={setModoNac}
          />
        </div>
        {modoNac === "fecha" && (
          <div>
            <label className="label" htmlFor="pet-nac">
              Fecha de nacimiento
            </label>
            <input
              id="pet-nac"
              type="date"
              className="input"
              max={todayStr()}
              value={fechaNac}
              onChange={(e) => setFechaNac(e.target.value)}
            />
          </div>
        )}
        {modoNac === "aprox" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="pet-anios">
                Años
              </label>
              <input
                id="pet-anios"
                type="number"
                min={0}
                max={40}
                inputMode="numeric"
                className="input"
                value={anios}
                onChange={(e) => setAnios(Math.max(0, Number(e.target.value)))}
              />
            </div>
            <div>
              <label className="label" htmlFor="pet-meses">
                Meses
              </label>
              <input
                id="pet-meses"
                type="number"
                min={0}
                max={11}
                inputMode="numeric"
                className="input"
                value={meses}
                onChange={(e) => setMeses(Math.min(11, Math.max(0, Number(e.target.value))))}
              />
            </div>
          </div>
        )}
        {nacimiento && (
          <p className="rounded-[10px] bg-rosa-claro px-3 py-2 text-sm">
            Edad: <strong>{formatAge(nacimiento, modoNac === "aprox")}</strong>
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary w-full" onClick={guardar}>
          Guardar mascota
        </button>
        {pet && (
          <button className="btn btn-secondary w-full" onClick={borrar}>
            <Trash2 size={16} /> Borrar mascota
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------
// Vacuna / control
// ---------------------------------------------------------------
export function PetEventSheet({
  open,
  onClose,
  petId,
  event,
}: {
  open: boolean;
  onClose: () => void;
  petId: string;
  event?: PetEvent | null;
}) {
  const { members, optimistic, optimisticRemove } = useHousehold();
  const [tipo, setTipo] = useState<PetEvent["tipo"]>("vacuna");
  const [titulo, setTitulo] = useState("");
  const [fecha, setFecha] = useState(todayStr());
  const [repeticion, setRepeticion] = useState<PetEvent["repeticion"]>("ninguna");
  const [aviso, setAviso] = useState(1);
  const [resp, setResp] = useState("juntos");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTipo(event?.tipo ?? "vacuna");
    setTitulo(event?.titulo ?? "");
    setFecha(event?.fecha ?? todayStr());
    setRepeticion(event?.repeticion ?? "anual");
    setAviso(event?.aviso_previo_dias ?? 3);
    setResp(event?.responsable_id ?? "juntos");
    setNota(event?.nota ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id]);

  async function guardar() {
    if (!titulo.trim()) return setError("Escribe el nombre de la vacuna o el control.");
    const fila = {
      pet_id: petId,
      tipo,
      titulo: titulo.trim(),
      fecha,
      repeticion,
      aviso_previo_dias: aviso,
      responsable_id: resp === "juntos" ? null : resp,
      nota: nota.trim() || null,
    };
    const sb = getSupabase();
    const { data, error } = event
      ? await sb.from("pet_events").update(fila).eq("id", event.id).select().single()
      : await sb.from("pet_events").insert(fila).select().single();
    if (error) return setError(errMsg(error));
    if (data) optimistic("petEvents", data as PetEvent);
    onClose();
  }

  async function borrar() {
    if (!event) return;
    optimisticRemove("petEvents", event.id);
    await getSupabase().from("pet_events").delete().eq("id", event.id);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={event ? "Vacuna o control" : "Nueva vacuna o control"}>
      <div className="space-y-4">
        <Pills<PetEvent["tipo"]>
          options={[
            { value: "vacuna", label: "Vacuna" },
            { value: "control", label: "Control" },
            { value: "otro", label: "Otro" },
          ]}
          value={tipo}
          onChange={setTipo}
        />
        <div>
          <label className="label" htmlFor="ev-titulo">
            Nombre
          </label>
          <input
            id="ev-titulo"
            className="input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder={tipo === "vacuna" ? "Triple felina" : "Control general"}
          />
        </div>
        <div>
          <label className="label" htmlFor="ev-fecha">
            Fecha
          </label>
          <input id="ev-fecha" type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div>
          <span className="label">Se repite</span>
          <Pills<PetEvent["repeticion"]>
            options={[
              { value: "ninguna", label: "No" },
              { value: "anual", label: "Cada año" },
            ]}
            value={repeticion}
            onChange={setRepeticion}
          />
        </div>
        <AvisoPrevio value={aviso} onChange={setAviso} />
        <div>
          <span className="label">¿Quién lo lleva?</span>
          <Pills
            options={quienOptions(members)}
            value={resp}
            onChange={setResp}
          />
        </div>
        <div>
          <label className="label" htmlFor="ev-nota">
            Nota (opcional)
          </label>
          <textarea id="ev-nota" className="input min-h-20" value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary w-full" onClick={guardar}>
          Guardar
        </button>
        {event && (
          <button className="btn btn-secondary w-full" onClick={borrar}>
            <Trash2 size={16} /> Borrar
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------
// Nota de la casa
// ---------------------------------------------------------------
export function NoteSheet({ open, onClose, note }: { open: boolean; onClose: () => void; note?: Note | null }) {
  const { household, optimistic, optimisticRemove } = useHousehold();
  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitulo(note?.titulo ?? "");
    setContenido(note?.contenido ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note?.id]);

  async function guardar() {
    if (!titulo.trim()) return setError("Ponle un título a la nota.");
    const fila = { household_id: household!.id, titulo: titulo.trim(), contenido };
    const sb = getSupabase();
    const { data, error } = note
      ? await sb.from("notes").update(fila).eq("id", note.id).select().single()
      : await sb.from("notes").insert(fila).select().single();
    if (error) return setError(errMsg(error));
    if (data) optimistic("notes", data as Note);
    onClose();
  }

  async function borrar() {
    if (!note || !confirm(`¿Borrar la nota "${note.titulo}"?`)) return;
    optimisticRemove("notes", note.id);
    await getSupabase().from("notes").delete().eq("id", note.id);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={note ? "Editar nota" : "Nueva nota"}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="n-titulo">
            Título
          </label>
          <input id="n-titulo" className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Wifi" />
        </div>
        <div>
          <label className="label" htmlFor="n-contenido">
            Contenido
          </label>
          <textarea
            id="n-contenido"
            className="input min-h-36"
            value={contenido}
            onChange={(e) => setContenido(e.target.value)}
            placeholder="Red y clave, medidas, teléfonos..."
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary w-full" onClick={guardar}>
          Guardar nota
        </button>
        {note && (
          <button className="btn btn-secondary w-full" onClick={borrar}>
            <Trash2 size={16} /> Borrar nota
          </button>
        )}
      </div>
    </Sheet>
  );
}
