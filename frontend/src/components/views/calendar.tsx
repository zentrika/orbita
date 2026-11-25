"use client";

import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/layout/workspace-context";
import { StatusIcon } from "@/components/tasks/bits";
import { Button } from "@/components/ui/button";
import { useUpdateTask } from "@/lib/queries";
import type { ProjectDetail, Task } from "@/lib/types";
import { cn, dueState, toISODate } from "@/lib/utils";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function CalendarView({ orgId, project, tasks }: { orgId: number; project: ProjectDetail; tasks: Task[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dragOver, setDragOver] = useState<string | null>(null);
  const update = useUpdateTask(orgId);
  const router = useRouter();
  const pathname = usePathname();
  const { newTask } = useWorkspace();
  const canEdit = project.permissions.includes("edit");
  const canCreate = project.permissions.includes("create");

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const out: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  const byDay = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of tasks) if (t.due_date) (m[t.due_date] ??= []).push(t);
    return m;
  }, [tasks]);
  const undated = tasks.filter((t) => !t.due_date && t.status?.category !== "done");

  const open = (id: number) => router.replace(`${pathname}?task=${id}`, { scroll: false });
  const drop = (day: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/task"));
    const task = tasks.find((t) => t.id === id);
    if (!task || task.due_date === day) return;
    // Si la nueva fecha límite queda antes del inicio, desplazamos el inicio conservando la duración.
    const data: Record<string, unknown> = { due_date: day };
    if (task.start_date && task.start_date > day) data.start_date = day;
    update.mutate({ id, data });
  };

  const Chip = ({ t }: { t: Task }) => {
    const done = t.status?.category === "done";
    const late = dueState(t.due_date, done) === "overdue";
    return (
      <button
        draggable={canEdit}
        onDragStart={(e) => e.dataTransfer.setData("text/task", String(t.id))}
        onClick={() => open(t.id)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-xs transition-colors hover:border-line-strong",
          late ? "border-blocked/30 bg-blocked/[0.06]" : "border-line bg-surface",
          done && "opacity-60",
        )}
        title={`${t.key} · ${t.title}`}
      >
        <StatusIcon status={t.status} size={12} />
        <span className={cn("truncate", done && "line-through")}>{t.title}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-1 gap-4 px-4 pb-8 sm:px-8">
      <div className="card flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="font-display text-[15px] font-semibold capitalize">{format(month, "MMMM yyyy", { locale: es })}</h2>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="secondary" size="icon-sm" onClick={() => setMonth(subMonths(month, 1))} aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="secondary" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>Hoy</Button>
            <Button variant="secondary" size="icon-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-line text-center text-xs font-medium text-ink-2">
          {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid flex-1 grid-cols-7 auto-rows-[minmax(112px,1fr)]">
          {days.map((d) => {
            const key = toISODate(d);
            const items = byDay[key] ?? [];
            return (
              <div
                key={key}
                onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(key); } }}
                onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                onDrop={(e) => drop(key, e)}
                className={cn(
                  "group relative flex min-w-0 flex-col gap-1 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0",
                  !isSameMonth(d, month) && "bg-muted/60",
                  dragOver === key && "bg-primary-soft",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    isToday(d) ? "bg-primary font-semibold text-white" : isSameMonth(d, month) ? "text-ink" : "text-ink-3")}>
                    {format(d, "d")}
                  </span>
                  {canCreate && (
                    <button onClick={() => newTask({ project_id: project.id, due_date: key })} className="invisible rounded p-0.5 text-ink-3 hover:bg-subtle hover:text-ink group-hover:visible" aria-label={`Crear tarea el ${key}`}>
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {items.slice(0, 3).map((t) => <Chip key={t.id} t={t} />)}
                {items.length > 3 && <span className="px-1 text-2xs text-ink-2">+{items.length - 3} más</span>}
              </div>
            );
          })}
        </div>
      </div>
      <aside className="card hidden w-64 shrink-0 flex-col overflow-hidden xl:flex">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-semibold">Sin fecha límite</h3>
          <p className="text-xs text-ink-3">Arrástralas a un día para programarlas</p>
        </div>
        <div className="scroll-thin flex-1 space-y-1.5 overflow-y-auto p-3">
          {undated.map((t) => <Chip key={t.id} t={t} />)}
          {!undated.length && <p className="text-xs text-ink-3">Todo está programado.</p>}
        </div>
      </aside>
    </div>
  );
}
