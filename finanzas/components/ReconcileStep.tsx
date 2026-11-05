import * as React from "react";
import { CheckCircle2 } from "lucide-react";

/** Un paso del cruce con el banco en el Cierre del mes: número, título, para qué sirve y, si ya se hizo, su resultado. */
export function ReconcileStep({ step, icon, title, question, done, children }: {
  step?: number;
  icon: React.ReactNode;
  title: string;
  question: string;
  done?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        {step !== undefined && (
          <span className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-olive text-base font-semibold text-on-olive">{step}</span>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="text-muted">{icon}</span>
            {step !== undefined ? `Paso ${step} · ` : ""}{title}
          </h3>
          <p className="text-xs text-muted">{question}</p>
          {done && (
            <p className="flex items-center gap-1 text-xs font-medium text-olive"><CheckCircle2 size={14} /> {done}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
