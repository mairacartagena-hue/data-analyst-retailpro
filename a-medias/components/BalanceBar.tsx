"use client";

import { addDays, mondayOf, todayStr } from "@/lib/dates";
import { weekBalance } from "@/lib/logic";
import { useHousehold } from "./HouseholdProvider";
import { Avatar, JUNTOS } from "./ui";

export function BalanceBar() {
  const { occurrences, members } = useHousehold();
  const counts = weekBalance(occurrences, members);
  const total = members.reduce((s, m) => s + (counts[m.id] ?? 0), 0);
  const lunes = mondayOf(todayStr());
  const domingo = addDays(lunes, 6);
  const juntos = occurrences.filter((o) => !o.responsable_id && !o.omitida && o.fecha >= lunes && o.fecha <= domingo).length;

  return (
    <section className="card">
      <div className="flex items-baseline justify-between">
        <h2 className="titulo text-[20px]">Balance de la semana</h2>

      </div>
      <p className="mt-2 text-[17px] font-semibold">
        {members.map((m, i) => (
          <span key={m.id}>
            {i > 0 && <span className="text-sec"> / </span>}
            {m.nombre} · {counts[m.id] ?? 0}
          </span>
        ))}
      </p>
      <div className="mt-3 flex h-6 overflow-hidden rounded-full border-[3px] border-vino" role="img" aria-label="Balance de tareas">
        {total === 0 ? (
          <div className="flex-1 bg-rosa-claro" />
        ) : (
          members.map((m) => {
            const n = counts[m.id] ?? 0;
            if (!n) return null;
            return (
              <div
                key={m.id}
                style={{ width: `${(n / total) * 100}%` }}
                className={`${m.color === "rosa" ? "bg-rosa" : "bg-vino"} border-r-[3px] border-vino last:border-r-0`}
              />
            );
          })
        )}
      </div>
      {juntos > 0 && (
        <p className="mt-2 flex items-center gap-2 text-xs text-sec">
          <Avatar juntos size={18} /> {JUNTOS} · {juntos} (no cuentan en el balance)
        </p>
      )}
      {members.length < 2 && <p className="mt-2 text-xs text-sec">Invita a tu pareja desde Ajustes para repartir las tareas.</p>}
    </section>
  );
}
