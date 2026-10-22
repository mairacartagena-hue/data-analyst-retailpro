import { addDays, daysInMonth, diffDays, isoDow, mondayOf, todayStr, weekDays } from "./dates";
import type { Dismissal, Member, Occurrence, PantryProduct, PetEvent, Reminder, Task } from "./types";

// ---------------------------------------------------------------
// Calendario de una tarea (misma regla que task_desired_occurrences en SQL).
// Solo se usa para la vista previa del panel "Nueva tarea"; las ocurrencias
// reales las crea la base de datos.
// ---------------------------------------------------------------
type TaskLike = Pick<
  Task,
  "frecuencia" | "dias_semana" | "fecha_inicio" | "fecha_fin" | "modo" | "responsable_fijo" | "orden_rotacion"
> & Partial<Pick<Task, "rotacion_ancla" | "rotacion_ancla_miembro">>;

export function isScheduled(t: TaskLike, f: string): boolean {
  if (f < t.fecha_inicio) return false;
  if (t.fecha_fin && f > t.fecha_fin) return false;
  switch (t.frecuencia) {
    case "diaria":
      return true;
    case "semanal": {
      const dias = t.dias_semana.length ? t.dias_semana : [isoDow(t.fecha_inicio)];
      return dias.includes(isoDow(f));
    }
    case "quincenal":
      return diffDays(f, t.fecha_inicio) % 14 === 0;
    case "mensual": {
      const dia = Number(t.fecha_inicio.slice(8, 10));
      return Number(f.slice(8, 10)) === Math.min(dia, daysInMonth(f));
    }
  }
}

export function rotationOrder(t: Pick<Task, "orden_rotacion">, members: Member[]): string[] {
  const ids = [...members].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => m.id);
  return [...t.orden_rotacion.filter((x) => ids.includes(x)), ...ids.filter((x) => !t.orden_rotacion.includes(x))];
}

/** Próximos n turnos desde hoy: [{ fecha, responsable }] */
export function previewTurns(t: TaskLike, members: Member[], n = 4, desde = todayStr()) {
  const orden = rotationOrder(t, members);
  const posAncla = t.rotacion_ancla_miembro ? orden.indexOf(t.rotacion_ancla_miembro) : -1;
  const ancla = posAncla >= 0 ? t.rotacion_ancla ?? null : null;
  const out: { fecha: string; responsable: string | null }[] = [];
  let rnAntes = 0;
  let rnDespues = 0;
  let f = t.fecha_inicio;
  for (let guard = 0; guard < 3000 && out.length < n; guard++, f = addDays(f, 1)) {
    if (t.fecha_fin && f > t.fecha_fin) break;
    if (!isScheduled(t, f)) continue;
    const tras = ancla !== null && f >= ancla;
    const rn = tras ? rnDespues++ : rnAntes++;
    if (f < desde) continue;
    let responsable: string | null = null;
    if (t.modo === "fija") responsable = t.responsable_fijo;
    else if (t.modo === "rota" && orden.length) {
      responsable = tras ? orden[(posAncla + rn) % orden.length] : orden[rn % orden.length];
    }
    out.push({ fecha: f, responsable });
  }
  return out;
}

// ---------------------------------------------------------------
// Balance de la semana: tareas asignadas a cada uno (las "juntos" no cuentan,
// cada toma de medicamento cuenta como una).
// ---------------------------------------------------------------
export function weekBalance(occurrences: Occurrence[], members: Member[], hoy = todayStr()) {
  const lunes = mondayOf(hoy);
  const domingo = addDays(lunes, 6);
  const counts: Record<string, number> = {};
  members.forEach((m) => (counts[m.id] = 0));
  for (const o of occurrences) {
    if (o.fecha < lunes || o.fecha > domingo || !o.responsable_id) continue;
    if (o.responsable_id in counts) counts[o.responsable_id]++;
  }
  return counts;
}

// ---------------------------------------------------------------
// Sugerencias: si un día alguien tiene 2 tareas más que su promedio diario y
// otro día de la semana lo tiene libre, proponer mover una tarea pendiente.
// Nunca medicamentos.
// ---------------------------------------------------------------
export interface Suggestion {
  occurrence: Occurrence;
  task: Task;
  member: Member;
  desde: string;
  hacia: string;
}

