"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { useHousehold } from "@/components/HouseholdProvider";
import { BalanceBar } from "@/components/BalanceBar";
import { OccurrenceRow, sortOccurrences } from "@/components/OccurrenceRow";
import { PantrySoonCard } from "@/components/PantrySoon";
import { PushButton } from "@/components/PushButton";
import { PageHeader, Pills } from "@/components/ui";
import { formatLong, todayStr } from "@/lib/dates";
import { Loading } from "@/components/Loading";
import type { Occurrence } from "@/lib/types";

export default function HoyPage() {
  const { ready, occurrences, tasks, household, members } = useHousehold();
  const [persona, setPersona] = useState<string>("todas");
  const hoy = todayStr();
  const deDePersona = (o: Occurrence) => persona === "todas" || o.responsable_id === persona;

  const activas = new Set(tasks.filter((t) => t.activa).map((t) => t.id));
  const deHoy = sortOccurrences(
    occurrences.filter((o) => o.fecha === hoy && activas.has(o.task_id) && deDePersona(o)),
    tasks,
  );
  const pendientesAntes = sortOccurrences(
    occurrences.filter((o) => o.fecha < hoy && !o.completada && activas.has(o.task_id) && deDePersona(o)),
    tasks,
  );
  const hechas = deHoy.filter((o) => o.completada).length;

  return (
    <>
      <PageHeader
        title="Hoy"
        subtitle={formatLong(hoy)}
        right={
          <Link href="/ajustes" aria-label="Ajustes" className="mt-1 rounded-[10px] border-[3px] border-vino p-2">
            <Settings size={22} />
          </Link>
        }
      />
      {!ready ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <BalanceBar />

          <Pills<string>
            options={[{ value: "todas", label: "Todas" }, ...members.map((m) => ({ value: m.id, label: m.nombre }))]}
            value={persona}
            onChange={setPersona}
          />

          <section className="card">
            <div className="flex items-baseline justify-between">
              <h2 className="titulo text-[20px]">Para hoy</h2>
              {deHoy.length > 0 && (
                <span className="text-sm text-sec">
                  {hechas} de {deHoy.length}
                </span>
              )}
            </div>
            {deHoy.length === 0 ? (
              <p className="mt-3 text-sm text-sec">Nada para hoy. Disfruten el día.</p>
            ) : (
              <ul className="mt-1">
                {deHoy.map((o) => (
                  <OccurrenceRow key={o.id} occurrence={o} />
                ))}
              </ul>
            )}
          </section>

          {pendientesAntes.length > 0 && (
            <section className="card border-accion!">
              <h2 className="titulo text-[20px] text-accion">Pendientes de antes</h2>
              <p className="text-xs text-sec">Quedaron sin marcar. Márcalas o toca &quot;No se hizo&quot;.</p>
              <ul className="mt-1">
                {pendientesAntes.map((o) => (
                  <OccurrenceRow key={o.id} occurrence={o} showDate />
                ))}
              </ul>
            </section>
          )}

          <PantrySoonCard />

          <div className="pt-2">
            <PushButton compact />
          </div>
          {household && <p className="pt-2 text-center text-xs text-sec">{household.nombre}</p>}
        </div>
      )}
    </>
  );
}

