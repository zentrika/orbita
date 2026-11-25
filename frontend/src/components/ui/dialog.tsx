"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({
  open, onOpenChange, title, description, children, footer, size = "md",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[#0C111D]/40 backdrop-blur-[1px]" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-[10vh] z-50 flex max-h-[80vh] w-[calc(100vw-32px)] -translate-x-1/2 animate-pop-in flex-col rounded-xl border border-line bg-surface shadow-lg focus:outline-none",
            size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="font-display text-base font-semibold text-ink">{title}</D.Title>
              {description ? (
                <D.Description className="mt-0.5 text-sm text-ink-2">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close className="-mr-1 rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </D.Close>
          </div>
          <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-muted/60 px-5 py-3 rounded-b-xl">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = "Confirmar", onConfirm, danger, loading,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirmLabel?: string;
  onConfirm: () => void; danger?: boolean; loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <button className="h-9 rounded-lg px-3.5 text-sm font-medium text-ink-2 hover:bg-subtle" onClick={() => onOpenChange(false)}>
            Cancelar
          </button>
          <button
            disabled={loading}
            onClick={onConfirm}
            className={cn(
              "h-9 rounded-lg px-3.5 text-sm font-medium text-white disabled:opacity-60",
              danger ? "bg-blocked hover:bg-[#D92D20]" : "bg-primary hover:bg-primary-hover",
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-2">{description}</p>
    </Dialog>
  );
}
