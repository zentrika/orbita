"use client";

import {
  closestCorners, DndContext, type DragEndEvent, type DragOverEvent, DragOverlay, type DragStartEvent, KeyboardSensor,
  PointerSensor, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, CheckSquare, GitBranch, MessageSquare, Paperclip, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DueBadge, PriorityIcon, StatusIcon, TypeIcon } from "@/components/tasks/bits";
import { Avatar, LabelChip } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useInvalidateTasks, useMoveTask } from "@/lib/queries";
import type { ProjectDetail, Status, Task } from "@/lib/types";
import { cn, PRIORITY_LABEL } from "@/lib/utils";

type Columns = Record<number, Task[]>;

function group(tasks: Task[], statuses: Status[]): Columns {
  const cols: Columns = Object.fromEntries(statuses.map((s) => [s.id, []]));
  for (const t of tasks) (cols[t.status_id] ??= []).push(t);
  for (const k in cols) cols[k].sort((a, b) => a.position - b.position || a.id - b.id);
  return cols;
}

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-blocked/10 text-blocked", high: "bg-blocked/10 text-blocked", medium: "bg-risk/10 text-[#B54708] dark:text-risk", low: "bg-subtle text-ink-2",
};

export function TaskCard({ task, onOpen, overlay }: { task: Task; onOpen?: () => void; overlay?: boolean }) {
  const done = task.status?.category === "done";
  const deleted = !!task.deleted_at;
  return (
    <div
      onClick={onOpen}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-xl border border-line bg-surface p-3 shadow-xs transition-shadow hover:border-line-strong hover:shadow-sm",
        deleted && "border-dashed opacity-60",
        overlay && "rotate-[1.5deg] shadow-lg ring-1 ring-primary/30",
        task.status?.category === "in_progress" && "border-l-2 border-l-progress",
      )}
    >
      {deleted && (
        <span className="absolute right-[-30px] top-[10px] rotate-45 bg-blocked px-8 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">Eliminada</span>
      )}
      <div className="flex items-center gap-2">
        <TypeIcon type={task.type} />
        <span className="text-xs font-medium text-ink-2">{task.key}</span>
        {task.team && <span className="inline-flex items-center gap-1 truncate text-2xs text-ink-3"><span className="h-1.5 w-1.5 rounded-full" style={{ background: task.team.color }} />{task.team.name}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {task.blocked && <AlertTriangle className="h-3.5 w-3.5 text-blocked" aria-label="Bloqueada" />}
          {task.priority !== "none" && (
            <span className={cn("chip h-5 gap-1 px-1.5 text-2xs", PRIORITY_TONE[task.priority])}>
              <PriorityIcon priority={task.priority} /> {PRIORITY_LABEL[task.priority]}
            </span>
          )}
          {done && <StatusIcon status={task.status} size={16} />}
        </span>
      </div>
      <p className={cn("mt-1.5 text-[13.5px] font-medium leading-snug", done && "text-ink-2", deleted && "line-through")}>{task.title}</p>
      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">{task.labels.map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />)}</div>
      )}
      <div className="mt-3 flex items-center gap-3 text-xs text-ink-2">
        <Avatar user={task.assignee} size={22} />
        <DueBadge date={task.due_date} done={done} />
        <span className="ml-auto flex items-center gap-2.5">
          {task.subtask_count > 0 && <span className="inline-flex items-center gap-1" title="Subtareas"><GitBranch className="h-3 w-3" />{task.subtask_done}/{task.subtask_count}</span>}
          {task.checklist_total > 0 && <span className="inline-flex items-center gap-1" title="Checklist"><CheckSquare className="h-3 w-3" />{task.checklist_done}/{task.checklist_total}</span>}
          {task.attachment_count > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" />{task.attachment_count}</span>}
          {task.comment_count > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{task.comment_count}</span>}
        </span>
      </div>
    </div>
  );
}

function SortableCard({ task, onOpen, disabled }: { task: Task; onOpen: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      aria-roledescription="Tarjeta arrastrable"
    >
      <TaskCard task={task} onOpen={onOpen} />
    </div>
  );
}

