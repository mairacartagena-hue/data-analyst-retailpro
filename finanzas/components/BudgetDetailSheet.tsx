"use client";

import { Mail, MessageSquareText, PenLine, Pencil, Plus, Smartphone } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { MemberBadge } from "@/components/MemberBadge";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { Category, CategoryLimit } from "@/lib/types";
import type { CategoryStatus } from "@/lib/finance/budget";
import { formatCop } from "@/lib/finance/money";
import { formatDay, isWithin } from "@/lib/finance/periods";
import { categoryPath, consumptionSign, withDescendants } from "@/lib/finance/spaces";
import { limitResponsible } from "@/lib/finance/derive";

const SOURCE: Record<string, { label: string; icon: typeof Mail }> = {
  GMAIL: { label: "Llegó por correo", icon: Mail },
  ANDROID_SMS: { label: "Llegó por SMS", icon: MessageSquareText },
  ANDROID_NOTIFICATION: { label: "Llegó por notificación", icon: Smartphone },
  MANUAL: { label: "Registrado a mano", icon: PenLine },
};

/** Qué pagos forman la barra de un presupuesto de categoría en el periodo y cómo llegó cada uno. */
export function BudgetDetailSheet({ limit, status, onClose, onEdit }: {
  limit: CategoryLimit | null;
  status: CategoryStatus | undefined;
  onClose: () => void;
  onEdit: (l: CategoryLimit) => void;
}) {
  const { consumption: transactions, period, memberById, me, partner, categories } = useFinance();
  const { openTransaction, openPayment } = useShell();
  const category: Category | null = limit ? categories.find((c) => c.id === limit.category_id) ?? null : null;
  if (!limit || !category) return null;
  const partners = limit.scope === "PERSONAL" && limit.owner_user_id !== me.user_id;

  // La categoría con sus subcategorías; del hogar: movimientos del hogar · personal: los personales de su dueño
  const ids = withDescendants(categories, [category.id]);
  const counts = (scope: string, responsible: string) =>
    limit.scope === "HOUSEHOLD" ? scope === "HOUSEHOLD" : scope === "PERSONAL" && responsible === limit.owner_user_id;
  const items = transactions
    .filter((t) => consumptionSign(t.kind) !== 0 && isWithin(t.occurred_on, period))
    .flatMap((t) => t.splits.filter((s) => s.category_id && ids.has(s.category_id) && counts(t.scope, s.responsible_user_id))
      .map((s) => ({ t, s, sign: consumptionSign(t.kind) })))
    .sort((a, b) => b.t.occurred_on.localeCompare(a.t.occurred_on));
  const visible = items.reduce((a, i) => a + i.sign * i.s.amount, 0);
  const spent = status?.totalSpent ?? visible;
  const available = status?.totalAvailable ?? 0;
  const hidden = Math.max(0, spent - visible);
  const mine = status?.allocations.find((a) => a.userId === me.user_id);
  const left = available - spent;

  return (
    <Sheet open={!!category} onOpenChange={(v) => !v && onClose()} title={`${category.icon ?? ""} ${category.name}${limit.scope === "PERSONAL" ? " (personal)" : ""}`.trim()}
      description={`${formatCop(spent)} de ${formatCop(available)} · ${left >= 0 ? `quedan ${formatCop(left)}` : `pasó ${formatCop(-left)}`}`}>
      <div className="space-y-4 pb-2">
        <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-sm">
          Cuenta aquí un pago {limit.scope === "HOUSEHOLD" ? "del hogar" : partners ? `personal de ${memberById(limit.owner_user_id)?.display_name ?? "tu pareja"}` : "personal tuyo"} en <strong>{category.name}</strong>
          {" "}(o sus subcategorías): lo registras a mano, lo confirmas en “Por revisar” o llega solo si el comercio tiene “Aplicar siempre”.
        </p>

        {items.length === 0 && hidden === 0 ? (
          <p className="text-sm text-muted">Aún no hay pagos en este periodo.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {items.map(({ t, s, sign }) => {
              const src = SOURCE[t.source] ?? SOURCE.MANUAL;
              const Icon = src.icon;
              return (
                <button key={s.id} onClick={() => { onClose(); openTransaction(t.installment_of ?? t); }} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-2">
                  <MemberBadge member={memberById(s.responsible_user_id)} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.merchant || t.description || category.name}</span>
                    {s.category_id !== category.id && <span className="block truncate text-xs text-muted">{categoryPath(categories, s.category_id)}</span>}
                    <span className="flex items-center gap-1 text-xs text-muted"><Icon size={12} /> {src.label} · {formatDay(t.occurred_on)}{t.installment_no ? ` · cuota ${t.installment_no} de ${t.installments}` : ""}{t.status === "PENDING_REVIEW" ? " · por revisar" : ""}</span>
                  </span>
                  <span className="num shrink-0 font-semibold">{sign < 0 ? "−" : ""}{formatCop(s.amount)}</span>
                </button>
              );
            })}
            {hidden > 0 && (
              <p className="px-3.5 py-3 text-sm text-muted">Y {formatCop(hidden)} en pagos que no puedes abrir.</p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          {partners ? (
            <p className="text-sm text-muted">Presupuesto personal que tu pareja comparte contigo: ves el avance, no sus movimientos.</p>
          ) : (<>
          <Button variant="secondary" onClick={() => { onClose(); onEdit(limit); }}><Pencil size={16} /> Editar</Button>
          <Button className="flex-1" onClick={() => {
            onClose();
            openPayment({
              categoryId: category.id, amount: Math.max(0, mine ? mine.remaining : left) || undefined,
              scope: limit.scope, responsibleId: limitResponsible(limit, me, partner) ?? me.user_id,
            });
          }}>
            <Plus size={16} /> Registrar pago
          </Button>
          </>)}
        </div>
      </div>
    </Sheet>
  );
}
