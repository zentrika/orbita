import { clsx, type ClassValue } from "clsx";
import { differenceInCalendarDays, format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { Priority, StatusCategory, TaskType } from "./types";

export const cn = (...v: ClassValue[]) => clsx(v);

export function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  // Fechas "YYYY-MM-DD" se interpretan en hora local, no UTC.
  const date = d.length === 10 ? new Date(`${d}T00:00:00`) : parseISO(d.endsWith("Z") || d.includes("+") ? d : `${d}Z`);
  return isValid(date) ? date : null;
}

export function fmtDate(d: string | null | undefined, pattern = "d MMM") {
  const date = parseDate(d);
  return date ? format(date, pattern, { locale: es }) : "";
}

export function fmtRelative(d: string | null | undefined) {
  const date = parseDate(d);
  return date ? formatDistanceToNowStrict(date, { addSuffix: true, locale: es }) : "";
}

export function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function dueState(due: string | null, done: boolean): "overdue" | "soon" | "normal" | null {
  const date = parseDate(due);
  if (!date || done) return null;
  const diff = differenceInCalendarDays(date, new Date());
  if (diff < 0) return "overdue";
  if (diff <= 2) return "soon";
  return "normal";
}

export function fmtMinutes(m: number | null | undefined) {
  if (!m) return "0 h";
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (!h) return `${min} min`;
  return min ? `${h} h ${min} min` : `${h} h`;
}

/** "2h 30m", "90m", "1.5h" → minutos */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
  let total = 0;
  const h = t.match(/(\d+(?:\.\d+)?)\s*h/);
  const m = t.match(/(\d+)\s*m/);
  if (h) total += parseFloat(h[1]) * 60;
  if (m) total += parseInt(m[1], 10);
  return h || m ? Math.round(total) : null;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  pmo: "PMO",
  member: "Miembro",
  guest: "Invitado",
  manager: "Gerente de proyecto",
};

export const TYPE_LABEL: Record<TaskType, string> = {
  task: "Tarea",
  bug: "Bug",
  story: "Historia",
  incident: "Incidencia",
  ticket: "Ticket",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: "Sin prioridad",
  low: "Baja",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  todo: "Por hacer",
  in_progress: "En progreso",
  review: "En revisión",
  done: "Hecho",
  blocked: "Bloqueado",
};

export const HEALTH: Record<string, { label: string; color: string }> = {
  on_track: { label: "En curso", color: "#12B76A" },
  at_risk: { label: "En riesgo", color: "#F79009" },
  off_track: { label: "Retrasado", color: "#F04438" },
  done: { label: "Completado", color: "#667085" },
};

export const SWATCHES = ["#4F46E5", "#2563EB", "#0E9384", "#12B76A", "#F79009", "#F04438", "#8B5CF6", "#DD2590", "#475467", "#98A2B3"];
