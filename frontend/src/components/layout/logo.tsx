import { cn } from "@/lib/utils";

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="10" fill="none" stroke={light ? "#fff" : "rgb(var(--primary))"} strokeWidth="3.2" />
        <circle cx="25" cy="8" r="3.4" fill={light ? "#A5B4FC" : "rgb(var(--primary))"} />
      </svg>
      <span className={cn("font-display text-[19px] font-bold tracking-tight", light ? "text-white" : "text-ink")}>Órbita</span>
    </span>
  );
}
