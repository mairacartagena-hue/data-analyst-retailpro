"use client";

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import type { BudgetPlan, Space } from "@/lib/types";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { AmountInput } from "@/components/AmountInput";
import { CategoryOptions } from "@/components/CategoryPicker";
import { formatCop, parseCop } from "@/lib/finance/money";
import { periodFor, todayBogota } from "@/lib/finance/periods";
import { categoryPath } from "@/lib/finance/spaces";
import { errMsg } from "@/lib/utils";

interface Line {
  categoryId: string;
  amount: string;
}

/** Crear o editar un presupuesto con nombre (del hogar o personal). */
export function PlanSheet({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (v: boolean) => void; plan: BudgetPlan | null }) {
  const { categories, planCategories, settings, supabase, reload, me } = useFinance();
  const [scope, setScope] = useState<Space>("HOUSEHOLD");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [amount, setAmount] = useState("");
  const [periodicity, setPeriodicity] = useState<BudgetPlan["periodicity"]>("PERIOD");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [alert, setAlert] = useState("85");
  const [status, setStatus] = useState<BudgetPlan["status"]>("ACTIVE");
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPick("");
    if (plan) {
      setScope(plan.scope);
      setName(plan.name);
      setIcon(plan.icon ?? "");
      setAmount(String(plan.amount));
      setPeriodicity(plan.periodicity);
      setStart(plan.start_date);
      setEnd(plan.end_date ?? "");
      setAlert(String(plan.alert_pct));
      setStatus(plan.status);
      setLines(planCategories.filter((c) => c.plan_id === plan.id).map((c) => ({ categoryId: c.category_id, amount: c.amount != null ? String(c.amount) : "" })));
    } else {
      setScope("HOUSEHOLD");
      setName("");
      setIcon("");
      setAmount("");
      setPeriodicity("PERIOD");
      setStart(periodFor(settings, todayBogota()).start);
      setEnd("");
      setAlert("85");
      setStatus("ACTIVE");
      setLines([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan]);

  // Un presupuesto del hogar solo usa categorías del hogar; uno personal, también las personales propias
  const available = categories.filter((c) => !c.archived && c.kind !== "INCOME"
    && (c.responsibility !== "PRIVATE" || (scope === "PERSONAL" && c.owner_user_id === me.user_id))
    && !lines.some((l) => l.categoryId === c.id));
  const canMakePersonal = !plan || plan.owner_user_id === me.user_id;
  const linesTotal = lines.reduce((a, l) => a + (parseCop(l.amount) ?? 0), 0);

  function addLine(id: string) {
    if (!id) return;
    setLines([...lines, { categoryId: id, amount: "" }]);
    setPick("");
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Ponle un nombre.");
    if (lines.length === 0) return setError("Elige al menos una categoría.");
    if (periodicity === "RANGE" && !end) return setError("Elige la fecha de fin.");
    const pct = Number(alert);
    if (!Number.isInteger(pct) || pct < 10 || pct > 100) return setError("La alerta va de 10 % a 100 %.");
    setBusy(true);
    const { error } = await supabase.rpc("save_budget_plan", {
      p: {
        id: plan?.id ?? null,
        scope,
        name,
        icon,
        periodicity,
        amount: parseCop(amount) ?? linesTotal,
        start_date: start || null,
        end_date: end || null,
        alert_pct: pct,
        status,
        categories: lines.map((l) => ({ category_id: l.categoryId, amount: l.amount ? parseCop(l.amount) : null })),
      },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  async function remove() {
    if (!plan || !confirm("¿Borrar este presupuesto? Los movimientos no se tocan.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_budget_plan", { p_id: plan.id });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={plan ? "Editar presupuesto" : "Nuevo presupuesto"}
      description="Agrupa categorías con un límite. Una categoría principal incluye sus subcategorías.">
      <div className="space-y-4 pb-2">
        <Field label="¿De qué espacio?">
          <Segmented value={scope} onChange={(v) => {
            if (v === "PERSONAL" && !canMakePersonal) return;
            setScope(v);
            if (v === "HOUSEHOLD") setLines(lines.filter((l) => categories.find((c) => c.id === l.categoryId)?.responsibility !== "PRIVATE"));
          }} options={[
            { value: "HOUSEHOLD", label: "Hogar" },
            { value: "PERSONAL", label: "Personal" },
          ]} />
          <p className="mt-1.5 text-xs text-muted">
            {scope === "HOUSEHOLD"
              ? "Lo ven los dos y suma los gastos del hogar, pague quien pague."
              : "Solo tú lo ves. Suma tus gastos personales en estas categorías."}
          </p>
        </Field>

        <div className="grid grid-cols-[72px_1fr] gap-3">
          <Field label="Ícono" htmlFor="plan-icon">
            <Input id="plan-icon" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} className="text-center text-xl" placeholder="🧺" />
          </Field>
          <Field label="Nombre" htmlFor="plan-name">
            <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Comida, Casa, Mis gustos…" />
          </Field>
        </div>

        <Field label="Categorías incluidas">
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.categoryId} className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-2 pl-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{categoryPath(categories, l.categoryId) || "Categoría"}</span>
                <AmountInput value={l.amount} placeholder="Límite" className="w-[140px]"
                  onChange={(v) => setLines(lines.map((x) => (x.categoryId === l.categoryId ? { ...x, amount: v } : x)))} />
                <button aria-label="Quitar" className="p-1.5 text-muted" onClick={() => setLines(lines.filter((x) => x.categoryId !== l.categoryId))}>
                  <X size={16} />
                </button>
              </div>
            ))}
            <Select value={pick} onChange={(e) => addLine(e.target.value)} aria-label="Agregar categoría">
              <option value="">+ Agregar categoría…</option>
              <CategoryOptions categories={available} />
            </Select>
          </div>
        </Field>

        <Field label="Límite total" hint={linesTotal > 0 ? `Si lo dejas vacío, es la suma de los límites por categoría (${formatCop(linesTotal)}).` : undefined}>
          <AmountInput value={amount} onChange={setAmount} />
        </Field>

        <Field label="Periodicidad">
          <Segmented value={periodicity} onChange={setPeriodicity} options={[
            { value: "PERIOD", label: "Cada periodo" },
            { value: "RANGE", label: "Rango de fechas" },
          ]} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label={periodicity === "RANGE" ? "Hasta" : "Hasta (opcional)"}><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Alerta al llegar a (%)">
            <Input type="number" inputMode="numeric" min={10} max={100} value={alert} onChange={(e) => setAlert(e.target.value)} />
          </Field>
          <Field label="Estado">
            <Select value={status} onChange={(e) => setStatus(e.target.value as BudgetPlan["status"])}>
              <option value="ACTIVE">Activo</option>
              <option value="PAUSED">En pausa (sin alertas)</option>
              <option value="CLOSED">Cerrado</option>
            </Select>
          </Field>
        </div>

        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          {plan && (
            <Button variant="danger" size="icon" onClick={remove} disabled={busy} aria-label="Borrar">
              <Trash2 size={18} />
            </Button>
          )}
          <Button className="flex-1" size="lg" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</Button>
        </div>
      </div>
    </Sheet>
  );
}
