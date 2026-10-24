"use client";

import { useEffect } from "react";
import { Check, X } from "lucide-react";
import type { Member } from "@/lib/types";
import { useHouseholdOptional } from "./HouseholdProvider";

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 pb-4 pt-6">
      <div className="min-w-0">
        <h1 className="titulo text-[44px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-sec first-letter:uppercase">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

/** Colores por persona: rosa con letra oscura, bordó con letra clara. */
/** Texto único para "los dos" en toda la app */
export const JUNTOS = "Juntos";

/** Opciones de "¿Quién?": Persona 1, Persona 2, [Rotar], Juntos (siempre en ese orden) */
export function quienOptions(members: Member[], { rotar = false }: { rotar?: boolean } = {}) {
  return [
    ...members.map((m) => ({ value: m.id, label: m.nombre })),
    ...(rotar && members.length > 1 ? [{ value: "rota", label: "Rotar" }] : []),
    { value: "juntos", label: JUNTOS },
  ];
}

export function personColors(m?: Pick<Member, "color"> | null) {
  if (!m) return "bg-rosa-claro text-vino";
  return m.color === "rosa" ? "bg-rosa text-vino" : "bg-vino text-crema";
}

export function Avatar({
  member,
  size = 30,
  juntos = false,
  onClick,
  label,
}: {
  member?: Member | null;
  size?: number;
  juntos?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const Comp = onClick ? "button" : "span";
  const pareja = useHouseholdOptional()?.members ?? [];
  if (juntos || !member) {
    // Juntos: las iniciales de los dos, superpuestas
    if (pareja.length === 2) {
      return (
        <Comp
          onClick={onClick}
          aria-label={label ?? `Juntos: ${pareja[0].nombre} y ${pareja[1].nombre}`}
          title={`${pareja[0].nombre} y ${pareja[1].nombre}`}
          className="inline-flex shrink-0 items-center"
        >
          {pareja.map((m, i) => (
            <span
              key={m.id}
              className={`inline-flex items-center justify-center rounded-full border-2 border-vino font-semibold ${personColors(m)}`}
              style={{ width: size, height: size, fontSize: size * 0.42, marginLeft: i ? -size * 0.3 : 0 }}
            >
              {m.nombre.charAt(0).toUpperCase()}
            </span>
          ))}
        </Comp>
      );
    }
    return (
      <Comp
        onClick={onClick}
        aria-label={label ?? "Juntos"}
        className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-vino bg-rosa-claro px-2 text-[11px] font-semibold"
        style={{ height: size }}
      >
        Juntos
      </Comp>
    );
  }
  return (
    <Comp
      onClick={onClick}
      aria-label={label ?? member.nombre}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-2 border-vino font-semibold ${personColors(member)}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {member.nombre.charAt(0).toUpperCase()}
    </Comp>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border-[3px] border-vino ${
        checked ? "bg-accion" : "bg-white"
      }`}
    >
      {checked && <Check size={16} strokeWidth={3.5} className="text-crema" />}
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full border-[3px] border-vino ${checked ? "bg-accion" : "bg-rosa-claro"}`}
    >
      <span
        className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-vino bg-crema transition-all ${
          checked ? "left-[26px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

export function Pills<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 ${className}`}>
      {options.map((o) => (
        <button key={o.value} className={`pill ${value === o.value ? "pill-on" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Panel que sube desde abajo */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Cerrar" className="absolute inset-0 bg-vino/40" onClick={onClose} />
      <div className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[20px] border-[3px] border-b-0 border-vino bg-crema px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-3">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-rosa" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="titulo text-[28px]">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-[10px] border-2 border-vino p-1.5">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[20px] border-[3px] border-dashed border-rosa p-4 text-center text-sm text-sec">{children}</p>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-2 rounded-[10px] bg-rosa-claro px-3 py-2 text-sm font-medium text-accion">{children}</p>;
}

/** Mensaje de error legible desde Supabase */
export function errMsg(e: unknown): string {
  if (!e) return "";
  if (typeof e === "object" && e && "message" in e) return String((e as { message: string }).message);
  return "Algo salió mal. Intenta de nuevo.";
}
