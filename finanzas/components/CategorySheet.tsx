"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import type { Category } from "@/lib/types";
import type { Responsibility } from "@/lib/finance/budget";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { SwitchRow } from "@/components/ui/switch";
import { AmountInput } from "@/components/AmountInput";
import { budgetVersionAt } from "@/lib/finance/budget";
import { toBudgetCategories } from "@/lib/finance/derive";
import { formatCop, parseCop } from "@/lib/finance/money";
import { periodFor, periodLabel, todayBogota } from "@/lib/finance/periods";
import { memberBySlot } from "@/lib/finance/labels";
import { cn, errMsg } from "@/lib/utils";

const SUGGESTED_ICONS = ["🏠", "💡", "🛒", "🐾", "📺", "🍽️", "🚗", "💊", "🎓", "🎁", "✈️", "👕", "💳", "🧾"];

const INCOME_ICONS = ["💼", "💰", "🏦", "🧾", "🎁", "🏠", "📈", "🛍️", "🔁"];

export function CategorySheet({
  open, onOpenChange, category, kind = "EXPENSE", onSaved, parentId = null,
}: {
  /** Categoría principal sugerida para una nueva (crear una subcategoría). */
  parentId?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  category: Category | null;
  /** Tipo de la categoría nueva (al editar se usa el de la categoría). */
  kind?: "EXPENSE" | "INCOME";
  /** Se llama con el id guardado (ej. para elegirla en el formulario de un movimiento). */
  onSaved?: (id: string) => void;
}) {
  const state = useFinance();
  const { me, partner, settings, budgets, supabase, reload, categories } = state;
  const memberA = memberBySlot(me, partner, "A");
  const memberB = memberBySlot(me, partner, "B");
  const currentStart = periodFor(settings, todayBogota()).start;

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [resp, setResp] = useState<Responsibility>("MEMBER_A_100");
  const [amount, setAmount] = useState("");
  const [fixedA, setFixedA] = useState("");
  const [fixedB, setFixedB] = useState("");
  const [obligation, setObligation] = useState(false);
  const [shared, setShared] = useState(false);
  const [rollover, setRollover] = useState(false);
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (category) {
      const bc = toBudgetCategories([category], budgets)[0];
      const v = budgetVersionAt(bc.budgets, currentStart) ?? bc.budgets.at(-1) ?? null;
      setName(category.name);
      setIcon(category.icon ?? "");
      setResp(category.responsibility);
      setAmount(v ? String(v.amount) : "");
      setFixedA(v?.fixedAmountA != null ? String(v.fixedAmountA) : "");
      setFixedB(v?.fixedAmountB != null ? String(v.fixedAmountB) : "");
      setObligation(category.is_household_obligation);
      setShared(category.is_shared_progress);
      setRollover(category.rollover_enabled);
      setParent(category.parent_id ?? "");
    } else {
      setParent(parentId ?? "");
      setName("");
      setIcon("");
      setResp(me.slot === "A" ? "MEMBER_A_100" : "MEMBER_B_100");
      setAmount("");
      setFixedA("");
      setFixedB("");
      setObligation(false);
      setShared(false);
      setRollover(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category]);

  const isIncome = (category?.kind ?? kind) === "INCOME";
  const hasChildren = !!category && categories.some((c) => c.parent_id === category.id);
  // Principales posibles: del mismo tipo, sin principal propia y distintas de esta
  const parentOptions = categories.filter((c) => !c.archived && !c.parent_id && c.id !== category?.id
    && (c.kind ?? "EXPENSE") === (isIncome ? "INCOME" : "EXPENSE"));
  const parentCat = categories.find((c) => c.id === parent) ?? null;
  const isPrivate = resp === "PRIVATE" || isIncome;
  // Igual que can_see_budget() en la base de datos: si no puedo ver el presupuesto, no lo edito.
  const canSeeBudget =
    !category ||
    category.is_shared_progress ||
    category.responsibility === "FIXED_AMOUNTS" ||
    category.responsibility === "PRIVATE" ||
    (category.responsibility === "MEMBER_A_100" ? "A" : "B") === me.slot;
  const fixedTotal = (parseCop(fixedA) ?? 0) + (parseCop(fixedB) ?? 0);

  const options: { value: Responsibility; title: string; hint: string }[] = [
    { value: "MEMBER_A_100", title: `100 % ${memberA?.display_name ?? "miembro A"}`, hint: "Asume toda la partida" },
    { value: "MEMBER_B_100", title: `100 % ${memberB?.display_name ?? "miembro B (aún no se une)"}`, hint: "Asume toda la partida" },
    { value: "FIXED_AMOUNTS", title: "Compartida con montos fijos", hint: "Cada uno aporta un monto en pesos" },
    { value: "PRIVATE", title: "Personal (privada)", hint: "Solo tú la ves; se usa en tus movimientos personales" },
  ];

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Ponle un nombre.");
    setBusy(true);
    const { data: savedId, error } = await supabase.rpc("save_category", {
      p: {
        id: category?.id ?? null,
        kind: isIncome ? "INCOME" : "EXPENSE",
        parent_id: parent || null,
        name,
        icon,
        responsibility: isIncome ? "PRIVATE" : resp,
        is_household_obligation: !isPrivate && obligation,
        is_shared_progress: !isPrivate && shared,
        rollover_enabled: rollover,
        budget: canSeeBudget && !isIncome
          ? {
              valid_from: currentStart,
              amount: resp === "FIXED_AMOUNTS" ? fixedTotal : (parseCop(amount) ?? 0),
              fixed_amount_a: resp === "FIXED_AMOUNTS" ? (parseCop(fixedA) ?? 0) : null,
              fixed_amount_b: resp === "FIXED_AMOUNTS" ? (parseCop(fixedB) ?? 0) : null,
            }
          : null,
      },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    if (savedId) onSaved?.(savedId as string);
    void reload();
  }

  async function toggleArchive() {
    if (!category) return;
    setBusy(true);
    const { error } = await supabase.rpc("archive_category", { p_id: category.id, p_archived: !category.archived });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={category ? "Editar categoría" : isIncome ? "Nueva categoría de ingreso" : "Nueva categoría"}>
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-[72px_1fr] gap-3">
          <Field label="Ícono" htmlFor="icon">
            <Input id="icon" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} className="text-center text-xl" placeholder="🛒" />
          </Field>
          <Field label="Nombre" htmlFor="cat-name">
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder={isIncome ? "Salario, ventas, reembolsos…" : "Mercado, arriendo, salidas…"} />
          </Field>
        </div>
        <div className="no-scrollbar -mt-1 flex gap-1.5 overflow-x-auto">
          {(isIncome ? INCOME_ICONS : SUGGESTED_ICONS).map((i) => (
            <button key={i} type="button" onClick={() => setIcon(i)} className="rounded-xl bg-surface-2 px-2 py-1 text-lg">{i}</button>
          ))}
        </div>

        {hasChildren ? (
          <p className="text-xs text-muted">Es una categoría principal: sus subcategorías suman en su presupuesto.</p>
        ) : (
          <Field label="Dentro de" hint="Elige una categoría principal para que esta sea una subcategoría (ej. Vivienda › Crédito hipotecario).">
            <Select value={parent} onChange={(e) => {
              setParent(e.target.value);
              const p = categories.find((c) => c.id === e.target.value);
              if (p?.responsibility === "PRIVATE") setResp("PRIVATE");
            }} aria-label="Categoría principal">
              <option value="">Ninguna (es una categoría principal)</option>
              {parentOptions.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>)}
            </Select>
          </Field>
        )}

        {isIncome ? (
          <p className="rounded-2xl bg-surface-2 px-3 py-2 text-sm text-muted">
            Las categorías de ingresos son personales y no tienen presupuesto: sirven para saber de dónde viene tu plata.
          </p>
        ) : (<>
        {!canSeeBudget && (
          <p className="rounded-2xl bg-surface-2 px-3 py-2 text-sm text-muted">
            El progreso de esta categoría es privado de tu pareja. Puedes cambiarle el nombre o el ícono.
          </p>
        )}

        {canSeeBudget && <Field label="¿Quién la asume?" hint="Es lo que se propone al registrar; en cada movimiento puedes asignarlo a otra persona.">
          <div className="grid gap-2">
            {options.map((o) => (
              <button key={o.value} type="button" onClick={() => setResp(o.value)} aria-pressed={resp === o.value}
                disabled={(o.value === "MEMBER_B_100" && !memberB && resp !== "MEMBER_B_100") || (parentCat?.responsibility === "PRIVATE" && o.value !== "PRIVATE")}
                className={cn("rounded-2xl border px-4 py-2.5 text-left disabled:opacity-50", resp === o.value ? "border-olive bg-olive-soft" : "border-border bg-surface")}>
                <span className="block font-medium">{o.title}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </button>
            ))}
          </div>
        </Field>}

        {canSeeBudget && (resp === "FIXED_AMOUNTS" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Aporta ${memberA?.display_name ?? "A"}`}><AmountInput value={fixedA} onChange={setFixedA} /></Field>
            <Field label={`Aporta ${memberB?.display_name ?? "B"}`}><AmountInput value={fixedB} onChange={setFixedB} /></Field>
            <p className="col-span-2 -mt-1 text-sm text-muted">Presupuesto total: <span className="num font-semibold text-text">{formatCop(fixedTotal)}</span></p>
          </div>
        ) : (
          <Field label="Presupuesto por periodo"><AmountInput value={amount} onChange={setAmount} /></Field>
        ))}
        {canSeeBudget && category && (
          <p className="-mt-2 text-xs text-muted">Un cambio de monto aplica desde el periodo actual ({periodLabel(periodFor(settings, todayBogota()))}); los anteriores quedan igual.</p>
        )}

        {!isPrivate && canSeeBudget && (
          <>
            <SwitchRow label="Obligación del hogar" hint="Lo que falte por pagar se aparta del Saldo Seguro del responsable."
              checked={obligation} onCheckedChange={setObligation} />
            <SwitchRow label="Progreso compartido" hint="Los dos ven la barra, el límite y los movimientos."
              checked={shared} onCheckedChange={setShared} />
          </>
        )}
        {canSeeBudget && <SwitchRow label="Pasar el saldo al siguiente periodo" hint="Rollover: el sobrante suma y el sobregiro resta en el siguiente periodo."
          checked={rollover} onCheckedChange={setRollover} />}

        </>)}

        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          {category && (
            <Button variant="secondary" size="icon" onClick={toggleArchive} disabled={busy} aria-label={category.archived ? "Restaurar" : "Archivar"}>
              {category.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
            </Button>
          )}
          <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</Button>
        </div>
      </div>
    </Sheet>
  );
}