export function findSuggestion(
  occurrences: Occurrence[],
  tasks: Task[],
  members: Member[],
  dismissals: Dismissal[],
  monday: string,
  hoy = todayStr(),
): Suggestion | null {
  const dias = weekDays(monday);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const descartes = new Set(dismissals.map((d) => `${d.occurrence_id}|${d.fecha_destino}`));

  for (const m of members) {
    const porDia = dias.map((d) => occurrences.filter((o) => o.fecha === d && o.responsable_id === m.id));
    const total = porDia.reduce((s, l) => s + l.length, 0);
    const promedio = total / 7;
    const libres = dias.filter((d, i) => d >= hoy && porDia[i].length === 0);
    if (!libres.length) continue;

    for (let i = 0; i < 7; i++) {
      if (dias[i] < hoy || porDia[i].length < promedio + 2) continue;
      const candidatas = porDia[i].filter((o) => {
        const t = taskById.get(o.task_id);
        return t && t.tipo === "tarea" && !o.completada;
      });
      for (const o of candidatas) {
        // que la misma tarea no esté ya ese día
        const hacia = libres.find(
          (d) =>
            !descartes.has(`${o.id}|${d}`) &&
            !occurrences.some((x) => x.task_id === o.task_id && x.fecha === d),
        );
        if (hacia) return { occurrence: o, task: taskById.get(o.task_id)!, member: m, desde: dias[i], hacia };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------
// Despensa
// ---------------------------------------------------------------
export function pantryDaysLeft(p: PantryProduct, hoy = todayStr()) {
  return p.duracion_dias - diffDays(hoy, p.fecha_ultima_compra);
}

export function pantryLow(p: PantryProduct, hoy = todayStr()) {
  return pantryDaysLeft(p, hoy) <= p.duracion_dias * 0.2;
}

// ---------------------------------------------------------------
// Medicamentos
// ---------------------------------------------------------------
export function medProgress(t: Task, occurrences: Occurrence[], hoy = todayStr()) {
  const tomasDia = Math.max(1, t.horas_toma.length);
  const propias = occurrences.filter((o) => o.task_id === t.id);
  const hechas = propias.filter((o) => o.completada).length;
  const diaActual = Math.max(1, diffDays(hoy, t.fecha_inicio) + 1);
  const dia = t.duracion_dias ? Math.min(diaActual, t.duracion_dias) : diaActual;
  const referencia = t.fecha_fin && hoy > t.fecha_fin ? t.fecha_fin : hoy;
  const hechasHoy = propias.filter((o) => o.fecha === referencia && o.completada).length;
  const total = t.duracion_dias ? t.duracion_dias * tomasDia : null;
  return {
    dia,
    dias: t.duracion_dias,
    tomaHoy: hechasHoy,
    tomasDia,
    hechas,
    total,
    pct: total ? Math.min(100, Math.round((hechas / total) * 100)) : null,
  };
}

// ---------------------------------------------------------------
// Recordatorios y eventos: próxima fecha (con repetición)
// ---------------------------------------------------------------
export function nextReminderDate(r: Pick<Reminder, "fecha_hora" | "repeticion">, now = new Date()): Date {
  const base = new Date(r.fecha_hora);
  if (r.repeticion === "ninguna" || base >= now) return base;
  for (let n = 1; n < 2400; n++) {
    const d = new Date(base);
    if (r.repeticion === "mensual") d.setUTCMonth(base.getUTCMonth() + n);
    else d.setUTCFullYear(base.getUTCFullYear() + n);
    if (d >= now) return d;
  }
  return base;
}

export function nextPetEventDate(e: Pick<PetEvent, "fecha" | "repeticion">, hoy = todayStr()): string {
  if (e.repeticion === "ninguna" || e.fecha >= hoy) return e.fecha;
  let f = e.fecha;
  for (let i = 0; i < 200 && f < hoy; i++) {
    const [y, m, d] = e.fecha.split("-").map(Number);
    const yy = y + i + 1;
    const dd = Math.min(d, new Date(Date.UTC(yy, m, 0)).getUTCDate());
    f = `${yy}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return f;
}
