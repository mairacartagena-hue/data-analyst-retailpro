// Lectura y escritura de CSV para importar datos (acepta coma o punto y coma como separador).

export function parseCsv(texto: string): { encabezados: string[]; filas: string[][] } {
  const limpio = texto.replace(/^﻿/, "");
  const primera = limpio.split(/\r?\n/)[0] ?? "";
  const sep = primera.split(";").length > primera.split(",").length ? ";" : ",";

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  const [encabezados = [], ...resto] = filas;
  return {
    // Quita restos de la marca de codificación (por ejemplo "ï»¿titulo") del primer encabezado
    encabezados: encabezados.map((h) => arreglarTexto(h).trim().toLowerCase().replace(/^[^a-z]+/, "")),
    filas: resto
      .map((f) => f.map(arreglarTexto))
      .filter((f) => f.some((c) => c.trim() !== "")),
  };
}

/**
 * Corrige texto leído con la codificación equivocada (por ejemplo "baÃ±o" -> "baño").
 * Si el texto no tiene ese problema, se devuelve igual.
 */
export function arreglarTexto(t: string): string {
  if (!/[ÃÂ]/.test(t)) return t;
  try {
    return decodeURIComponent(escape(t));
  } catch {
    return t;
  }
}

function celda(valor: string) {
  return /[",\n;]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

export function plantillaCsv(encabezados: string[], ejemplos: string[][]) {
  return [encabezados, ...ejemplos].map((f) => f.map(celda).join(",")).join("\r\n") + "\r\n";
}

/** "25/10/2026" -> "2026-10-25", o null si no es una fecha válida */
export function fechaDesdeTexto(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  const y = Number(m[3]);
  const fecha = new Date(Date.UTC(y, mes - 1, d));
  if (fecha.getUTCDate() !== d || fecha.getUTCMonth() !== mes - 1) return null;
  return `${y}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "8:30" o "08:30" -> "08:30", o null si no es una hora válida */
export function horaDesdeTexto(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Minúsculas y sin tildes, para comparar nombres */
export function normalizar(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}
