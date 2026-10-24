// Lee el archivo del extracto: CSV/TXT o Excel (.xlsx).

import { splitCsv } from "./statement";
import { readXlsxRows } from "./xlsx";

export async function readStatementFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return readXlsxRows(await file.arrayBuffer());
  if (name.endsWith(".xls")) throw new Error("Los archivos .xls (Excel antiguo) no se pueden leer. Guárdalo como .xlsx o CSV desde Excel.");
  if (name.endsWith(".pdf")) throw new Error("Los PDF no se pueden leer. Descarga el extracto en Excel (.xlsx) o CSV desde tu banco.");
  return splitCsv(await file.text());
}
