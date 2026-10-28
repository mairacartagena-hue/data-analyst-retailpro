"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import type { CategoryLimit, Space } from "@/lib/types";
import type { Responsibility } from "@/lib/finance/budget";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SwitchRow } from "@/components/ui/switch";
import { AmountInput } from "@/components/AmountInput";
import { CategoryOptions } from "@/components/CategoryPicker";
import { budgetVersionAt } from "@/lib/finance/budget";
import { toBudgetCategories } from "@/lib/finance/derive";
import { formatCop, parseCop } from "@/lib/finance/money";
import { periodFor, periodLabel, todayBogota } from "@/lib/finance/periods";
import { memberBySlot } from "@/lib/finance/labels";
import { categoryPath } from "@/lib/finance/spaces";
import { cn, errMsg } from "@/lib/utils";

type HouseholdResp = Exclude<Responsibility, "PRIVATE">;

/**
 * Presupuesto de una categoría: aquí se decide si es del hogar o personal y quién lo asume.
 * La categoría en sí la usan los dos y no decide nada de eso.
 */
export function LimitSheet({
  open, onOpenChange, limit, categoryId = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  limit: CategoryLimit | null;
  /** Categoría sugerida para un presupuesto nuevo. */
  categoryId?: string | null;
}) {
  const { me, partner, settings, budgets, limits, categories, supabase, reload } = useFinance();
  const memberA = memberBySlot(me, partner, "A");
  const memberB = memberBySlot(me, partner, "B");
  const currentStart = periodFor(settings, todayBogota()).start;

  const [category, setCategory] = useState("");
  const [scope, setScope] = useState<Space>("HOUSEHOLD");
  const [resp, setResp] = useState<HouseholdResp>("FIXED_AMOUNTS");
  const [amount, setAmount] = useState("");
  const [fixedA, setFixedA] = useState("");
  const [fixedB, setFixedB] = useState("");
  const [obligation, setObligation] = useState(false);
  // El rollover ya no se ofrece; se conserva el valor que tenga el presupuesto
  const [rollover, setRollover] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (limit) {
      const v = (() => {
        const bc = toBudgetCategories([limit], budgets)[0];
        return budgetVersionAt(bc.budgets, currentStart) ?? bc.budgets.at(-1) ?? null;
      })();
      setCategory(limit.category_id);
      setScope(limit.scope);
      setResp(limit.responsibility ?? "FIXED_AMOUNTS");
      setAmount(v ? String(v.amount) : "");
      setFixedA(v?.fixedAmountA != null ? String(v.fixedAmountA) : "");
      setFixedB(v?.fixedAmountB != null ? String(v.fixedAmountB) : "");
      setObligation(limit.is_household_obligation);
      setRollover(limit.rollover_enabled);
      setShared(limit.shared_with_partner);
    } else {
      setShared(false);
      setCategory(categoryId ?? "");
      setScope("HOUSEHOLD");
      setResp("FIXED_AMOUNTS");
      setAmount("");
      setFixedA("");
      setFixedB("");
      setObligation(false);
      setRollover(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, limit, categoryId]);

  // Categorías que aún no tienen presupuesto en el espacio elegido
  const taken = (id: string, s: Space) =>
    limits.some((l) => l.category_id === id && l.scope === s && (s === "HOUSEHOLD" || l.owner_user_id === me.user_id));
  const options = categories.filter((c) => !c.archived && c.kind !== "INCOME" && !taken(c.id, scope));
  const household = scope === "HOUSEHOLD";
  const fixedTotal = (parseCop(fixedA) ?? 0) + (parseCop(fixedB) ?? 0);

  const respOptions: { value: HouseholdResp; title: string; hint: string }[] = [
    { value: "MEMBER_A_100", title: `100 % ${memberA?.display_name ?? "miembro A"}`, hint: "Asume todo el presupuesto" },
    { value: "MEMBER_B_100", title: `100 % ${memberB?.display_name ?? "miembro B (aún no se une)"}`, hint: "Asume todo el presupuesto" },
    { value: "FIXED_AMOUNTS", title: "Compartido con montos fijos", hint: "Cada uno aporta un monto en pesos" },
  ];

  async function save() {
    setError(null);
    if (!category) return setError("Elige la categoría.");
    setBusy(true);
    const fixed = household && resp === "FIXED_AMOUNTS";
    const { error } = await supabase.rpc("save_category_limit", {
      p: {
        id: limit?.id ?? null,
        category_id: category,
        scope,
        responsibility: household ? resp : null,
        is_household_obligation: household && obligation,
        rollover_enabled: rollover,
        shared_with_partner: !household && shared,
        budget: {
          valid_from: currentStart,
          amount: fixed ? fixedTotal : (parseCop(amount) ?? 0),
          fixed_amount_a: fixed ? (parseCop(fixedA) ?? 0) : null,
          fixed_amount_b: fixed ? (parseCop(fixedB) ?? 0) : null,
        },
      },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  async function remove() {
    if (!limit || !confirm("¿Quitar este presupuesto? La categoría y sus movimientos se conservan.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_category_limit", { p_id: limit.id });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}
      title={limit ? `Presupuesto de ${categoryPath(categories, limit.category_id)}` : "Presupuesto de una categoría"}
      description="Aquí se define si el presupuesto es del hogar o personal y quién lo asume. La categoría la pueden usar los dos."
      footer={<div className="space-y-2"><ErrorText>{error}</ErrorText><div className="flex gap-3">
          {limit && (
            <Button variant="danger" size="icon" onClick={remove} disabled={busy} aria-label="Quitar presupuesto">
              <Trash2 size={18} />
            </Button>
          )}
          <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</Button>
        </div></div>}>
      <div className="space-y-4 pb-2">
        {!limit && (
          <>
            <Field label="¿De qué espacio?">
              <Segmented value={scope} onChange={setScope} options={[
                { value: "HOUSEHOLD", label: "Hogar" },
                { value: "PERSONAL", label: "Personal" },
              ]} />
              <p className="mt-1.5 text-xs text-muted">
                {household ? "Lo ven los dos y suma los movimientos del hogar, pague quien pague." : "Solo tú lo ves. Suma tus movimientos personales en esta categoría."}
              </p>
            </Field>
            <Field label="Categoría" hint="Una categoría principal incluye sus subcategorías.">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Elige la categoría…</option>
                <CategoryOptions categories={options} />
              </Select>
            </Field>
          </>
        )}
        {limit && (
          <p className="text-sm font-medium text-muted">{household ? "Presupuesto del hogar: lo ven los dos." : shared && partner ? `Presupuesto personal, compartido con ${partner.display_name}.` : "Presupuesto personal: solo tú lo ves."}</p>
        )}

        {household && (
          <Field label="¿Quién lo asume?" hint="Al pagar desde este presupuesto se propone esta persona; en cada movimiento se puede cambiar.">
            <div className="grid gap-2">
              {respOptions.map((o) => (
                <button key={o.value} type="button" onClick={() => setResp(o.value)} aria-pressed={resp === o.value}
                  disabled={o.value === "MEMBER_B_100" && !memberB && resp !== "MEMBER_B_100"}
                  className={cn("rounded-2xl border px-4 py-2.5 text-left disabled:opacity-50", resp === o.value ? "border-olive bg-olive-soft" : "border-border bg-surface")}>
                  <span className="block font-medium">{o.title}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </button>
              ))}
            </div>
          </Field>
        )}

        {household && resp === "FIXED_AMOUNTS" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Aporta ${memberA?.display_name ?? "A"}`}><AmountInput value={fixedA} onChange={setFixedA} /></Field>
            <Field label={`Aporta ${memberB?.display_name ?? "B"}`}><AmountInput value={fixedB} onChange={setFixedB} /></Field>
            <p className="col-span-2 -mt-1 text-sm text-muted">Presupuesto total: <span className="num font-semibold text-text">{formatCop(fixedTotal)}</span></p>
          </div>
        ) : (
          <Field label="Límite por periodo"><AmountInput value={amount} onChange={setAmount} /></Field>
        )}
        {limit && (
          <p className="-mt-2 text-xs text-muted">Un cambio de monto aplica desde el periodo actual ({periodLabel(periodFor(settings, todayBogota()))}); los anteriores quedan igual.</p>
        )}

        {household && (
          <SwitchRow label="Obligación del hogar" hint="Lo que falte por pagar se aparta del Saldo Seguro de quien lo asume."
            checked={obligation} onCheckedChange={setObligation} />
        )}
        {!household && partner && (
          <SwitchRow label={`Compartir con ${partner.display_name}`}
            hint="Verá el límite y cuánto llevas, pero no tus movimientos. Solo tú lo editas."
            checked={shared} onCheckedChange={setShared} />
        )}
      </div>
    </Sheet>
  );
}
