// Arma un ZIP con un CSV por sección, con las mismas columnas que las plantillas de importación.
import JSZip from "jszip";
import { plantillaCsv } from "@/lib/csv";
import type { Member, Note, Pet, PetEvent, PantryProduct, Reminder, ShoppingItem, ShoppingList, Task } from "@/lib/types";

export type DatosHogar = {
  nombreHogar: string;
  members: Member[];
  tasks: Task[];
  pets: Pet[];
  petEvents: PetEvent[];
  pantry: PantryProduct[];
  items: ShoppingItem[];
  lists: ShoppingList[];
  reminders: Reminder[];
  notes: Note[];
};

const DIAS = ["", "lun", "mar", "mie", "jue", "vie", "sab", "dom"];

/** "2026-10-25" -> "25/10/2026" */
function fechaCsv(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Fecha y hora de un instante, en la hora de Bogotá */
function fechaHoraBogota(iso: string): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "00";
  return { fecha: `${v("day")}/${v("month")}/${v("year")}`, hora: `${v("hour")}:${v("minute")}` };
}

const si = (b: boolean) => (b ? "si" : "no");

export async function construirRespaldo(d: DatosHogar): Promise<Blob> {
  const nombrePersona = (id: string | null | undefined) => d.members.find((m) => m.id === id)?.nombre ?? "";
  const nombreMascota = (id: string | null | undefined) => d.pets.find((p) => p.id === id)?.nombre ?? "";
  const nombreLista = (id: string) => d.lists.find((l) => l.id === id)?.nombre ?? "";

  // Tareas
  const tareas = d.tasks
    .filter((t) => t.tipo === "tarea")
    .map((t) => [
      t.titulo,
      t.frecuencia,
      t.frecuencia === "semanal" ? t.dias_semana.map((n) => DIAS[n]).filter(Boolean).join(";") : "",
      t.modo === "rota" ? "Rotar" : t.modo === "juntos" ? "Juntos" : nombrePersona(t.responsable_fijo),
      t.hora_recordatorio ? t.hora_recordatorio.slice(0, 5) : "",
      fechaCsv(t.fecha_inicio),
      si(t.activa),
    ]);

  // Despensa (Mercado y Mascotas)
  const despensa = d.pantry.map((p) => {
    const esM = !!p.es_mascotas;
    return [
      p.nombre,
      esM ? "Mascotas" : "Mercado",
      esM ? "" : p.categoria,
      String(p.duracion_dias),
      fechaCsv(p.fecha_ultima_compra),
      esM ? (p.pet_id ? nombreMascota(p.pet_id) : "Todas") : "Ninguna",
      p.marca ?? "",
      p.tipo_comida ?? "",
      p.rota ? "Rotar" : nombrePersona(p.responsable_id),
    ];
  });

  // Lista de compras (todas las listas)
  const lista = d.items.map((i) => [
    i.nombre,
    nombreLista(i.list_id),
    i.cantidad ?? "",
    i.categoria,
    i.duracion_dias ? String(i.duracion_dias) : "",
    nombreMascota(i.pet_id),
    nombrePersona(i.pedido_por),
    si(i.comprado),
  ]);

  // Mascotas con sus vacunas y controles
  const mascotas: string[][] = [];
  for (const p of d.pets) {
    mascotas.push([p.nombre, p.especie, "", "", "", "", "", "", ""]);
    for (const e of d.petEvents.filter((ev) => ev.pet_id === p.id)) {
      mascotas.push([p.nombre, p.especie, e.titulo, e.tipo, fechaCsv(e.fecha), e.repeticion, String(e.aviso_previo_dias), e.responsable_id ? nombrePersona(e.responsable_id) : "Juntos", e.nota ?? ""]);
    }
  }

  // Recordatorios
  const recordatorios = d.reminders.map((r) => {
    const { fecha, hora } = fechaHoraBogota(r.fecha_hora);
    const para = r.responsables.length === 0 ? "Juntos" : nombrePersona(r.responsables[0]);
    return [r.titulo, fecha, hora, para, r.repeticion, String(r.aviso_previo_dias), r.nota ?? ""];
  });

  const notas = d.notes.map((n) => [n.titulo, n.contenido]);
  const personas = d.members.map((m) => [m.nombre, m.color]);

  const zip = new JSZip();
  zip.file("tareas.csv", plantillaCsv(["titulo", "frecuencia", "dias", "responsable", "hora", "fecha_inicio", "activa"], tareas));
  zip.file("despensa.csv", plantillaCsv(["nombre", "lista", "categoria", "dias", "ultima_compra", "mascota", "marca", "tipo_comida", "responsable"], despensa));
  zip.file("lista_compras.csv", plantillaCsv(["producto", "lista", "cantidad", "categoria", "dias", "mascota", "pedido_por", "comprado"], lista));
  zip.file("mascotas_vacunas.csv", plantillaCsv(["mascota", "especie", "evento", "tipo", "fecha", "repeticion", "aviso_previo_dias", "responsable", "nota"], mascotas));
  zip.file("recordatorios.csv", plantillaCsv(["titulo", "fecha", "hora", "para", "repeticion", "aviso_previo_dias", "nota"], recordatorios));
  zip.file("notas.csv", plantillaCsv(["titulo", "contenido"], notas));
  zip.file("personas.csv", plantillaCsv(["nombre", "color"], personas));
  zip.file(
    "LEEME.txt",
    [
      `Respaldo de ${d.nombreHogar}`,
      "",
      "Cada archivo CSV es una sección de la app. Se abren con Google Sheets o Excel.",
      "tareas.csv: tareas de la hoja Tareas.",
      "despensa.csv: productos de la despensa de Mercado y de Mascotas.",
      "lista_compras.csv: lo que hay en las listas de Compras.",
      "mascotas_vacunas.csv: mascotas y sus vacunas y controles.",
      "recordatorios.csv: recordatorios.",
      "notas.csv: notas de la casa.",
      "personas.csv: personas del hogar y su color.",
      "",
      "El historial de tareas hechas no se incluye: solo lo que se configura.",
    ].join("\r\n"),
  );

  return zip.generateAsync({ type: "blob" });
}
