"use client";

import { motion } from "motion/react";
import { AlertTriangle, CalendarClock, Check, Home, List, Lock, Plus, Users } from "lucide-react";
import type { Category, CategoryLimit, Member } from "@/lib/types";
import type { CategoryStatus } from "@/lib/finance/budget";
import { formatCop, formatCopShort } from "@/lib/finance/money";
import { MemberBadge } from "@/components/MemberBadge";
import { formatDay, todayBogota } from "@/lib/finance/periods";
import { cn } from "@/lib/utils";

/** Barra de un presupuesto de categoría: quién lo asume, cuánto lleva cada uno y alerta de tope. */
export function BudgetBar({
  category, limit, status, memberById, onClick, onPay, meId, label, icon, due,
}: {
  /** Fecha de vencimiento de la cuota en el periodo (presupuestos de créditos). */
  due?: string;
  /** Ícono a mostrar (ej. el de la principal en una subcategoría). */
  icon?: string;
  category: Category;
  /** El presupuesto (del hogar o personal) que muestra la barra. */
  limit: CategoryLimit;
  /** Nombre a mostrar (ej. "Vivienda › Hipoteca"); por defecto el de la categoría. */
  label?: string;
  status: CategoryStatus | undefined;
  memberById: (id: string | null | undefined) => Member | null;
  /** Abre la edición de la categoría. */
  onClick?: () => void;
  /** Abre el registro de un pago con lo que falta como monto sugerido. */
  onPay?: (amount: number) => void;
  meId?: string;
}) {
  const available = status?.totalAvailable ?? 0;
  const spent = status?.totalSpent ?? 0;
  const level = status?.level ?? "ok";
  const allocations = status?.allocations ?? [];
  const spenders = Object.entries(status?.spentByUser ?? {}).filter(([, v]) => v > 0);
  const scale = Math.max(available, spent, 1);
  const left = available - spent;
  // Monto sugerido para pagar: lo que me falta de mi parte, o lo que falta de la categoría
  const mine = allocations.find((a) => a.userId === meId);
  const suggested = Math.max(0, mine ? mine.remaining : left);
  const covered = available > 0 && left <= 0;

  return (
    <div className="w-full rounded-2xl border border-border bg-surface">
    <button onClick={onClick} className="w-full rounded-t-2xl p-3.5 pb-2.5 text-left transition-colors hover:bg-surface-2" aria-label={`Ver pagos de ${category.name}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-lg">{icon ?? (category.icon || "•")}</span>
          <span className="truncate font-semibold">{label ?? category.name}</span>
          {limit.scope === "PERSONAL"
            ? <Lock size={14} className="shrink-0 text-muted" aria-label="Presupuesto personal" />
            : <Home size={14} className="shrink-0 text-muted" aria-label="Presupuesto del hogar" />}
          {limit.scope === "PERSONAL" && limit.shared_with_partner && <Users size={14} className="shrink-0 text-muted" aria-label="Compartido con la pareja" />}
          {level !== "ok" && (
            <AlertTriangle size={15} className={cn("shrink-0", level === "over" ? "text-danger" : "text-warning")}
              aria-label={level === "over" ? "Pasó el tope" : "Cerca del tope"} />
          )}
        </div>
        <div className="flex shrink-0 -space-x-1.5">
          {allocations.map((a) => <MemberBadge key={a.userId} member={memberById(a.userId)} size={22} className="ring-2 ring-surface" />)}
        </div>
      </div>

      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {spenders.map(([userId, value]) => (
          <motion.span key={userId} className="h-full" style={{ background: level === "over" ? "var(--danger)" : (memberById(userId)?.color ?? "var(--household)") }}
            initial={{ width: 0 }} animate={{ width: `${(value / scale) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
        ))}
      </div>

      <div className="mt-2 flex items-baseline justify-between text-sm">
        <span className="num text-muted">
          {formatCopShort(spent)} de {formatCopShort(available)}
        </span>
        <span className={cn("num font-semibold", left < 0 ? "text-danger" : level === "warning" ? "text-warning" : "text-text")}>
          {left < 0 ? `Pasó ${formatCop(-left)}` : `Quedan ${formatCop(left)}`}
        </span>
      </div>

      {due && (() => {
        const today = todayBogota();
        const tone = covered ? "text-muted" : due < today ? "text-danger" : due === today ? "text-warning" : "text-muted";
        const text = covered ? `Pagada · vencía el ${formatDay(due)}` : due < today ? `Vencida el ${formatDay(due)}` : due === today ? "Vence hoy" : `Vence el ${formatDay(due)}`;
        return <p className={cn("mt-1 flex items-center gap-1 text-xs", tone)}><CalendarClock size={13} /> {text}</p>;
      })()}

      {limit.responsibility === "FIXED_AMOUNTS" && allocations.length > 1 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {allocations.map((a) => (
            <div key={a.userId} className="rounded-xl bg-surface-2 px-2.5 py-1.5 text-xs">
              <span className="font-medium">{memberById(a.userId)?.display_name}</span>
              <span className="num block text-muted">{formatCopShort(a.spent)} de {formatCopShort(a.available)}</span>
            </div>
          ))}
        </div>
      )}
    </button>
    {onPay && (
      <div className="flex items-center justify-between gap-2 border-t border-border px-3.5 py-2">
        {covered ? (
          <span className="flex items-center gap-1 text-sm font-medium text-olive"><Check size={15} /> Cubierto este periodo</span>
        ) : (
          <button type="button" onClick={onClick} className="flex items-center gap-1 text-xs text-muted hover:text-text"><List size={13} /> Ver sus pagos</button>
        )}
        <button onClick={() => onPay(covered ? 0 : suggested)}
          className={cn("flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold", covered ? "text-muted hover:bg-surface-2" : "bg-olive-soft text-text")}>
          <Plus size={15} /> {covered ? "Otro gasto" : "Registrar pago"}
        </button>
      </div>
    )}
    </div>
  );
}
