"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import * as P from "@radix-ui/react-popover";
import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = "end", className }: { children: React.ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-[180px] animate-pop-in rounded-xl border border-line bg-surface p-1 shadow-md", className)}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ children, onSelect, danger, icon }: {
  children: React.ReactNode; onSelect?: () => void; danger?: boolean; icon?: React.ReactNode;
}) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-subtle",
        danger ? "text-blocked" : "text-ink",
      )}
    >
      {icon && <span className="text-ink-3 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      {children}
    </DM.Item>
  );
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <DM.Label className="px-2.5 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-ink-3">{children}</DM.Label>
);

export interface PickerOption<T> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
}

/** Selector con búsqueda (popover accesible). Soporta selección simple o múltiple. */
export function Picker<T extends string | number | null>({
  trigger, options, value, onChange, multiple, placeholder = "Buscar…", align = "start", searchable = true, disabled, onCreate,
  createLabel = "Crear",
}: {
  trigger: React.ReactNode;
  options: PickerOption<T>[];
  value: T | T[];
  onChange: (v: T | T[]) => void;
  multiple?: boolean;
  placeholder?: string;
  align?: "start" | "end";
  searchable?: boolean;
  disabled?: boolean;
  /** Permite crear una opción nueva con el texto buscado cuando no existe. */
  onCreate?: (text: string) => void | Promise<void>;
  createLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())),
    [options, q],
  );
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);

  if (disabled) return <>{trigger}</>;
  return (
    <P.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={6} className="z-50 w-64 animate-pop-in rounded-xl border border-line bg-surface shadow-md">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="h-3.5 w-3.5 text-ink-3" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={placeholder}
                className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-ink-3"
              />
            </div>
          )}
          <div className="scroll-thin max-h-64 overflow-y-auto p-1" role="listbox" aria-multiselectable={multiple}>
            {filtered.length === 0 && !(onCreate && q.trim()) && <p className="px-2.5 py-2 text-[13px] text-ink-3">Sin resultados</p>}
            {onCreate && q.trim() && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase()) && (
              <button
                onClick={async () => { await onCreate(q.trim()); setQ(""); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-primary hover:bg-subtle"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded border border-primary/40 text-xs leading-none">+</span>
                {createLabel} «{q.trim()}»
              </button>
            )}
            {filtered.map((o) => (
              <button
                key={String(o.value)}
                role="option"
                aria-selected={selected(o.value)}
                onClick={() => {
                  if (multiple) {
                    const arr = Array.isArray(value) ? value : [];
                    onChange(arr.includes(o.value) ? arr.filter((v) => v !== o.value) : [...arr, o.value]);
                  } else {
                    onChange(o.value);
                    setOpen(false);
                  }
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-subtle"
              >
                {o.icon}
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-2xs text-ink-3">{o.hint}</span>}
                {selected(o.value) && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
