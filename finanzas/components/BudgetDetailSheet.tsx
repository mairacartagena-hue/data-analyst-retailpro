"use client";

import { Mail, MessageSquareText, PenLine, Pencil, Plus, Smartphone } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { MemberBadge } from "@/components/MemberBadge";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { Category } from "@/lib/types";
import type { CategoryStatus } from "@/lib/finance/budget";
import { formatCop } from "@/lib/finance/money";
import { formatDay, isWithin } from "@/lib/finance/periods";

const SOURCE: Record<string, { label: string; icon: typeof Mail }> = {
  GMAIL: { label: "Llegó por correo", icon: Mail },
  ANDROID_SMS: { label: "Llegó por SMS", icon: MessageSquareText },
  ANDROID_NOTIFICATION: { label: "Llegó por notificación", icon: Smartphone },
  MANUAL: { label: "Registrado a mano", icon: PenLine },
};

/** Qué pagos forman la barra de una categoría en el periodo y cómo llegó cada uno. */
export function BudgetDetailSheet({ category, status, onClose, onEdit }: {
  category: Category | null;
  status: CategoryStatus | undefined;
  onClose: () => void;
  onEdit: (c: Category) => void;
}) {
  const { transactions, period, memberById, me } = useFinance();
  const { openTransaction, openPayment } = useShell();
  if (!category) return null;

  const items = transactions
    .filter((t) => t.kind === "EXPENSE" && isWithin(t.occurred_on, period))
    .flatMap((t) => t.splits.filter((s) => s.category_id === category.id).map((s) => ({ t, s })))
    .sort((a, b) => b.t.occurred_on.localeCompare(a.t.occurred_on));
  const visible = items.reduce((a, i) => a + i.s.amount, 0);
  const spent = status?.totalSpent ?? visible;
  const available = status?.totalAvailable ?? 0;
  const hidden = Math.max(0, spent - visible);
  const mine = status?.allocations.find((a) => a.userId === me.user_id);
  const left = available - spent;

  return (
    <Sheet open={!!category} onOpenChange={(v) => !v && onClose()} title={`${category.icon ?? ""} ${category.name}`.trim()}
      description={`${formatCop(spent)} de ${formatCop(available)} · ${left >= 0 ? `quedan ${formatCop(left)}` : `pasó ${formatCop(-left)}`}`}>
      <div className="space-y-4 pb-2">
        <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-sm">
          Un pago cuenta aquí cuando queda en la categoría <strong>{category.name}</strong>: lo registras a mano, lo confirmas en
          “Por revisar” o llega solo si el comercio tiene “Aplicar siempre”.
        </p>

        {items.length === 0 && hidden === 0 ? (
          <p className="text-sm text-muted">Aún no hay pagos en este periodo.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {items.map(({ t, s }) => {
              const src = SOURCE[t.source] ?? SOURCE.MANUAL;
              const Icon = src.icon;
              return (
                <button key={s.id} onClick={() => { onClose(); openTransaction(t); }} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-2">
                  <MemberBadge member={memberById(s.responsible_user_id)} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.merchant || t.description || category.name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted"><Icon size={12} /> {src.label} · {formatDay(t.occurred_on)}{t.status === "PENDING_REVIEW" ? " · por revisar" : ""}</span>
                  </span>
                  <span className="num shrink-0 font-semibold">{formatCop(s.amount)}</span>
                </button>
              );
            })}
            {hidden > 0 && (
              <p className="px-3.5 py-3 text-sm text-muted">Y {formatCop(hidden)} en pagos que tu pareja no comparte en detalle.</p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => { onClose(); onEdit(category); }}><Pencil size={16} /> Editar</Button>
          <Button className="flex-1" onClick={() => {
            onClose();
            openPayment({ categoryId: category.id, amount: Math.max(0, mine ? mine.remaining : left) || undefined });
          }}>
            <Plus size={16} /> Registrar pago
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
