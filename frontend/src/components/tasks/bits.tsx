import { AlertOctagon, Bookmark, Bug, CalendarDays, CheckSquare, Flame, Ticket } from "lucide-react";
import type { Priority, Status, StatusCategory, TaskType } from "@/lib/types";
import { cn, dueState, fmtDate, PRIORITY_LABEL, TYPE_LABEL } from "@/lib/utils";

/** Icono de estado: círculo que se rellena según la categoría. */
export function StatusIcon({ status, size = 14 }: { status: Pick<Status, "category" | "color"> | null; size?: number }) {
  const cat: StatusCategory = status?.category ?? "todo";
  const color = status?.color ?? "#98A2B3";
  const r = size / 2 - 1.25;
  const c = size / 2;
  if (cat === "done") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={r + 0.5} fill={color} />
        <path d={`M${size * 0.3} ${size * 0.52} l${size * 0.14} ${size * 0.14} l${size * 0.27} -${size * 0.3}`} stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (cat === "blocked") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={r} stroke={color} strokeWidth="1.5" fill="none" />
        <path d={`M${size * 0.32} ${c} H${size * 0.68}`} stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  const frac = cat === "in_progress" ? 0.5 : cat === "review" ? 0.75 : 0;
  const ir = r - 2;
  const angle = frac * 2 * Math.PI;
  const x = c + ir * Math.sin(angle);
  const y = c - ir * Math.cos(angle);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={c} cy={c} r={r} stroke={color} strokeWidth="1.5" fill="none" strokeDasharray={cat === "todo" ? "2 1.6" : undefined} />
      {frac > 0 && <path d={`M${c} ${c} L${c} ${c - ir} A${ir} ${ir} 0 ${frac > 0.5 ? 1 : 0} 1 ${x} ${y} Z`} fill={color} />}
    </svg>
  );
}

const PRIORITY_COLOR: Record<Priority, string> = {
  none: "#98A2B3", low: "#667085", medium: "#F79009", high: "#F04438", urgent: "#F04438",
};

export function PriorityIcon({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  const color = PRIORITY_COLOR[priority];
  const level = { none: 0, low: 1, medium: 2, high: 3, urgent: 3 }[priority];
  return (
    <span className="inline-flex items-center gap-1.5" title={PRIORITY_LABEL[priority]}>
      {priority === "urgent" ? (
        <Flame className="h-3.5 w-3.5" style={{ color }} aria-hidden />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={2 + i * 4} y={9 - i * 3} width="2.5" height={3 + i * 3} rx="0.8" fill={i < level ? color : "rgb(var(--line-strong))"} />
          ))}
        </svg>
      )}
      {withLabel && <span className="text-[13px]" style={priority === "none" ? undefined : { color }}>{PRIORITY_LABEL[priority]}</span>}
    </span>
  );
}

const TYPE_ICON: Record<TaskType, { icon: typeof Bug; color: string }> = {
  task: { icon: CheckSquare, color: "#2563EB" },
  bug: { icon: Bug, color: "#F04438" },
  story: { icon: Bookmark, color: "#12B76A" },
  incident: { icon: AlertOctagon, color: "#F79009" },
  ticket: { icon: Ticket, color: "#8B5CF6" },
};

export function TypeIcon({ type, withLabel }: { type: TaskType; withLabel?: boolean }) {
  const { icon: Icon, color } = TYPE_ICON[type];
  return (
    <span className="inline-flex items-center gap-1.5" title={TYPE_LABEL[type]}>
      <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden />
      {withLabel && <span className="text-[13px]">{TYPE_LABEL[type]}</span>}
    </span>
  );
}

export function DueBadge({ date, done, className }: { date: string | null; done?: boolean; className?: string }) {
  if (!date) return null;
  const state = dueState(date, !!done);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        state === "overdue" ? "font-medium text-blocked" : state === "soon" ? "text-risk" : "text-ink-2",
        className,
      )}
      title={state === "overdue" ? "Vencida" : undefined}
    >
      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
      {fmtDate(date)}
    </span>
  );
}
