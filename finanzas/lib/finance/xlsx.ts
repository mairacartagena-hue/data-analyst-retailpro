// Lector mínimo de .xlsx (un .xlsx es un ZIP con XML). Sin dependencias: usa DecompressionStream del navegador.
// Acepta tanto Excel normal (textos compartidos, celdas con referencia A1) como los archivos que generan los bancos
// con otras herramientas (etiquetas con prefijo como <x:c>, textos directos y celdas sin referencia).
// Solo lee la primera hoja. Las fechas guardadas como número de Excel no se convierten (los extractos las traen como texto).

const dec = new TextDecoder("utf-8");

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Descomprime solo los archivos pedidos del ZIP. */
export async function unzipEntries(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no es un .xlsx válido.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + csize);
    out.set(name, dec.decode(method === 0 ? raw : method === 8 ? await inflateRaw(raw) : new Uint8Array()));
  }
  return out;
}

const unescapeXml = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const TAG = (name: string) => `(?:[\\w-]+:)?${name}`;
const textOf = (xml: string) => [...xml.matchAll(new RegExp(`<${TAG("t")}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${TAG("t")}>)`, "g"))].map((m) => m[1] ?? "").join("");

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(new RegExp(`<${TAG("si")}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${TAG("si")}>)`, "g"))].map((m) => unescapeXml(textOf(m[1] ?? "")));
}

function colIndex(letters: string): number {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function numberText(v: string): string {
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n)) return v;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function sheetRows(sheetXml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = new RegExp(`<${TAG("row")}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${TAG("row")}>)`, "g");
  const cellRe = new RegExp(`<${TAG("c")}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${TAG("c")}>)`, "g");
  const valueRe = new RegExp(`<${TAG("v")}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${TAG("v")}>)`);
  const inlineRe = new RegExp(`<${TAG("is")}\\b[^>]*>([\\s\\S]*?)</${TAG("is")}>`);
  for (const rm of sheetXml.matchAll(rowRe)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? "").matchAll(cellRe)) {
      const attrs = cm[1] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      const idx = ref ? colIndex(ref[1]) : next;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? "n";
      const inner = cm[2] ?? "";
      const raw = valueRe.exec(inner)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = unescapeXml(textOf(inlineRe.exec(inner)?.[1] ?? ""));
      else if (type === "b") value = raw === "1" ? "1" : "0";
      else if (type === "e") value = "";
      else if (raw !== undefined) value = type === "n" ? numberText(unescapeXml(raw)) : unescapeXml(raw);
      while (row.length < idx) row.push("");
      row[idx] = value.trim();
      next = idx + 1;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x !== ""));
}

/** Filas de texto de la primera hoja de un .xlsx. */
export async function readXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzipEntries(buf, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const sheets = [...files.keys()].filter((n) => n.startsWith("xl/worksheets/")).sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10));
  if (sheets.length === 0) throw new Error("No encontré ninguna hoja en el archivo de Excel.");
  return sheetRows(files.get(sheets[0])!, sharedStrings(files.get("xl/sharedStrings.xml")));
}
