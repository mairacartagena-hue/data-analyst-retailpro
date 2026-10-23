"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { construirRespaldo } from "@/lib/exportar";
import { todayStr } from "@/lib/dates";
import { useHousehold } from "./HouseholdProvider";
import { ErrorText } from "./ui";

export function ExportarDatos() {
  const { household, members, tasks, pets, petEvents, pantry, items, lists, reminders, notes } = useHousehold();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportar() {
    if (!household) return;
    setOcupado(true);
    setError(null);
    try {
      const blob = await construirRespaldo({
        nombreHogar: household.nombre,
        members,
        tasks,
        pets,
        petEvents,
        pantry,
        items,
        lists,
        reminders,
        notes,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `amedias-respaldo-${todayStr()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("No pudimos armar el respaldo. Intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-sec">
        Descarga un archivo ZIP con cada sección en CSV (tareas, despensa, compras, mascotas, recordatorios, notas y personas). Se abre con Google Sheets.
      </p>
      <button className="btn btn-secondary w-full" onClick={exportar} disabled={ocupado || !household}>
        <Download size={16} /> {ocupado ? "Preparando…" : "Exportar todo"}
      </button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
