"use client";
import * as React from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Hoja que sube desde abajo en el celular y se centra en escritorio. */
export function Sheet({
  open, onOpenChange, title, description, children, className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
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
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border md:hidden" />
          <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3">
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
          <div className="overflow-y-auto px-5 pb-[calc(20px+env(safe-area-inset-bottom))]">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
