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
import { CATEGORIAS, LISTAS, type Categoria, type NombreLista, type PantryProduct, type ShoppingItem } from "@/lib/types";

export default function ComprasPage() {
  const { ready, lists, items, me, members, memberById, optimistic, optimisticRemove, pantry } = useHousehold();
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

  async function actualizarLista(campos: { quien_va?: string | null; fecha?: string | null }) {
    if (!lista) return;
    optimistic("lists", { ...lista, ...campos });
    await getSupabase().from("shopping_lists").update(campos).eq("id", lista.id);
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
          {lista && (
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-sec">Va:</span>
              <select
                className="input w-auto! py-1.5!"
                value={lista.quien_va ?? ""}
                onChange={(e) => actualizarLista({ quien_va: e.target.value || null })}
                aria-label="Quién va"
              >
                <option value="">Sin definir</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
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

          {activa === "Mercado" && (
            <section>
              <div className="flex items-baseline justify-between">
                <h2 className="seccion">Despensa</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => setProducto("nuevo")}>
                  <Plus size={14} /> Producto
                </button>
              </div>
              <p className="-mt-1 mb-3 text-xs text-sec">
                Cuando a un producto le queda el 20% o menos, se agrega solo a Mercado con la etiqueta AUTO.
              </p>
              {pantry.length === 0 ? (
                <Empty>Agrega lo que siempre compran (café, arroz, jabón) y cuántos días les dura.</Empty>
              ) : (
                <ul className="card p-0!">
                  {[...pantry]
                    .sort((a, b) => pantryDaysLeft(a) - pantryDaysLeft(b))
                    .map((p) => {
                      const d = pantryDaysLeft(p);
                      const pct = Math.max(0, Math.min(100, (d / p.duracion_dias) * 100));
                      return (
                        <li key={p.id} className="border-b-2 border-rosa-claro last:border-b-0">
                          <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setProducto(p)}>
                            <div className="min-w-0 flex-1">
                              <p className="text-[15px] font-semibold">{p.nombre}</p>
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

      <PantrySheet producto={producto} onClose={() => setProducto(null)} />
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

function PantrySheet({ producto, onClose }: { producto: PantryProduct | "nuevo" | null; onClose: () => void }) {
  const { household, optimistic, optimisticRemove } = useHousehold();
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("Abarrotes");
  const [duracion, setDuracion] = useState(30);
  const [ultima, setUltima] = useState(todayStr());
  const [error, setError] = useState<string | null>(null);
  const editando = producto && producto !== "nuevo" ? producto : null;

  useEffect(() => {
    if (!producto) return;
    setError(null);
    setNombre(editando?.nombre ?? "");
    setCategoria(editando?.categoria ?? "Abarrotes");
    setDuracion(editando?.duracion_dias ?? 30);
    setUltima(editando?.fecha_ultima_compra ?? todayStr());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto]);

  async function guardar() {
    if (!nombre.trim() || duracion < 1) return setError("Completa el nombre y los días.");
    const fila = { household_id: household!.id, nombre: nombre.trim(), categoria, duracion_dias: duracion, fecha_ultima_compra: ultima };
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
