import { monthName, type Period } from "./periods";

/** Nombre corto de un periodo para gráficos: "oct" si es un mes calendario, "22 sep" si empieza otro día. */
export function shortPeriod(p: Period): string {
  const [, m, d] = p.start.split("-").map(Number);
  const [, , endDay] = p.end.split("-").map(Number);
  const wholeMonth = d === 1 && endDay >= 28;
  return wholeMonth ? monthName(m - 1) : `${d} ${monthName(m - 1)}`;
}
