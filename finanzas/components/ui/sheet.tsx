"use client";
import * as React from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hoja que sube desde abajo en el celular y se centra en escritorio.
 * `footer` queda fijo abajo (para Guardar), aunque el contenido sea largo.
 * El botón "atrás" del celular cierra la hoja en vez de salir de la pantalla.
 */
export function Sheet({
  open, onOpenChange, title, description, children, footer, className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  useBackButtonCloses(open, onOpenChange);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[28px] border border-border bg-bg shadow-soft outline-none",
            "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[min(560px,92vw)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px]",
            className,
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border md:hidden" />
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-3">
            <div>
              <Dialog.Title className="font-display text-2xl">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Cerrar">
              <X size={20} />
            </Dialog.Close>
          </div>
          <div className={cn("min-h-0 overflow-y-auto px-5", footer ? "pb-4" : "pb-[calc(20px+env(safe-area-inset-bottom))]")}>{children}</div>
          {footer && (
            <div className="shrink-0 border-t border-border bg-bg px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 md:rounded-b-[28px]">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

let seq = 0;
/** "Atrás" que pidió una hoja al cerrarse y aún no llega; mientras tanto las hojas nuevas esperan para no perder su entrada. */
let pendingBacks = 0;
let popIsOurs = false;
const waiting: (() => void)[] = [];
let listening = false;

function listenOnce() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Va antes que los de cada hoja: marca si este "atrás" lo pidió una hoja al cerrarse
  window.addEventListener("popstate", () => {
    popIsOurs = pendingBacks > 0;
    if (pendingBacks > 0) pendingBacks--;
    if (pendingBacks === 0) waiting.splice(0).forEach((push) => push());
  });
}

/** Mientras la hoja está abierta hay una entrada en el historial: "atrás" la quita y cierra la hoja. */
function useBackButtonCloses(open: boolean, onOpenChange: (open: boolean) => void) {
  const close = React.useRef(onOpenChange);
  close.current = onOpenChange;
  React.useEffect(() => {
    if (!open || typeof window === "undefined") return;
    listenOnce();
    const mine = ++seq;
    let pushed = false;
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      window.history.pushState({ ...(window.history.state ?? {}), __sheet: mine }, "", window.location.href);
      pushed = true;
    };
    if (pendingBacks > 0) waiting.push(push);
    else push();
    let poppedByBack = false;
    const onPop = () => {
      if (popIsOurs || !pushed) return;
      // Se quitó nuestra entrada (atrás del celular): cerrar. Si quedó otra hoja encima, no es la nuestra.
      if ((window.history.state as { __sheet?: number } | null)?.__sheet !== mine && !poppedByBack) {
        poppedByBack = true;
        close.current(false);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", onPop);
      // Se cerró con la X, al guardar o tocando afuera: quitar la entrada que pusimos
      if (pushed && !poppedByBack && (window.history.state as { __sheet?: number } | null)?.__sheet === mine) {
        pendingBacks++;
        window.history.back();
      }
    };
  }, [open]);
}
