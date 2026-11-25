import type { Activity } from "@/lib/types";
import { CATEGORY_LABEL, fmtRelative, PRIORITY_LABEL, TYPE_LABEL } from "@/lib/utils";
import { Avatar } from "@/components/ui/misc";

const FIELD: Record<string, string> = {
  title: "el título", status_id: "el estado", priority: "la prioridad", assignee_id: "el responsable", due_date: "la fecha límite",
  start_date: "la fecha de inicio", description: "la descripción", type: "el tipo", estimate_minutes: "la estimación",
  labels: "las etiquetas", sprint_id: "el sprint", milestone_id: "el hito", parent_id: "la tarea padre", name: "el nombre",
  status: "el estado del proyecto", visibility: "la visibilidad", color: "el color", end_date: "la fecha de fin",
};

function val(field: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (field === "priority") return PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? String(v);
  if (field === "type") return TYPE_LABEL[v as keyof typeof TYPE_LABEL] ?? String(v);
  if (field === "status") return CATEGORY_LABEL[v as keyof typeof CATEGORY_LABEL] ?? String(v);
  if (["status_id", "title", "due_date", "start_date", "end_date", "name"].includes(field)) return String(v);
  return null;
}

export function describe(a: Activity, withTask = false): string {
  const on = withTask && a.task_key ? ` en ${a.task_key}` : "";
  const ch = a.changes ?? {};
  switch (a.action) {
    case "created":
      if (a.entity_type === "task") return `creó la tarea${on}${withTask ? "" : ""}`;
      if (a.entity_type === "project") return "creó el proyecto";
      return `creó ${a.entity_type === "label" ? "una etiqueta" : a.entity_type === "milestone" ? "un hito" : a.entity_type === "sprint" ? "un sprint" : "un elemento"}`;
    case "updated": {
      const keys = Object.keys(ch);
      if (keys.length === 1) {
        const k = keys[0];
        const pair = ch[k] as [unknown, unknown];
        const to = Array.isArray(pair) ? val(k, pair[1]) : null;
        return `cambió ${FIELD[k] ?? k}${to ? ` a «${to}»` : ""}${on}`;
      }
      return `actualizó ${keys.map((k) => FIELD[k] ?? k).join(", ")}${on}`;
    }
    case "commented": return `comentó${on}`;
    case "attached": return `adjuntó un archivo${on}`;
    case "attachment_deleted": return `eliminó un adjunto${on}`;
    case "deleted": return a.entity_type === "project" ? "archivó el proyecto" : `eliminó la tarea${on}`;
    case "relation_added": return `añadió una relación${on}`;
    case "relation_removed": return `quitó una relación${on}`;
    case "time_logged": {
      const m = (ch.minutes as [null, number] | undefined)?.[1] ?? 0;
      return `registró ${m >= 60 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`}${on}`;
    }
    case "member_added": return "añadió un miembro al proyecto";
    case "comment_deleted": return `eliminó un comentario${on}`;
    default: return `${a.action}${on}`;
  }
}

export function ActivityFeed({ items, withTask }: { items: Activity[]; withTask?: boolean }) {
  if (!items.length) return <p className="py-4 text-sm text-ink-3">Sin actividad todavía.</p>;
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-2.5 text-[13px]">
          <Avatar user={a.actor} size={22} className="mt-px" />
          <p className="min-w-0 flex-1 leading-5 text-ink-2">
            <span className="font-medium text-ink">{a.actor?.full_name ?? "Sistema"}</span> {describe(a, withTask)}
            <span className="ml-1.5 whitespace-nowrap text-ink-3">· {fmtRelative(a.created_at)}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}
