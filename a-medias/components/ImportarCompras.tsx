"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { fechaDesdeTexto, normalizar, parseCsv, plantillaCsv } from "@/lib/csv";
import { todayStr } from "@/lib/dates";
import { CATEGORIAS, CATEGORIAS_MASCOTAS, LISTAS, type Categoria, type NombreLista } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { ErrorText, Sheet, errMsg } from "./ui";

const ENC_DESPENSA = ["nombre", "lista", "categoria", "dias", "ultima_compra", "mascota", "marca", "tipo_comida", "responsable"];
const ENC_LISTA = ["producto", "lista", "cantidad", "categoria", "dias", "mascota", "pedido_por"];

type Op = { tabla: "pantry_products" | "shopping_items"; fila: Record<string, unknown>; idExistente?: string; nombre: string };
type Err = { numero: number; motivo: string };

const buscar = <T extends string>(lista: readonly T[], texto: string): T | undefined =>
  lista.find((x) => normalizar(x) === normalizar(texto));

export function ImportarCompras({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { household, members, pets, pantry, items, lists, reload } = useHousehold();
  const [paso, setPaso] = useState<"inicio" | "revisar">("inicio");
  const [ops, setOps] = useState<Op[]>([]);
  const [errores, setErrores] = useState<Err[]>([]);
  const [tipoArchivo, setTipoArchivo] = useState<"despensa" | "lista" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const m1 = members[0]?.nombre ?? "Persona 1";
  const m2 = members[1]?.nombre ?? m1;
  const p1 = pets[0]?.nombre ?? "Mascota";

  function descargar(nombre: string, texto: string) {
    const blob = new Blob([texto], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  function plantillaDespensa() {
    descargar(
      "plantilla_despensa.csv",
      plantillaCsv(ENC_DESPENSA, [
        ["Cafe molido 500g", "Mercado", "Abarrotes", "30", "20/10/2026", "", "", "", ""],
        ["Detergente liquido", "Mercado", "Aseo", "45", "01/10/2026", "", "", "", ""],
        ["Arena para gato", "Mascotas", "", "30", "15/10/2026", "Todas", "Catsan", "", "Rotar"],
        ["Comida", "Mascotas", "", "30", "10/10/2026", p1, "Royal Canin", "Concentrado seco", m1],
      ]),
    );
  }

  function plantillaLista() {
    descargar(
      "plantilla_lista_compras.csv",
      plantillaCsv(ENC_LISTA, [
        ["Pechuga de pollo", "Mascotas", "1 kg", "Proteina", "7", p1, m1],
        ["Zanahoria", "Mascotas", "500 g", "Frutas y verduras", "", p1, m2],
        ["Hueso carnoso de res", "Mascotas", "2 unidades", "Hueso carnoso", "", p1, m2],
        ["Papel higienico", "Mercado", "2 rollos", "Abarrotes", "30", "", m1],
      ]),
    );
  }

  async function leer(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo || !household) return;
    setError(null);
    const { encabezados, filas } = parseCsv(await archivo.text());
    const col = (fila: string[], nombre: string) => {
      const i = encabezados.indexOf(nombre);
      return i >= 0 ? (fila[i] ?? "").trim() : "";
    };

    const nuevas: Op[] = [];
    const malas: Err[] = [];
    const hoy = todayStr();
    const esDespensa = encabezados.includes("nombre") && encabezados.includes("lista") && encabezados.includes("ultima_compra");
    const esLista = encabezados.includes("producto");
    if (!esDespensa && !esLista) {
      setError("No reconozco el archivo. Usa una de las plantillas (despensa o lista de compras).");
      return;
    }

    filas.forEach((fila, idx) => {
      const numero = idx + 2;
      const fallo = (motivo: string) => malas.push({ numero, motivo });

      if (esDespensa) {
        const nombre = col(fila, "nombre");
        if (!nombre) return fallo("falta el nombre");
        const listaTxt = normalizar(col(fila, "lista"));
        const lista = listaTxt === "mercado" ? "Mercado" : listaTxt === "mascotas" ? "Mascotas" : null;
        if (!lista) return fallo(`lista "${col(fila, "lista")}" debe ser Mercado o Mascotas`);
        const esM = lista === "Mascotas";
        const dias = Number(col(fila, "dias"));
        if (!(dias > 0)) return fallo("dias debe ser un número mayor que 0");
        const ultimaTxt = col(fila, "ultima_compra");
        const ultima = ultimaTxt ? fechaDesdeTexto(ultimaTxt) : hoy;
        if (!ultima) return fallo(`ultima_compra "${ultimaTxt}" no es DD/MM/AAAA`);
        const mascotaTxt = col(fila, "mascota");
        const mascotaN = normalizar(mascotaTxt);

        let categoria: Categoria = "Otros";
        let petId: string | null = null;
        let responsableId: string | null = null;
        let rota = false;
        let marca: string | null = null;
        let tipo: string | null = null;

        if (esM) {
          if (mascotaN && mascotaN !== "todas" && mascotaN !== "ninguna") {
            const p = pets.find((x) => normalizar(x.nombre) === mascotaN);
            if (!p) return fallo(`la mascota "${mascotaTxt}" no existe`);
            petId = p.id;
          }
          const rTxt = col(fila, "responsable");
          const r = normalizar(rTxt);
          if (!r || r === "rotar") rota = true;
          else {
            const persona = members.find((x) => normalizar(x.nombre) === r);
            if (!persona) return fallo(`la persona "${rTxt}" no existe en el hogar`);
            responsableId = persona.id;
          }
          marca = col(fila, "marca") || null;
          tipo = col(fila, "tipo_comida") || null;
        } else {
          if (mascotaN && mascotaN !== "ninguna") return fallo("en Mercado no se usa la columna mascota");
          const catTxt = col(fila, "categoria");
          const cat = catTxt ? buscar(CATEGORIAS, catTxt) : "Abarrotes";
          if (!cat) return fallo(`categoria "${catTxt}" no existe`);
          categoria = cat;
        }

        const existente = pantry.find((p) => normalizar(p.nombre) === normalizar(nombre) && !!p.es_mascotas === esM);
        nuevas.push({
          tabla: "pantry_products",
          nombre,
          idExistente: existente?.id,
          fila: {
            household_id: household.id,
            nombre,
            categoria,
            duracion_dias: dias,
            fecha_ultima_compra: ultima,
            es_mascotas: esM,
            pet_id: petId,
            marca,
            tipo_comida: tipo,
            responsable_id: responsableId,
            rota,
          },
        });
        return;
      }

      // Lista de compras
      const producto = col(fila, "producto");
      if (!producto) return fallo("falta el producto");
      const listaNombre = buscar(LISTAS, col(fila, "lista"));
      if (!listaNombre) return fallo(`lista "${col(fila, "lista")}" no existe (Mercado, Droguería, Para la casa o Mascotas)`);
      const listaId = lists.find((l) => l.nombre === listaNombre)?.id;
      if (!listaId) return fallo(`falta la lista ${listaNombre} en el hogar`);

      let categoria: Categoria = "Otros";
      if (listaNombre === "Mascotas") {
        const catTxt = col(fila, "categoria");
        const cat = catTxt ? buscar(CATEGORIAS_MASCOTAS, catTxt) : "Otros";
        if (!cat) return fallo(`categoria "${catTxt}" no existe para Mascotas`);
        categoria = cat;
      } else if (listaNombre === "Mercado") {
        const catTxt = col(fila, "categoria");
        const cat = catTxt ? buscar(CATEGORIAS, catTxt) : "Abarrotes";
        if (!cat) return fallo(`categoria "${catTxt}" no existe`);
        categoria = cat;
      }

      const diasTxt = col(fila, "dias");
      const duracion = diasTxt ? Number(diasTxt) : null;
      if (duracion !== null && !(duracion > 0)) return fallo("dias debe ser un número mayor que 0");

      let petId: string | null = null;
      const mascotaTxt = col(fila, "mascota");
      const mascotaN = normalizar(mascotaTxt);
      if (listaNombre === "Mascotas" && mascotaN && mascotaN !== "todas" && mascotaN !== "ninguna") {
        const p = pets.find((x) => normalizar(x.nombre) === mascotaN);
        if (!p) return fallo(`la mascota "${mascotaTxt}" no existe`);
        petId = p.id;
      }

      let pedidoPor: string | null = null;
      const pedidoTxt = col(fila, "pedido_por");
      if (pedidoTxt) {
        const persona = members.find((x) => normalizar(x.nombre) === normalizar(pedidoTxt));
        if (!persona) return fallo(`la persona "${pedidoTxt}" no existe en el hogar`);
        pedidoPor = persona.id;
      }

      const cantidad = col(fila, "cantidad") || null;
      const existente = items.find(
        (i) => i.list_id === listaId && !i.comprado && normalizar(i.nombre) === normalizar(producto),
      );
      const categoriaFinal: Categoria = listaNombre === "Droguería" || listaNombre === "Para la casa" ? "Otros" : categoria;
      nuevas.push({
        tabla: "shopping_items",
        nombre: producto,
        idExistente: existente?.id,
        fila: {
          list_id: listaId,
          household_id: household.id,
          nombre: producto,
          categoria: categoriaFinal,
          cantidad,
          duracion_dias: duracion,
          pet_id: petId,
          pedido_por: pedidoPor,
          comprado: false,
        },
      });
    });

    setTipoArchivo(esDespensa ? "despensa" : "lista");
    setOps(nuevas);
    setErrores(malas);
    setPaso("revisar");
  }

  async function confirmar() {
    setGuardando(true);
    setError(null);
    const sb = getSupabase();
    let fallidas = 0;
    for (const op of ops) {
      const { error } = op.idExistente
        ? await sb.from(op.tabla).update(op.fila).eq("id", op.idExistente)
        : await sb.from(op.tabla).insert(op.fila);
      if (error) {
        fallidas++;
        setError(errMsg(error));
      }
    }
    setGuardando(false);
    reload();
    if (fallidas === 0) cerrar();
    else setError(`${fallidas} filas no se pudieron guardar. Las demás sí.`);
  }

  function cerrar() {
    setPaso("inicio");
    setOps([]);
    setErrores([]);
    setTipoArchivo(null);
    setError(null);
    onClose();
  }

  const nuevas = ops.filter((o) => !o.idExistente).length;
  const actualizar = ops.length - nuevas;
  const nombreTipo = tipoArchivo === "despensa" ? "despensa" : "lista de compras";

  return (
    <Sheet open={open} onClose={cerrar} title="Importar compras">
      {paso === "inicio" ? (
        <div className="space-y-4">
          <p className="text-sm">
            <b>1.</b> Descarga la plantilla que necesitas y llénala en <b>Google Sheets</b> (recomendado) o Excel.
          </p>
          <div className="grid gap-2">
            <button className="btn btn-secondary w-full" onClick={plantillaDespensa}>
              Plantilla de despensa
            </button>
            <button className="btn btn-secondary w-full" onClick={plantillaLista}>
              Plantilla de lista de compras
            </button>
          </div>
          <p className="text-xs text-sec">
            En Google Sheets: <b>Archivo → Descargar → Valores separados por comas (.csv)</b>.
          </p>
          <p className="text-sm">
            <b>2.</b> Carga el archivo. La app reconoce si es de despensa o de lista.
          </p>
          <label className="btn btn-primary w-full cursor-pointer">
            Cargar archivo
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={leer} />
          </label>
          <ErrorText>{error}</ErrorText>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            Archivo de <b>{nombreTipo}</b>. Nuevas: <b>{nuevas}</b> · Se actualizan: <b>{actualizar}</b> · Con error:{" "}
            <b>{errores.length}</b>
          </p>
          {errores.length > 0 && (
            <div className="rounded-xl border-2 border-accion p-3 text-sm">
              <p className="mb-1 font-semibold">Estas filas no se cargan:</p>
              <ul className="space-y-1">
                {errores.slice(0, 10).map((e) => (
                  <li key={e.numero}>
                    Fila {e.numero}: {e.motivo}
                  </li>
                ))}
              </ul>
              {errores.length > 10 && <p className="mt-1 text-sec">Y {errores.length - 10} más.</p>}
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn btn-secondary flex-1" onClick={() => setPaso("inicio")} disabled={guardando}>
              Volver
            </button>
            <button className="btn btn-primary flex-1" onClick={confirmar} disabled={ops.length === 0 || guardando}>
              {guardando ? "Guardando…" : `Confirmar (${ops.length})`}
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Sheet>
  );
}
