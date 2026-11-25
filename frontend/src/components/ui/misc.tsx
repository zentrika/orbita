import { Loader2 } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import type { UserBrief } from "@/lib/types";

export function Avatar({ user, size = 24, className }: { user: Pick<UserBrief, "full_name" | "avatar_color"> | null | undefined; size?: number; className?: string }) {
  if (!user) {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-3", className)}
        style={{ width: size, height: size }}
        aria-label="Sin asignar"
      />
    );
  }
  return (
    <span
      title={user.full_name}
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface", className)}
      style={{ width: size, height: size, background: user.avatar_color, fontSize: Math.max(9, size * 0.4) }}
    >
      {initials(user.full_name)}
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 28 }: { users: UserBrief[]; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} />
      ))}
      {rest > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-subtle text-xs font-medium text-ink-2 ring-2 ring-surface"
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-ink-3", className)} aria-label="Cargando" />;
}

export function PageLoader() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center">
      <Spinner />
    </div>
  );
}

export function ProgressBar({ value, color = "#12B76A", className }: { value: number; color?: string; className?: string }) {
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-subtle", className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, value)}%`, background: color }} />
    </div>
  );
}

export function Empty({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-subtle px-1.5 py-0.5 font-sans text-2xs text-ink-2">{children}</kbd>;
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="chip h-[22px] px-1.5 text-[11.5px]" style={{ background: `${color}14`, color }}>
      {name}
    </span>
  );
}

export function Field({ label, error, hint, children, htmlFor }: {
  label: string; error?: string; hint?: string; children: React.ReactNode; htmlFor?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-blocked">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-2">{hint}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-md px-2.5 text-[13px] font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-xs" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
