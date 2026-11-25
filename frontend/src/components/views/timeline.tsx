"use client";

import { addDays, differenceInCalendarDays, format, isWeekend, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown, ChevronLeft, ChevronRight, Diamond } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { StatusIcon } from "@/components/tasks/bits";
import { Button } from "@/components/ui/button";
import { Avatar, Segmented } from "@/components/ui/misc";
import { useMilestones, useRelations, useUpdateTask } from "@/lib/queries";
import type { Milestone, ProjectDetail, Task } from "@/lib/types";
import { cn, fmtDate, parseDate, toISODate } from "@/lib/utils";

const ROW = 44;
const GROUP_ROW = 40;
const LEFT = 300;
const ZOOM = { weeks3: { days: 21, w: 44 }, weeks6: { days: 42, w: 30 }, months3: { days: 91, w: 16 } } as const;
type Zoom = keyof typeof ZOOM;

const BAR: Record<string, { bg: string; border: string; text: string }> = {
  done: { bg: "#12B76A1F", border: "#12B76A66", text: "#027A48" },
  in_progress: { bg: "#2563EB1F", border: "#2563EB80", text: "#1D4ED8" },
  review: { bg: "#8B5CF61F", border: "#8B5CF680", text: "#6D28D9" },
  blocked: { bg: "#F044381F", border: "#F0443880", text: "#B42318" },
  todo: { bg: "#8B5CF614", border: "#8B5CF64D", text: "#5B21B6" },
};

type Drag = { id: number; mode: "move" | "start" | "end"; x0: number; start: Date; end: Date; dx: number };

