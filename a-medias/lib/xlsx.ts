// Plantillas de Excel (.xlsx) con colores de la app y listas desplegables, y lectura de archivos Excel.
import ExcelJS from "exceljs";

const VINO = "FF47131C";
const CREMA = "FFFFFDE9";
const ROSA_CLARO = "FFFFD7E7";
const MAX_FILAS = 300;

export type Columna = {
  nombre: string;
  ancho?: number;
  /** Opciones de una lista desplegable (persona, días, frecuencia) */
  lista?: string[];
  /** Si es false, la lista acepta otros valores con una advertencia (por ejemplo, varios días separados por ;) */
  listaEstricta?: boolean;
  fecha?: boolean;
  hora?: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

export async function plantillaXlsx(hoja: string, columnas: Columna[], ejemplos: string[][]): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(hoja);
  const listas = wb.addWorksheet("Listas", { state: "hidden" });

  ws.columns = columnas.map((c) => ({ header: c.nombre, key: c.nombre, width: c.ancho ?? 18 }));

  const encabezado = ws.getRow(1);
  encabezado.height = 24;
  encabezado.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VINO } };
    cell.font = { bold: true, color: { argb: CREMA } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  ejemplos.forEach((fila) => {
    const r = ws.addRow(fila);
    r.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROSA_CLARO } };
    });
  });

  // Hoja oculta con las opciones de cada lista
  let columnaLista = 0;
  columnas.forEach((c, i) => {
    const col = i + 1;
    let rangoLista: string | null = null;
    if (c.lista && c.lista.length > 0) {
      columnaLista++;
      listas.getCell(1, columnaLista).value = c.nombre;
      c.lista.forEach((valor, j) => {
        listas.getCell(j + 2, columnaLista).value = valor;
      });
      const letra = listas.getColumn(columnaLista).letter;
      rangoLista = `Listas!$${letra}$2:$${letra}$${c.lista.length + 1}`;
    }
    for (let r = 2; r <= MAX_FILAS; r++) {
      const cell = ws.getCell(r, col);
      if (c.fecha) cell.numFmt = "dd/mm/yyyy";
      if (c.hora) cell.numFmt = "hh:mm";
      if (rangoLista) {
        cell.dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [rangoLista],
          showErrorMessage: true,
          errorStyle: c.listaEstricta === false ? "warning" : "error",
          errorTitle: "Revisa el valor",
          error: "Elige una opción de la lista.",
        };
      }
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Texto de una celda, con fechas y horas en el mismo formato que la plantilla */
function textoCelda(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v instanceof Date) {
    if (v.getUTCFullYear() === 1899) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
    return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  }
  const formato = cell.numFmt ?? "";
  if (typeof v === "number" && /h/i.test(formato) && !/[dy]/i.test(formato)) {
    const minutos = Math.round(v * 1440) % 1440;
    return `${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`;
  }
  return (cell.text ?? "").toString().trim();
}

export async function leerXlsx(archivo: File): Promise<{ encabezados: string[]; filas: string[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await archivo.arrayBuffer());
  const ws = wb.worksheets.find((h) => h.name !== "Listas") ?? wb.worksheets[0];
  let encabezados: string[] = [];
  const filas: string[][] = [];
  ws.eachRow((row, numero) => {
    const valores: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) valores.push(textoCelda(row.getCell(c)));
    if (numero === 1) encabezados = valores.map((h) => h.trim().toLowerCase());
    else filas.push(valores);
  });
  return { encabezados, filas: filas.filter((f) => f.some((c) => c.trim() !== "")) };
}
