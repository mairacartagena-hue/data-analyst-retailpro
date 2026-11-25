// Lectura local de PDF: utilidades puras para reconstruir las filas de una tabla a partir del texto con su posición.
// Un PDF no guarda "filas": guarda trozos de texto sueltos con coordenadas. Aquí se vuelven a juntar por altura.

/** Un trozo de texto del PDF con su posición en puntos (la y crece hacia arriba, como en el PDF). */
export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  /** Ancho del texto: x + w es el borde derecho (las columnas de valores se alinean por la derecha). */
  w: number;
  text: string;
}

export interface PdfRow {
  page: number;
  y: number;
  /** De izquierda a derecha, sin los trozos vacíos. */
  items: PdfTextItem[];
}

export const rightEdge = (it: PdfTextItem) => it.x + it.w;

/** Junta los trozos que están a la misma altura (±`tolerance` puntos) en una fila; devuelve las filas página por página, de arriba abajo. */
export function groupRows(items: PdfTextItem[], tolerance = 2): PdfRow[] {
  const byPage = new Map<number, PdfTextItem[]>();
  for (const it of items) {
    if (!it.text.trim()) continue;
    const list = byPage.get(it.page);
    if (list) list.push(it);
    else byPage.set(it.page, [it]);
  }
  const rows: PdfRow[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const list = (byPage.get(page) as PdfTextItem[]).slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const pageRows: PdfRow[] = [];
    for (const it of list) {
      const row = pageRows.find((r) => Math.abs(r.y - it.y) <= tolerance);
      if (row) row.items.push(it);
      else pageRows.push({ page, y: it.y, items: [it] });
    }
    for (const r of pageRows) r.items.sort((a, b) => a.x - b.x);
    rows.push(...pageRows);
  }
  return rows;
}

const MONEY = /^[-−]?\s*(?:\d[\d,]*)?\.\d{2}$/;

/** ¿Es un valor con dos decimales, como "1,814,051.26", "00.00" o "- 39,870.00"? */
export const isMoney = (text: string) => MONEY.test(text.trim());

/** "1,814,051.26" → 1814051.26 (sin signo: el signo se lee aparte). null si no es un valor. */
export function parseMoney(text: string): number | null {
  const t = text.trim();
  if (!MONEY.test(t)) return null;
  const n = Number(t.replace(/^[-−]\s*/, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "ddmmyyyy" o "dd-mm-yyyy" → "AAAA-MM-DD". null si no es una fecha posible. */
export function parseDate(text: string): string | null {
  const m = /^(\d{2})-?(\d{2})-?(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  // Descarta días que no existen en ese mes (31 de noviembre, 30 de febrero…)
  return new Date(`${iso}T00:00:00Z`).getUTCDate() === d ? iso : null;
}