export function TimelineView({ orgId, project, tasks }: { orgId: number; project: ProjectDetail; tasks: Task[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const update = useUpdateTask(orgId);
  const { data: edges } = useRelations(orgId, project.id);
  const { data: milestones } = useMilestones(orgId, project.id);
  const canEdit = project.permissions.includes("edit");
  const [zoom, setZoom] = useState<Zoom>("weeks6");
  const [origin, setOrigin] = useState(() => startOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 }));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const { days, w } = ZOOM[zoom];
  const width = days * w;

  // Agrupa por hito (fases) y dentro por fecha de inicio.
  const groups = useMemo(() => {
    const ms: (Milestone | null)[] = [...(milestones ?? []), null];
    return ms
      .map((m) => ({
        key: m ? `m${m.id}` : "none",
        milestone: m,
        items: tasks
          .filter((t) => (m ? t.milestone_id === m.id : !t.milestone_id || !milestones?.some((x) => x.id === t.milestone_id)))
          .filter((t) => t.start_date || t.due_date)
          .sort((a, b) => (a.start_date ?? a.due_date ?? "").localeCompare(b.start_date ?? b.due_date ?? "")),
      }))
      .filter((g) => g.items.length || g.milestone);
  }, [tasks, milestones]);
  const unscheduled = tasks.filter((t) => !t.start_date && !t.due_date).length;

  // Posición vertical de cada tarea, para dibujar las dependencias.
  const layout = useMemo(() => {
    const rows: { type: "group" | "task"; key: string; y: number; task?: Task; group?: (typeof groups)[number] }[] = [];
    const yOf: Record<number, number> = {};
    let y = 0;
    for (const g of groups) {
      rows.push({ type: "group", key: g.key, y, group: g });
      y += GROUP_ROW;
      if (collapsed[g.key]) continue;
      for (const t of g.items) {
        rows.push({ type: "task", key: `t${t.id}`, y, task: t });
        yOf[t.id] = y;
        y += ROW;
      }
    }
    return { rows, yOf, height: y };
  }, [groups, collapsed]);

  const applyDrag = (d: Drag): [Date, Date] => {
    const n = Math.round(d.dx / w);
    const len = differenceInCalendarDays(d.end, d.start);
    if (d.mode === "move") return [addDays(d.start, n), addDays(d.end, n)];
    if (d.mode === "start") return [addDays(d.start, Math.min(n, len)), d.end];
    return [d.start, addDays(d.end, Math.max(n, -len))];
  };
  const range = (t: Task): [Date, Date] => {
    if (drag?.id === t.id) return applyDrag(drag);
    const s = parseDate(t.start_date) ?? parseDate(t.due_date)!;
    return [s, parseDate(t.due_date) ?? s];
  };
  const xOf = (d: Date) => differenceInCalendarDays(d, origin) * w;

  // Las escuchas se registran en el mismo pointerdown: así no se pierde un pointerup rápido.
  const startDrag = (t: Task, mode: Drag["mode"]) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canEdit) {
      if (mode === "move") router.replace(`${pathname}?task=${t.id}`, { scroll: false });
      return;
    }
    const s = parseDate(t.start_date) ?? parseDate(t.due_date)!;
    let current: Drag = { id: t.id, mode, x0: e.clientX, start: s, end: parseDate(t.due_date) ?? s, dx: 0 };
    setDrag(current);
    const onMove = (ev: PointerEvent) => {
      current = { ...current, dx: ev.clientX - current.x0 };
      setDrag(current);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      current = { ...current, dx: ev.clientX - current.x0 };
      setDrag(null);
      if (Math.round(current.dx / w) !== 0) {
        const [ns, ne] = applyDrag(current);
        update.mutate({ id: current.id, data: { start_date: toISODate(ns), due_date: toISODate(ne) } });
      } else if (Math.abs(current.dx) < 3 && mode === "move") {
        router.replace(`${pathname}?task=${current.id}`, { scroll: false });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const weeks = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < days; i += 7) out.push(addDays(origin, i));
    return out;
  }, [origin, days]);
  const todayX = xOf(new Date()) + w / 2;
  const shift = (n: number) => setOrigin((o) => addDays(o, n));

  // Flechas de dependencia: del final de la tarea que bloquea al inicio de la bloqueada.
  const arrows = (edges ?? []).flatMap((e) => {
    const [from, to] = e.type === "blocks" ? [e.source_task_id, e.target_task_id] : [e.target_task_id, e.source_task_id];
    const a = tasks.find((t) => t.id === from);
    const b = tasks.find((t) => t.id === to);
    if (!a || !b || layout.yOf[from] === undefined || layout.yOf[to] === undefined) return [];
    const [, aEnd] = range(a);
    const [bStart] = range(b);
    const x1 = xOf(aEnd) + w - 2;
    const y1 = layout.yOf[from] + ROW / 2;
    const x2 = xOf(bStart) + 2;
    const y2 = layout.yOf[to] + ROW / 2;
    const late = aEnd >= bStart;
    // Si hay hueco, codo simple; si se solapan, rodeamos por la línea entre filas para no cruzar barras.
    const d = x2 - x1 >= 20
      ? `M${x1} ${y1} H${x1 + 10} V${y2} H${x2 - 4}`
      : (() => {
          const between = y2 > y1 ? layout.yOf[to] : layout.yOf[to] + ROW;
          return `M${x1} ${y1} H${x1 + 8} V${between} H${x2 - 12} V${y2} H${x2 - 4}`;
        })();
    return [{ id: e.id, d, late }];
  });

  return (
    <div className="flex flex-1 flex-col px-4 pb-8 sm:px-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented value={zoom} onChange={setZoom} options={[{ value: "weeks3", label: "3 semanas" }, { value: "weeks6", label: "6 semanas" }, { value: "months3", label: "3 meses" }]} />
        <div className="ml-auto flex items-center gap-1">
          <Button variant="secondary" size="icon-sm" onClick={() => shift(-7)} aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setOrigin(startOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 }))}>Hoy</Button>
          <Button variant="secondary" size="icon-sm" onClick={() => shift(7)} aria-label="Semana siguiente"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="card flex-1 overflow-hidden">
        <div ref={scroller} className="scroll-thin relative overflow-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
          <div style={{ width: LEFT + width }} className="relative">
            {/* Cabecera */}
            <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
              <div className="sticky left-0 z-10 flex shrink-0 items-end border-r border-line bg-surface px-4 pb-2 text-xs font-medium text-ink-2" style={{ width: LEFT, height: 56 }}>
                Tarea
              </div>
              <div className="relative" style={{ width }}>
                <div className="flex h-7 border-b border-line">
                  {weeks.map((wk) => (
                    <div key={wk.toISOString()} className="shrink-0 border-r border-line px-2 pt-1.5 text-xs font-semibold capitalize" style={{ width: 7 * w }}>
                      {format(wk, w >= 30 ? "MMMM yyyy" : "MMM", { locale: es })}
                    </div>
                  ))}
                </div>
                <div className="flex h-7">
                  {weeks.map((wk) => (
                    <div key={wk.toISOString()} className="shrink-0 border-r border-line px-2 pt-1.5 text-xs text-ink-2" style={{ width: 7 * w }}>
                      {format(wk, "d MMM", { locale: es })} – {format(addDays(wk, 6), "d MMM", { locale: es })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Cuerpo */}
            <div className="relative flex">
              <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface" style={{ width: LEFT }}>
                {layout.rows.map((r) =>
                  r.type === "group" ? (
                    <button key={r.key} onClick={() => setCollapsed((c) => ({ ...c, [r.key]: !c[r.key] }))}
                      className="flex w-full items-center gap-2 border-b border-line bg-muted px-3 text-left text-[13px] font-semibold" style={{ height: GROUP_ROW }}>
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", collapsed[r.key] && "-rotate-90")} />
                      <span className="truncate">{r.group!.milestone?.name ?? "Sin hito"}</span>
                      <span className="font-normal text-ink-3">{r.group!.items.length}</span>
                      {r.group!.milestone?.due_date && <span className="ml-auto text-xs font-normal text-ink-3">{fmtDate(r.group!.milestone.due_date)}</span>}
                    </button>
                  ) : (
                    <button key={r.key} onClick={() => router.replace(`${pathname}?task=${r.task!.id}`, { scroll: false })}
                      className="flex w-full items-center gap-2.5 border-b border-line px-4 text-left hover:bg-muted" style={{ height: ROW }}>
                      <StatusIcon status={r.task!.status} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{r.task!.title}</span>
                        <span className="block text-2xs text-ink-3">{fmtDate(r.task!.start_date)}{r.task!.start_date && " – "}{fmtDate(r.task!.due_date)}</span>
                      </span>
                      <Avatar user={r.task!.assignee} size={20} />
                    </button>
                  ),
                )}
              </div>

              <div className="relative" style={{ width, height: layout.height }}>
                {/* Rejilla de días */}
                <div className="absolute inset-0 flex">
                  {Array.from({ length: days }).map((_, i) => {
                    const d = addDays(origin, i);
                    return <div key={i} className={cn("shrink-0 border-r", i % 7 === 6 ? "border-line" : "border-line/40", isWeekend(d) && "bg-muted/70")} style={{ width: w }} />;
                  })}
                </div>
                {layout.rows.filter((r) => r.type === "group").map((r) => (
                  <div key={r.key} className="absolute inset-x-0 border-b border-line bg-muted/80" style={{ top: r.y, height: GROUP_ROW }} />
                ))}
                {/* Hoy */}
                {todayX >= 0 && todayX <= width && (
                  <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-primary" style={{ left: todayX }}>
                    <span className="absolute -left-6 -top-0 rounded-md bg-primary px-1.5 py-0.5 text-2xs font-semibold text-white">{format(new Date(), "d MMM", { locale: es })}</span>
                  </div>
                )}
                {/* Hitos */}
                {groups.map((g) => g.milestone?.due_date && (() => {
                  const x = xOf(parseDate(g.milestone!.due_date)!) + w / 2;
                  const row = layout.rows.find((r) => r.key === g.key)!;
                  return x >= 0 && x <= width ? (
                    <div key={g.key} className="absolute z-10 flex items-center gap-1.5" style={{ left: x - 7, top: row.y + 12 }} title={`${g.milestone!.name} · ${fmtDate(g.milestone!.due_date)}`}>
                      <Diamond className="h-3.5 w-3.5 fill-risk text-risk" />
                      <span className="whitespace-nowrap text-2xs font-semibold text-ink-2">{g.milestone!.name}</span>
                    </div>
                  ) : null;
                })())}
                {/* Dependencias */}
                <svg className="pointer-events-none absolute inset-0 z-[5] overflow-visible" width={width} height={layout.height} aria-hidden>
                  <defs>
                    <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0 0 L8 4 L0 8 z" fill="rgb(var(--ink-3))" />
                    </marker>
                    <marker id="arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0 0 L8 4 L0 8 z" fill="#F04438" />
                    </marker>
                  </defs>
                  {arrows.map((a) => (
                    <path key={a.id} d={a.d} fill="none" strokeWidth="1.25" stroke={a.late ? "#F04438" : "rgb(var(--ink-3))"} markerEnd={a.late ? "url(#arrow-late)" : "url(#arrow)"} />
                  ))}
                </svg>
                {/* Barras */}
                {layout.rows.filter((r) => r.type === "task").map((r) => {
                  const t = r.task!;
                  const [s, e] = range(t);
                  const left = xOf(s);
                  const barW = (differenceInCalendarDays(e, s) + 1) * w;
                  const tone = BAR[t.status?.category ?? "todo"];
                  const pct = t.subtask_count + t.checklist_total ? Math.round(((t.subtask_done + t.checklist_done) / (t.subtask_count + t.checklist_total)) * 100) : null;
                  const isDrag = drag?.id === t.id;
                  if (left + barW < 0 || left > width) return null;
                  return (
                    <div
                      key={r.key}
                      onPointerDown={startDrag(t, "move")}
                      className={cn("group absolute z-[6] flex select-none items-center gap-2 overflow-hidden rounded-lg border px-2.5", canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", isDrag && "z-20 shadow-md ring-2 ring-primary/30")}
                      style={{ left, width: Math.max(barW, w), top: r.y + 7, height: ROW - 14, background: tone.bg, borderColor: tone.border, color: tone.text }}
                      title={`${t.title} · ${fmtDate(toISODate(s))} – ${fmtDate(toISODate(e))}`}
                      role="button"
                      aria-label={`${t.title}, del ${fmtDate(toISODate(s))} al ${fmtDate(toISODate(e))}`}
                    >
                      {canEdit && <span onPointerDown={startDrag(t, "start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-black/5" aria-hidden />}
                      <span className="truncate text-xs font-semibold dark:text-ink">{t.title}</span>
                      {pct !== null && barW > 140 && <span className="ml-auto shrink-0 rounded bg-white/70 px-1 text-2xs font-semibold dark:bg-black/20">{pct}%</span>}
                      {canEdit && <span onPointerDown={startDrag(t, "end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-black/5" aria-hidden />}
                      {isDrag && (
                        <span className="pointer-events-none absolute -top-0.5 right-1 text-2xs font-medium">{fmtDate(toISODate(s))} – {fmtDate(toISODate(e))}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {!layout.rows.length && <p className="p-8 text-center text-sm text-ink-3">No hay tareas con fechas. Asigna fecha de inicio o límite para verlas aquí.</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5 border-t border-line px-4 py-2.5 text-xs text-ink-2">
          {[["#12B76A", "Completado"], ["#2563EB", "En progreso"], ["#8B5CF6", "Planificado / revisión"], ["#F04438", "Bloqueado"]].map(([c, l]) => (
            <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><Diamond className="h-3 w-3 fill-risk text-risk" />Hito</span>
          <span className="inline-flex items-center gap-1.5"><svg width="22" height="8"><path d="M0 4 H18" stroke="rgb(var(--ink-3))" /><path d="M16 1 L21 4 L16 7z" fill="rgb(var(--ink-3))" /></svg>Dependencia</span>
          {unscheduled > 0 && <span className="ml-auto text-ink-3">{unscheduled} tareas sin fechas no se muestran</span>}
          {canEdit && <span className={cn(!unscheduled && "ml-auto", "text-ink-3")}>Arrastra para mover · bordes para cambiar duración</span>}
        </div>
      </div>
    </div>
  );
}
