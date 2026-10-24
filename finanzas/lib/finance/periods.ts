// Periodos de presupuesto: mensual (día de inicio configurable) o quincenal (dos días de corte).
// Las fechas son textos "YYYY-MM-DD" y se calculan en UTC para no depender de la zona del dispositivo.

export type Cycle = "MONTHLY" | "BIWEEKLY";

export interface PeriodSettings {
  cycle: Cycle;
  monthlyStartDay: number; // 1..28
  biweeklyFirstDay: number; // 1..28
  biweeklySecondDay: number; // 2..28, mayor que el primero
}

export interface Period {
  start: string; // inclusive
  end: string; // inclusive
  custom?: boolean;
  name?: string;
}

export const DEFAULT_PERIOD_SETTINGS: PeriodSettings = {
  cycle: "MONTHLY",
  monthlyStartDay: 1,
  biweeklyFirstDay: 1,
  biweeklySecondDay: 16,
};

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ymd(y: number, monthIndex: number, d: number): string {
  // monthIndex puede salirse de 0..11; Date.UTC lo normaliza (ej. -1 = diciembre del año anterior)
  return toIso(new Date(Date.UTC(y, monthIndex, d)));
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isWithin(date: string, period: Period): boolean {
  return date >= period.start && date <= period.end;
}

/** Fecha de hoy en Bogotá (UTC-5, sin horario de verano). */
export function todayBogota(now: Date = new Date()): string {
  return toIso(new Date(now.getTime() - 5 * 60 * 60 * 1000));
}

/** Periodo del ciclo del hogar que contiene la fecha. */
export function periodFor(settings: PeriodSettings, date: string): Period {
  const d = toDate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  if (settings.cycle === "MONTHLY") {
    const s = settings.monthlyStartDay;
    const startMonth = day >= s ? m : m - 1;
    const start = ymd(y, startMonth, s);
    const end = addDays(ymd(y, startMonth + 1, s), -1);
    return { start, end };
  }

  const a = settings.biweeklyFirstDay;
  const b = settings.biweeklySecondDay;
  if (day >= b) return { start: ymd(y, m, b), end: addDays(ymd(y, m + 1, a), -1) };
  if (day >= a) return { start: ymd(y, m, a), end: addDays(ymd(y, m, b), -1) };
  return { start: ymd(y, m - 1, b), end: addDays(ymd(y, m, a), -1) };
}

/** Periodo anterior (n = -1) o siguiente (n = 1), n veces. */
export function shiftPeriod(settings: PeriodSettings, period: Period, n: number): Period {
  let p = period.custom ? periodFor(settings, period.start) : period;
  for (let i = 0; i < Math.abs(n); i++) {
    p = n > 0 ? periodFor(settings, addDays(p.end, 1)) : periodFor(settings, addDays(p.start, -1));
  }
  return p;
}

/** Periodos consecutivos desde el que contiene `fromDate` hasta `until` (incluido). */
export function periodsBetween(settings: PeriodSettings, fromDate: string, until: Period): Period[] {
  const out: Period[] = [];
  let p = periodFor(settings, fromDate);
  // Tope de seguridad: 50 años de quincenas
  for (let guard = 0; guard < 1200 && p.start <= until.start; guard++) {
    out.push(p);
    p = periodFor(settings, addDays(p.end, 1));
  }
  return out;
}

export function daysInPeriod(period: Period): number {
  return Math.round((toDate(period.end).getTime() - toDate(period.start).getTime()) / 86_400_000) + 1;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function monthName(monthIndex: number, long = false): string {
  return (long ? MONTHS_LONG : MONTHS)[monthIndex];
}

/** "1 – 15 oct 2026", "16 oct – 15 nov 2026" u "octubre 2026" si es un mes calendario. */
export function periodLabel(period: Period): string {
  if (period.custom && period.name) return period.name;
  const s = toDate(period.start);
  const e = toDate(period.end);
  const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
  const fullMonth = sameMonth && s.getUTCDate() === 1 && addDays(period.end, 1).endsWith("-01");
  if (fullMonth) return `${MONTHS_LONG[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
  if (sameMonth) return `${s.getUTCDate()} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  const startYear = s.getUTCFullYear() !== e.getUTCFullYear() ? ` ${s.getUTCFullYear()}` : "";
  return `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}${startYear} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
}

export function formatDay(iso: string): string {
  const d = toDate(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
