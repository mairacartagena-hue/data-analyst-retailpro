"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useHousehold } from "@/components/HouseholdProvider";
import { PantryCards, diasTexto, usePantrySoon } from "@/components/PantrySoon";
import { Avatar, Checkbox, Empty, ErrorText, PageHeader, Pills, Sheet, errMsg } from "@/components/ui";
import { Loading } from "@/components/Loading";
import { getSupabase } from "@/lib/supabase/client";
import { todayStr } from "@/lib/dates";
import { pantryDaysLeft } from "@/lib/logic";
import { CATEGORIAS, LISTAS, type Categoria, type NombreLista, type PantryProduct, type ShoppingItem, type ShoppingList, type Task } from "@/lib/types";

export default function ComprasPage() {
  const { ready, household, lists, items, me, members, memberById, optimistic, optimisticRemove, pantry, tasks, pets, reload } = useHousehold();
  const [activa, setActiva] = useState<NombreLista>("Mercado");
  const [nombre, setNombre] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("Abarrotes");
  const [duracion, setDuracion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [producto, setProducto] = useState<PantryProduct | "nuevo" | null>(null);
  const pronto = usePantrySoon();

  const lista = lists.find((l) => l.nombre === activa);
  const propios = items.filter((i) => i.list_id === lista?.id);
  const pendientes = propios.filter((i) => !i.comprado);
  const comprados = propios.filter((i) => i.comprado);
  const productos = pantry.filter((p) => (activa === "Mascotas" ? p.es_mascotas : !p.es_mascotas));
  const tareaMascotas = lista?.tarea_id ? tasks.find((t) => t.id === lista.tarea_id) : undefined;
  const quienCompraMascotas = tareaMascotas ? (tareaMascotas.modo === "rota" ? "rotar" : tareaMascotas.responsable_fijo ?? "") : "";

  /** Quién compra para las mascotas: una persona o rotar. Crea o actualiza la tarea semanal. */
  async function cambiarQuienCompraMascotas(valor: string) {
    if (!lista || !household || !valor) return;
    const rota = valor === "rotar";
    const campos = { modo: rota ? "rota" : "fija", responsable_fijo: rota ? null : valor, activa: true };
    const sb = getSupabase();
    if (tareaMascotas) {
      const { data, error } = await sb.from("tasks").update(campos).eq("id", tareaMascotas.id).select().single();
      if (error) return setError(errMsg(error));
      if (data) optimistic("tasks", data as Task);
    } else {
      const hoy = todayStr();
      const diaIso = ((new Date(hoy + "T12:00:00").getDay() + 6) % 7) + 1;
      const { data, error } = await sb
        .from("tasks")
        .insert({
          household_id: household.id,
          titulo: "Comprar para las mascotas",
          tipo: "tarea",
          frecuencia: "semanal",
          dias_semana: [diaIso],
          fecha_inicio: hoy,
          hora_recordatorio: "09:00",
          ...campos,
        })
        .select()
        .single();
      if (error || !data) return setError(error ? errMsg(error) : "No pudimos crear la tarea.");
      optimistic("tasks", data as Task);
      await sb.from("shopping_lists").update({ tarea_id: (data as Task).id }).eq("id", lista.id);
      optimistic("lists", { ...lista, tarea_id: (data as Task).id });
    }
    reload();
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !lista) return;
    setError(null);
    const fila = {
      list_id: lista.id,
      nombre: nombre.trim(),
      cantidad: cantidad.trim() || null,
      categoria: activa === "Droguería" ? ("Otros" as Categoria) : categoria,
      pedido_por: me?.id ?? null,
      duracion_dias: duracion.trim() ? Math.max(1, parseInt(duracion, 10) || 1) : null,
    };
    setNombre("");
    setCantidad("");
    setDuracion("");
    const { data, error } = await getSupabase().from("shopping_items").insert(fila).select().single();
    if (error) return setError(errMsg(error));
    if (data) optimistic("items", data as ShoppingItem);
  }

  async function toggle(i: ShoppingItem) {
    // Con duración: al comprarlo pasa a la Despensa y empieza a contar desde hoy
    if (!i.comprado && i.duracion_dias && !i.pantry_product_id) {
      return comprarADespensa(i);
    }
    optimistic("items", { ...i, comprado: !i.comprado });
    const { error } = await getSupabase().from("shopping_items").update({ comprado: !i.comprado }).eq("id", i.id);
    if (error) optimistic("items", { ...i });
  }

  async function comprarADespensa(i: ShoppingItem) {
    const sb = getSupabase();
    const hoy = todayStr();
    optimistic("items", { ...i, comprado: true });
    const existente = pantry.find((p) => p.nombre.trim().toLowerCase() === i.nombre.trim().toLowerCase());
    const { data: prod, error: errProd } = existente
      ? await sb
          .from("pantry_products")
          .update({ duracion_dias: i.duracion_dias, fecha_ultima_compra: hoy })
          .eq("id", existente.id)
          .select()
          .single()
      : await sb
          .from("pantry_products")
          .insert({
            household_id: i.household_id,
            nombre: i.nombre,
            categoria: i.categoria,
            duracion_dias: i.duracion_dias,
            fecha_ultima_compra: hoy,
          })
          .select()
          .single();
    if (errProd || !prod) {
      optimistic("items", { ...i });
      return setError(errProd ? errMsg(errProd) : "No pudimos pasar el producto a la Despensa.");
    }
    optimistic("pantry", prod as PantryProduct);
    const { data: it, error } = await sb
      .from("shopping_items")
      .update({ comprado: true, pantry_product_id: (prod as PantryProduct).id })
      .eq("id", i.id)
      .select()
      .single();
    if (error) {
      optimistic("items", { ...i });
      return setError(errMsg(error));
    }
    if (it) optimistic("items", it as ShoppingItem);
  }

  async function borrarComprados() {
    const ids = comprados.map((i) => i.id);
    ids.forEach((id) => optimisticRemove("items", id));
    await getSupabase().from("shopping_items").delete().in("id", ids);
  }

  async function borrar(i: ShoppingItem) {
    optimisticRemove("items", i.id);
    await getSupabase().from("shopping_items").delete().eq("id", i.id);
  }

  async function actualizarLista(campos: Partial<Pick<ShoppingList, "quien_va" | "va_juntos" | "fecha">>) {
    if (!lista || !household) return;
    const nueva: ShoppingList = { ...lista, ...campos };
    optimistic("lists", nueva);
    const { error } = await getSupabase().from("shopping_lists").update(campos).eq("id", lista.id);
    if (error) return setError(errMsg(error));
    await sincronizarTarea(nueva);
  }

  /** Quién va + fecha = una tarea en Tareas ("Ir a comprar: Mercado"). Sin alguno de los dos, no hay tarea. */
  async function sincronizarTarea(l: ShoppingList) {
    if (!household) return;
    const sb = getSupabase();
    const quien = l.va_juntos || !!l.quien_va;
    const titulo = `Ir a comprar: ${l.nombre}`;

    if (l.fecha && quien) {
      const fila = {
        household_id: household.id,
        titulo,
        tipo: "tarea" as const,
        frecuencia: "diaria" as const,
        modo: l.va_juntos ? ("juntos" as const) : ("fija" as const),
        responsable_fijo: l.va_juntos ? null : l.quien_va,
        fecha_inicio: l.fecha,
        fecha_fin: l.fecha,
        hora_recordatorio: "08:00",
        activa: true,
      };
      if (l.tarea_id) {
        const { data, error } = await sb.from("tasks").update(fila).eq("id", l.tarea_id).select().single();
        if (error) return setError(errMsg(error));
        if (data) optimistic("tasks", data as Task);
      } else {
        const { data, error } = await sb.from("tasks").insert(fila).select().single();
        if (error || !data) return setError(error ? errMsg(error) : "No pudimos crear la tarea.");
        optimistic("tasks", data as Task);
        await sb.from("shopping_lists").update({ tarea_id: (data as Task).id }).eq("id", l.id);
        optimistic("lists", { ...l, tarea_id: (data as Task).id });
      }
    } else if (l.tarea_id) {
      await sb.from("tasks").update({ activa: false }).eq("id", l.tarea_id);
      optimistic("tasks", { ...(tasks.find((t) => t.id === l.tarea_id) as Task), activa: false });
    }
  }

  /** Valor del selector: "" sin definir, "juntos" o el id de la persona */
  function cambiarVa(valor: string) {
    if (valor === "juntos") return actualizarLista({ quien_va: null, va_juntos: true });
    return actualizarLista({ quien_va: valor || null, va_juntos: false });
  }

  const categorias = CATEGORIAS.filter((c) => pendientes.some((i) => i.categoria === c));

  return (
    <>
      <PageHeader title="Compras" subtitle="Lo que hay que traer" />
      <Pills<NombreLista> options={LISTAS.map((l) => ({ value: l, label: l }))} value={activa} onChange={setActiva} />

      {!ready ? (
        <div className="mt-6">
          <Loading />
        </div>
      ) : (
        <>
          {lista && activa !== "Mascotas" && (
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-sec">Va:</span>
              <select
                className="input w-auto! py-1.5!"
                value={lista.va_juntos ? "juntos" : lista.quien_va ?? ""}
                onChange={(e) => cambiarVa(e.target.value)}
                aria-label="Quién va"
              >
                {!lista.quien_va && !lista.va_juntos && (
                  <option value="" disabled>
                    Quién va
                  </option>
                )}
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
                <option value="juntos">Los dos</option>
              </select>
              <input
                type="date"
                className="input w-auto! flex-1 py-1.5!"
                value={lista.fecha ?? ""}
                onChange={(e) => actualizarLista({ fecha: e.target.value || null })}
                aria-label="Cuándo"
              />
            </div>
          )}

          {lista && activa === "Mascotas" && (
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-sec">Compra:</span>
              <select
                className="input w-auto! py-1.5!"
                value={quienCompraMascotas}
                onChange={(e) => cambiarQuienCompraMascotas(e.target.value)}
                aria-label="Quién compra para las mascotas"
              >
                {!quienCompraMascotas && (
                  <option value="" disabled>
                    Quién compra
                  </option>
                )}
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
                <option value="rotar">Rotar</option>
              </select>
            </div>
          )}

          {activa === "Mercado" && pronto.length > 0 && (
            <section>
              <h2 className="seccion">Se termina pronto</h2>
              <PantryCards />
            </section>
          )}

          <form onSubmit={agregar} className="card mt-5 space-y-2 p-3!">
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Agregar producto"
                aria-label="Producto"
              />
              <input className="input w-20!" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Cant." aria-label="Cantidad" />
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                inputMode="numeric"
                className="input flex-1"
                value={duracion}
                onChange={(e) => setDuracion(e.target.value)}
                placeholder="Días que dura (opcional)"
                aria-label="Días que dura"
              />
            </div>
            <div className="flex gap-2">
              {activa !== "Droguería" && (
                <select className="input flex-1" value={categoria} onChange={(e) => setCategoria(e.target.value as Categoria)} aria-label="Categoría">
                  {CATEGORIAS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
              <button className="btn btn-primary flex-1" disabled={!nombre.trim()}>
                <Plus size={18} /> Agregar
              </button>
            </div>
            <ErrorText>{error}</ErrorText>
          </form>

          {pendientes.length === 0 && comprados.length === 0 && (
            <div className="mt-5">
              <Empty>La lista está vacía.</Empty>
            </div>
          )}

          {categorias.map((c) => (
            <section key={c}>
              <h2 className="seccion text-[17px]!">{c}</h2>
              <ul className="card p-0!">
                {pendientes
                  .filter((i) => i.categoria === c)
                  .map((i) => (
                    <ItemRow key={i.id} item={i} onToggle={() => toggle(i)} onDelete={() => borrar(i)} pedidoPor={memberById(i.pedido_por)} />
                  ))}
              </ul>
            </section>
          ))}

          {comprados.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between">
                <h2 className="seccion text-[17px]!">Comprado</h2>
                <button className="text-sm font-semibold text-accion" onClick={borrarComprados}>
                  Limpiar
                </button>
              </div>
              <ul className="card p-0!">
                {comprados.map((i) => (
                  <ItemRow key={i.id} item={i} onToggle={() => toggle(i)} onDelete={() => borrar(i)} pedidoPor={memberById(i.pedido_por)} />
                ))}
              </ul>
            </section>
          )}

          {(activa === "Mercado" || activa === "Mascotas") && (
            <section>
              <div className="flex items-baseline justify-between">
                <h2 className="seccion">{activa === "Mascotas" ? "Despensa de mascotas" : "Despensa"}</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => setProducto("nuevo")}>
                  <Plus size={14} /> Producto
                </button>
              </div>
              <p className="-mt-1 mb-3 text-xs text-sec">
                Cuando a un producto le queda el 20% o menos, se agrega solo a Mercado con la etiqueta AUTO.
              </p>
              {productos.length === 0 ? (
                <Empty>Agrega lo que siempre compran (café, arroz, jabón) y cuántos días les dura.</Empty>
              ) : (
                <ul className="card p-0!">
                  {[...productos]
                    .sort((a, b) => pantryDaysLeft(a) - pantryDaysLeft(b))
                    .map((p) => {
                      const d = pantryDaysLeft(p);
                      const pct = Math.max(0, Math.min(100, (d / p.duracion_dias) * 100));
                      return (
                        <li key={p.id} className="border-b-2 border-rosa-claro last:border-b-0">
                          <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setProducto(p)}>
                            <div className="min-w-0 flex-1">
                              <p className="text-[15px] font-semibold">{p.nombre}</p>
                              {(p.pet_id || p.marca || p.tipo_comida) && (
                                <p className="text-xs text-sec">
                                  {[pets.find((x) => x.id === p.pet_id)?.nombre, p.marca, p.tipo_comida].filter(Boolean).join(" · ")}
                                </p>
                              )}
                              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full border-2 border-vino">
                                <div className={`h-full ${pct <= 20 ? "bg-accion" : "bg-rosa"}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                            <span className={`w-24 text-right text-xs font-semibold ${pct <= 20 ? "text-accion" : "text-sec"}`}>
                              {diasTexto(d)}
                            </span>
                            <Pencil size={14} className="text-sec" />
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <PantrySheet producto={producto} onClose={() => setProducto(null)} paraMascotas={activa === "Mascotas"} />
    </>
  );
}

function ItemRow({
  item: i,
  onToggle,
  onDelete,
  pedidoPor,
}: {
  item: ShoppingItem;
  onToggle: () => void;
  onDelete: () => void;
  pedidoPor?: ReturnType<ReturnType<typeof useHousehold>["memberById"]>;
}) {
  return (
    <li className="flex items-center gap-3 border-b-2 border-rosa-claro px-4 py-3 last:border-b-0">
      <Checkbox checked={i.comprado} onChange={onToggle} label={`Comprado ${i.nombre}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] font-medium ${i.comprado ? "text-sec line-through" : ""}`}>
          {i.nombre}
          {i.cantidad && <span className="text-sec"> · {i.cantidad}</span>}
        </p>
      </div>
      {i.es_automatico && <span className="tag tag-oscuro">Auto</span>}
      {pedidoPor && <Avatar member={pedidoPor} size={24} label={`Lo pidió ${pedidoPor.nombre}`} />}
      <button onClick={onDelete} aria-label={`Borrar ${i.nombre}`} className="p-1 text-sec">
        <Trash2 size={16} />
      </button>
    </li>
  );
}

function PantrySheet({
  producto,
  onClose,
  paraMascotas = false,
}: {
  producto: PantryProduct | "nuevo" | null;
  onClose: () => void;
  paraMascotas?: boolean;
}) {
  const { household, pets, optimistic, optimisticRemove } = useHousehold();
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("Abarrotes");
  const [petId, setPetId] = useState("");
  const [marca, setMarca] = useState("");
  const [tipoComida, setTipoComida] = useState("");
  const [duracion, setDuracion] = useState(30);
  const [ultima, setUltima] = useState(todayStr());
  const [error, setError] = useState<string | null>(null);
  const editando = producto && producto !== "nuevo" ? producto : null;

  useEffect(() => {
    if (!producto) return;
    setError(null);
    setNombre(editando?.nombre ?? "");
    setCategoria(editando?.categoria ?? "Abarrotes");
    setPetId(editando?.pet_id ?? "");
    setMarca(editando?.marca ?? "");
    setTipoComida(editando?.tipo_comida ?? "");
    setDuracion(editando?.duracion_dias ?? 30);
    setUltima(editando?.fecha_ultima_compra ?? todayStr());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto]);

  async function guardar() {
    const mascota = pets.find((p) => p.id === petId);
    // Si es comida de una mascota, el nombre puede quedar vacío: se arma solo
    const nombreFinal = nombre.trim() || (mascota ? `Comida de ${mascota.nombre}` : "");
    if (!nombreFinal || duracion < 1) return setError("Completa el nombre y los días.");
    const fila = {
      household_id: household!.id,
      nombre: nombreFinal,
      categoria,
      duracion_dias: duracion,
      fecha_ultima_compra: ultima,
      pet_id: mascota ? mascota.id : null,
      es_mascotas: mascota ? true : editando ? !!editando.es_mascotas : paraMascotas,
      marca: mascota && marca.trim() ? marca.trim() : null,
      tipo_comida: mascota && tipoComida.trim() ? tipoComida.trim() : null,
    };
    const sb = getSupabase();
    const { data, error } = editando
      ? await sb.from("pantry_products").update(fila).eq("id", editando.id).select().single()
      : await sb.from("pantry_products").insert(fila).select().single();
    if (error) return setError(errMsg(error));
    if (data) optimistic("pantry", data as PantryProduct);
    onClose();
  }

  async function borrar() {
    if (!editando) return;
    optimisticRemove("pantry", editando.id);
    await getSupabase().from("pantry_products").delete().eq("id", editando.id);
    onClose();
  }

  return (
    <Sheet open={!!producto} onClose={onClose} title={editando ? "Producto" : "Nuevo producto"}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="p-nombre">
            Nombre
          </label>
          <input id="p-nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Café" />
        </div>
        <div>
          <label className="label" htmlFor="p-cat">
            Categoría
          </label>
          <select id="p-cat" className="input" value={categoria} onChange={(e) => setCategoria(e.target.value as Categoria)}>
            {CATEGORIAS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-mascota">
            Es comida de
          </label>
          <select id="p-mascota" className="input" value={petId} onChange={(e) => setPetId(e.target.value)}>
            <option value="">Nadie (producto de casa)</option>
            {pets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        {petId && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="p-marca">
                Marca
              </label>
              <input id="p-marca" className="input" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Ej. Royal Canin" />
            </div>
            <div>
              <label className="label" htmlFor="p-tipo">
                Tipo
              </label>
              <input
                id="p-tipo"
                list="tipos-comida"
                className="input"
                value={tipoComida}
                onChange={(e) => setTipoComida(e.target.value)}
                placeholder="Concentrado seco"
              />
              <datalist id="tipos-comida">
                <option value="Concentrado seco" />
                <option value="Concentrado húmedo (lata)" />
                <option value="Natural (casera)" />
              </datalist>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="p-dur">
              Les dura (días)
            </label>
            <input id="p-dur" type="number" min={1} className="input" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor="p-ult">
              Última compra
            </label>
            <input id="p-ult" type="date" className="input" value={ultima} onChange={(e) => setUltima(e.target.value)} />
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary w-full" onClick={guardar}>
          Guardar producto
        </button>
        {editando && (
          <button className="btn btn-secondary w-full" onClick={borrar}>
            <Trash2 size={16} /> Borrar producto
          </button>
        )}
      </div>
    </Sheet>
  );
}
