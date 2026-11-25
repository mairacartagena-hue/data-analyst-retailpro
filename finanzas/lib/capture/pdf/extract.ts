// Extrae de un PDF el texto con su posición, con pdf.js. Solo para el servidor (ruta /api/card-statement).
// Se importa en el momento de usarlo, no al arrancar: si la librería no carga en el servidor, quien llama cae a la lectura con IA.

import type { PdfTextItem } from "./rows";

const MAX_PAGES = 30;
const TIMEOUT_MS = 20_000;

interface PdfJsTextItem {
  str?: unknown;
  transform?: number[];
  width?: number;
}

async function readItems(bytes: Uint8Array): Promise<PdfTextItem[]> {
  const g = globalThis as Record<string, unknown>;
  // pdf.js los usa al cargarse, solo para dibujar páginas (no para leer texto); sin ellos se cae al importarlo sin el módulo nativo de canvas
  g.DOMMatrix ??= class DOMMatrix {};
  g.Path2D ??= class Path2D {};
  // Sin proceso aparte (en serverless no hay dónde cargarlo): se le entrega el código del worker ya importado
  g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const out: PdfTextItem[] = [];
    const pages = Math.min(doc.numPages as number, MAX_PAGES);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const it of content.items as PdfJsTextItem[]) {
        if (typeof it.str !== "string" || !it.transform) continue;
        out.push({ page: p, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, text: it.str });
      }
      page.cleanup();
    }
    return out;
  } finally {
    // Libera el documento (el que se destruye es la tarea de carga, no el documento)
    await task.destroy();
  }
}

/** Texto con posición de todas las páginas (hasta 30). Lanza si el archivo no se puede leer (PDF dañado, con contraseña, o la librería no carga). */
export async function extractPdfItems(bytes: Uint8Array): Promise<PdfTextItem[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readItems(bytes),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("La lectura del PDF tardó demasiado.")), TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
