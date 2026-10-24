"use client";

import { useMemo, useState } from "react";
import { motion, type PanInfo } from "motion/react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input } from "@/components/ui/input";
import {
  addDays, isWithin, monthName, periodFor, periodLabel, shiftPeriod, todayBogota, type Period,
} from "@/lib/finance/periods";
import { formatCopShort } from "@/lib/finance/money";
import { cn, errMsg } from "@/lib/utils";

/** Encabezado del periodo: flechas, deslizar a los lados y calendario rápido. */
export function PeriodSwitcher() {
  const { period, setPeriod, settings } = useFinance();
  const [calendar, setCalendar] = useState(false);

  const go = (n: number) => setPeriod(shiftPeriod(settings, period, n));
  const isCurrent = !period.custom && isWithin(todayBogota(), period);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <button className="rounded-full p-2 text-muted hover:bg-surface-2" onClick={() => go(-1)} aria-label="Periodo anterior">
          <ChevronLeft size={22} />
        </button>
        <button onClick={() => setCalendar(true)} className="flex min-w-0 flex-col items-center rounded-2xl px-3 py-1 hover:bg-surface-2">
          <span className="flex items-center gap-1.5 truncate text-[15px] font-semibold">
            <CalendarDays size={16} className="text-olive" />
            {periodLabel(period)}
          </span>
          <span className="text-xs text-muted">{period.custom ? "Rango personalizado" : isCurrent ? "Periodo actual" : "Toca para ver el calendario"}</span>
        </button>
        <button className="rounded-full p-2 text-muted hover:bg-surface-2" onClick={() => go(1)} aria-label="Periodo siguiente">
          <ChevronRight size={22} />
        </button>
      </div>
      <CalendarSheet open={calendar} onOpenChange={setCalendar} />
    </>
  );
}

/** Envuelve el contenido para cambiar de periodo deslizando el dedo a los lados. */
export function SwipePeriods({ children }: { children: React.ReactNode }) {
  const { period, setPeriod, settings } = useFinance();
  function onDragEnd(_: unknown, info: PanInfo) {
    if (Math.abs(info.offset.x) < 80 || Math.abs(info.offset.y) > 60) return;
    setPeriod(shiftPeriod(settings, period, info.offset.x < 0 ? 1 : -1));
  }
  return (
    <motion.div drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.15} dragDirectionLock onDragEnd={onDragEnd}
      key={`${period.start}-${period.end}`} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
      style={{ touchAction: "pan-y" }}>
      {children}
    </motion.div>
  );
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function CalendarSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { period, setPeriod, settings, transactions, customPeriods, supabase, me, reload } = useFinance();
  const [month, setMonth] = useState(() => period.start.slice(0, 7));
  const [from, setFrom] = useState(period.start);
  const [to, setTo] = useState(period.end);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const today = todayBogota();
  const [y, m] = month.split("-").map(Number);

  // Gasto visible por día (lo que puedo ver)
  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) {
      if ((t.kind !== "EXPENSE" && t.kind !== "DEBT_PAYMENT") || !t.occurred_on.startsWith(month)) continue;
      map.set(t.occurred_on, (map.get(t.occurred_on) ?? 0) + t.amount);
    }
    return map;
  }, [transactions, month]);

  const first = `${month}-01`;
  const weekdayOffset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: weekdayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDays(first, i)),
  ];

  function shiftMonth(n: number) {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  }

  function choose(p: Period) {
    setPeriod(p);
    onOpenChange(false);
  }

  async function saveRange() {
    setError(null);
    if (!from || !to || to < from) return setError("La fecha final debe ser igual o posterior a la inicial.");
    const label = name.trim() || periodLabel({ start: from, end: to });
    const { error } = await supabase.from("custom_periods").insert({ household_id: me.household_id, name: label, start_date: from, end_date: to });
    if (error) return setError(errMsg(error));
    void reload();
    choose({ start: from, end: to, custom: true, name: label });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Calendario">
      <div className="space-y-5 pb-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <button className="rounded-full p-2 text-muted" onClick={() => shiftMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={20} /></button>
            <span className="font-semibold capitalize">{monthName(m - 1, true)} {y}</span>
            <button className="rounded-full p-2 text-muted" onClick={() => shiftMonth(1)} aria-label="Mes siguiente"><ChevronRight size={20} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
            {WEEKDAYS.map((d, i) => <span key={i} className="py-1">{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) =>
              d ? (
                <button key={d} onClick={() => choose(periodFor(settings, d))}
                  className={cn(
                    "flex aspect-square flex-col items-center justify-center rounded-xl text-sm",
                    isWithin(d, period) ? "bg-olive-soft" : "bg-surface",
                    d === today && "ring-2 ring-olive",
                  )}>
                  <span>{Number(d.slice(8))}</span>
                  {byDay.get(d) ? <span className="num text-[9px] leading-none text-wood">{formatCopShort(byDay.get(d)!)}</span> : null}
                </button>
              ) : <span key={`e${i}`} />,
            )}
          </div>
          <p className="mt-2 text-xs text-muted">Toca un día para ir a su periodo.</p>
        </div>

        <Button variant="secondary" className="w-full" onClick={() => choose(periodFor(settings, today))}>Ir al periodo actual</Button>

        {customPeriods.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {customPeriods.map((c) => (
              <button key={c.id} className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm"
                onClick={() => choose({ start: c.start_date, end: c.end_date, custom: true, name: c.name })}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3 rounded-2xl border border-border bg-surface p-3">
          <p className="text-sm font-semibold">Rango personalizado</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Desde" htmlFor="from"><Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Hasta" htmlFor="to"><Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej. Vacaciones)" aria-label="Nombre del rango" />
          <ErrorText>{error}</ErrorText>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => from && to && to >= from ? choose({ start: from, end: to, custom: true, name: name.trim() || undefined }) : setError("Revisa las fechas.")}>Ver</Button>
            <Button onClick={saveRange}>Guardar y ver</Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