function Column({ status, tasks, children, onAdd, canCreate }: {
  status: Status; tasks: Task[]; children: React.ReactNode; onAdd: (title: string) => Promise<void>; canCreate: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status.id}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <section className="flex w-[296px] shrink-0 flex-col rounded-xl bg-subtle/70" aria-label={status.name}>
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="h-2 w-2 rounded-full" style={{ background: status.color }} />
        <h2 className="text-[13.5px] font-semibold">{status.name}</h2>
        <span className="rounded-md bg-surface px-1.5 text-2xs font-semibold text-ink-2">{tasks.length}</span>
        {canCreate && (
          <button onClick={() => setAdding(true)} className="ml-auto rounded-md p-1 text-ink-3 hover:bg-surface hover:text-ink" aria-label={`Añadir tarea en ${status.name}`}>
            <Plus className="h-4 w-4" />
          </button>
        )}
      </header>
      <div ref={setNodeRef} className={cn("scroll-thin flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors", isOver && "rounded-lg bg-primary/[0.04]")}>
        {children}
        {adding && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              await onAdd(title.trim());
              setTitle("");
            }}
            className="rounded-xl border border-primary/40 bg-surface p-2 shadow-sm"
          >
            <textarea
              autoFocus
              rows={2}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
                if (e.key === "Escape") setAdding(false);
              }}
              onBlur={() => !title && setAdding(false)}
              placeholder="Título de la tarea…"
              className="w-full resize-none bg-transparent text-[13.5px] outline-none placeholder:text-ink-3"
            />
            <p className="text-2xs text-ink-3">Enter para crear · Esc para cancelar</p>
          </form>
        )}
        {!tasks.length && !adding && <p className="px-1 py-6 text-center text-xs text-ink-3">Suelta tareas aquí</p>}
      </div>
    </section>
  );
}

export function Board({ orgId, project, tasks }: { orgId: number; project: ProjectDetail; tasks: Task[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const move = useMoveTask(orgId);
  const invalidate = useInvalidateTasks(orgId);
  const canEdit = project.permissions.includes("edit");
  const canCreate = project.permissions.includes("create");
  const statuses = useMemo(() => [...project.statuses].sort((a, b) => a.position - b.position), [project.statuses]);
  const [cols, setCols] = useState<Columns>(() => group(tasks, statuses));
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => {
    if (activeId === null) setCols(group(tasks, statuses));
  }, [tasks, statuses, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCol = (id: number | string): number | null => {
    if (typeof id === "string" && id.startsWith("col-")) return Number(id.slice(4));
    for (const [k, list] of Object.entries(cols)) if (list.some((t) => t.id === id)) return Number(k);
    return null;
  };
  const active = activeId ? Object.values(cols).flat().find((t) => t.id === activeId) : null;

  const onStart = (e: DragStartEvent) => setActiveId(Number(e.active.id));
  const onOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findCol(active.id as number);
    const to = findCol(over.id);
    if (from === null || to === null || from === to) return;
    setCols((prev) => {
      const item = prev[from].find((t) => t.id === active.id)!;
      const target = [...prev[to]];
      const overIdx = target.findIndex((t) => t.id === over.id);
      target.splice(overIdx >= 0 ? overIdx : target.length, 0, { ...item, status_id: to, status: statuses.find((s) => s.id === to) ?? null });
      return { ...prev, [from]: prev[from].filter((t) => t.id !== active.id), [to]: target };
    });
  };
  const onEnd = ({ active, over }: DragEndEvent) => {
    const id = Number(active.id);
    setActiveId(null);
    if (!over) return setCols(group(tasks, statuses));
    const col = findCol(id);
    if (col === null) return;
    const list = [...cols[col]];
    const from = list.findIndex((t) => t.id === id);
    let to = typeof over.id === "number" ? list.findIndex((t) => t.id === over.id) : list.length - 1;
    if (to < 0) to = from;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    setCols((prev) => ({ ...prev, [col]: list }));
    // Posición fraccional entre vecinos: no hace falta reordenar el resto.
    const prevPos = list[to - 1]?.position;
    const nextPos = list[to + 1]?.position;
    const position = prevPos === undefined && nextPos === undefined ? 1024
      : prevPos === undefined ? nextPos! - 1024
      : nextPos === undefined ? prevPos + 1024
      : (prevPos + nextPos) / 2;
    const original = tasks.find((t) => t.id === id);
    if (original && original.status_id === col && original.position === position) return;
    move.mutate({ id, status_id: col, position });
  };

  const quickAdd = (statusId: number) => async (title: string) => {
    try {
      await api(`/orgs/${orgId}/tasks`, { method: "POST", body: { project_id: project.id, title, status_id: statusId } });
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const open = (id: number) => router.replace(`${pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(window.location.search)), task: String(id) })}`, { scroll: false });

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDragCancel={() => { setActiveId(null); setCols(group(tasks, statuses)); }}>
      <div className="scroll-thin flex flex-1 gap-3 overflow-x-auto px-4 pb-6 sm:px-8">
        {statuses.map((s) => (
          <Column key={s.id} status={s} tasks={cols[s.id] ?? []} onAdd={quickAdd(s.id)} canCreate={canCreate}>
            <SortableContext items={(cols[s.id] ?? []).map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {(cols[s.id] ?? []).map((t) => <SortableCard key={t.id} task={t} onOpen={() => open(t.id)} disabled={!canEdit || !!t.deleted_at} />)}
            </SortableContext>
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" }}>
        {active ? <div className="w-[280px]"><TaskCard task={active} overlay /></div> : null}
      </DragOverlay>
    </DndContext>
  );
}
