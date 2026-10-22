"use client";

import { weekBalance } from "@/lib/logic";
import { useHousehold } from "./HouseholdProvider";

export function BalanceBar() {
  const { occurrences, members } = useHousehold();
  const counts = weekBalance(occurrences, members);
  const total = members.reduce((s, m) => s + (counts[m.id] ?? 0), 0);

  return (
    <section className="card">
      <div className="flex items-baseline justify-between">
        <h2 className="titulo text-[20px]">Balance de la semana</h2>
        <span className="text-xs text-sec">Juntos no cuenta</span>
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
      {members.length < 2 && <p className="mt-2 text-xs text-sec">Invita a tu pareja desde Ajustes para repartir las tareas.</p>}
    </section>
  );
}
