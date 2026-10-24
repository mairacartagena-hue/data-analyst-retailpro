"use client";

import Link from "next/link";
import { SectionHeader } from "./ui";
import { pantryDaysLeft, pantryLow } from "@/lib/logic";
import { useHousehold } from "./HouseholdProvider";

export function usePantrySoon() {
  const { pantry } = useHousehold();
  return pantry.filter((p) => pantryLow(p)).sort((a, b) => pantryDaysLeft(a) - pantryDaysLeft(b));
}

export function diasTexto(n: number) {
  if (n <= 0) return "Se acabó";
  return n === 1 ? "Queda 1 día" : `Quedan ${n} días`;
}

/** Tarjetas horizontales de productos que se están acabando */
export function PantryCards() {
  const productos = usePantrySoon();
  if (!productos.length) return null;
  return (
    <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
      {productos.map((p) => {
        const d = pantryDaysLeft(p);
        return (
          <div key={p.id} className="card w-36 shrink-0 bg-rosa-claro! p-3!">
            <p className="truncate text-[15px] font-semibold">{p.nombre}</p>
            <p className={`mt-1 text-xs font-semibold ${d <= 0 ? "text-accion" : "text-sec"}`}>{diasTexto(d)}</p>
            <span className="tag mt-2 bg-crema!">En Mercado</span>
          </div>
        );
      })}
    </div>
  );
}

export function PantrySoonCard() {
  const productos = usePantrySoon();
  if (!productos.length) return null;
  return (
    <section>
      <SectionHeader
        title="Se termina pronto"
        action={
          <Link href="/compras" className="text-sm font-semibold text-accion">
            Ver compras
          </Link>
        }
      />
      <PantryCards />
    </section>
  );
}
