// Utilidades de fechas. La app vive en America/Bogota (UTC-5 fijo).
// Las fechas se manejan como texto 'YYYY-MM-DD' y se operan en UTC
// para que no influya la zona del celular.
export const TZ = "America/Bogota";

export function todayStr(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Hora actual en Bogotá como 'HH:MM'. */
export function nowTimeStr(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

function toDate(s: string) {
  return new Date(s + "T00:00:00Z");
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000);
}

/** 1 = lunes ... 7 = domingo */
export function isoDow(s: string): number {
  return ((toDate(s).getUTCDay() + 6) % 7) + 1;
}

export function mondayOf(s: string): string {
  return addDays(s, 1 - isoDow(s));
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function daysInMonth(s: string): number {
  const d = toDate(s);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", ...opts });

/** "miércoles 22 de octubre" */
export function formatLong(s: string): string {
  return fmt({ weekday: "long", day: "numeric", month: "long" }).format(toDate(s));
}

/** "jue 23 oct" */
export function formatShort(s: string): string {
  return fmt({ weekday: "short", day: "numeric", month: "short" }).format(toDate(s)).replace(/\./g, "");
}

export function weekdayName(s: string): string {
  return fmt({ weekday: "long" }).format(toDate(s));
}

export function weekdayShort(s: string): string {
  return fmt({ weekday: "short" }).format(toDate(s)).replace(/\./g, "");
}

export function monthShort(s: string): string {
  return fmt({ month: "short" }).format(toDate(s)).replace(/\./g, "");
}

export function dayNum(s: string): number {
  return toDate(s).getUTCDate();
}

/** '08:00:00' -> '8:00' */
export function formatHora(h: string | null | undefined): string {
  if (!h) return "";
  const [hh, mm] = h.split(":");
  return `${Number(hh)}:${mm}`;
}

/** '08:00:00' -> '08:00' para inputs type=time */
export function horaInput(h: string | null | undefined): string {
  return h ? h.slice(0, 5) : "";
}

/** timestamptz -> { fecha, hora } en Bogotá */
export function splitTimestamp(ts: string): { fecha: string; hora: string } {
  const d = new Date(ts);
  return { fecha: todayStr(d), hora: nowTimeStr(d) };
}

/** fecha + hora de Bogotá -> ISO con offset -05:00 */
export function toBogotaISO(fecha: string, hora: string): string {
  return `${fecha}T${hora.slice(0, 5)}:00-05:00`;
}

export const DIAS_CORTOS = ["L", "M", "X", "J", "V", "S", "D"];
export const DIAS_NOMBRE = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
