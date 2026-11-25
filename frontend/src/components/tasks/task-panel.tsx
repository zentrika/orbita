"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft, ShieldCheck,
  AlertTriangle, ArrowUpRight, CalendarDays, Clock, Copy, Download, Eye, EyeOff, Flag, Link2, MoreHorizontal, Paperclip,
  Plus, Tag, Timer, Trash2, User, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Picker } from "@/components/ui/menu";
import { Avatar, LabelChip, ProgressBar, Segmented, Spinner } from "@/components/ui/misc";
import { api, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  useAssignable, useAttachments, useComments, useInvalidateTasks, useMilestones, useProject, useSprints, useTask,
  useTaskActivity, useUpdateTask,
} from "@/lib/queries";
import type { Priority, RelationType, Task, TaskCapability, TaskDetail, TaskType, TimeEntry } from "@/lib/types";
import { cn, dueState, fmtBytes, fmtDate, fmtMinutes, fmtRelative, parseDuration, PRIORITY_LABEL, SWATCHES, TYPE_LABEL } from "@/lib/utils";
import { CommentThread } from "./comments";
import { AssignDialog, QADialog, TaskHistory, TransferDialog } from "./task-workflow";
import { ActivityFeed } from "./activity";
import { NewTaskDialog } from "./new-dialogs";
import { PriorityIcon, StatusIcon, TypeIcon } from "./bits";
import { RichEditor } from "./rich-editor";

/** Panel lateral de detalle. Se abre con ?task=<id> en cualquier vista de la organización. */
export function TaskPanelHost({ orgId }: { orgId: number }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const taskId = Number(params.get("task")) || null;

  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("task");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && taskId && !document.querySelector("[role=dialog][data-state=open]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!taskId) return null;
  return (
    <>
      <div className="fixed inset-0 z-30 bg-[#0C111D]/20 lg:hidden" onClick={close} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-40 flex w-full animate-slide-in flex-col border-l border-line bg-surface shadow-lg sm:w-[520px] xl:w-[560px]"
        aria-label="Detalle de la tarea"
      >
        <TaskPanel key={taskId} orgId={orgId} taskId={taskId} onClose={close} />
      </aside>
    </>
  );
}

function PropRow({ icon: Icon, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[132px_1fr] items-center gap-2">
      <span className="flex items-center gap-2 text-[13px] text-ink-2">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const ghost = "inline-flex h-8 max-w-full items-center gap-1.5 rounded-md px-2 text-[13px] text-ink hover:bg-subtle disabled:hover:bg-transparent";

function TaskPanel({ orgId, taskId, onClose }: { orgId: number; taskId: number; onClose: () => void }) {
  const { data: task, isLoading, error } = useTask(orgId, taskId);
  if (isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (error || !task)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="font-display font-semibold">Tarea no disponible</p>
        <p className="text-sm text-ink-2">Puede haber sido eliminada o no tienes acceso.</p>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
      </div>
    );
  return <TaskPanelBody orgId={orgId} task={task} onClose={onClose} />;
}

function TaskPanelBody({ orgId, task, onClose }: { orgId: number; task: TaskDetail; onClose: () => void }) {
  const update = useUpdateTask(orgId);
  const invalidate = useInvalidateTasks(orgId);
  const { data: project } = useProject(orgId, task.project_id);
  const { data: people } = useAssignable(orgId, task.project_id);
  const { data: sprints } = useSprints(orgId, task.project_id);
  const { data: milestones } = useMilestones(orgId, task.project_id);
  const { me } = useAuth();
  const qc = useQueryClient();
  const can = (a: string) => task.permissions.includes(a as never);
  const cap = (c: TaskCapability) => task.capabilities.includes(c);
  const deleted = !!task.deleted_at;
  const editable = cap("edit") && !deleted;
  const canStatus = cap("status") && !deleted;
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description);
  const [editingDesc, setEditingDesc] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<"comments" | "history" | "activity">("comments");
  const [assignOpen, setAssignOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [qaDialog, setQaDialog] = useState<null | "submit" | "approve" | "reject">(null);
  const [subOpen, setSubOpen] = useState(false);

  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => { if (!editingDesc) setDesc(task.description); }, [task.description, editingDesc]);

  const patch = (data: Record<string, unknown>) => update.mutate({ id: task.id, data });
  const done = task.status?.category === "done";
  const isWatching = task.watchers.some((w) => w.id === me?.id);
  const canDelete = cap("delete") && !deleted;
  const restore = async () => {
    try { await api(`/orgs/${orgId}/tasks/${task.id}/restore`, { method: "POST" }); toast.success("Tarea restaurada"); invalidate(task.id); }
    catch (e) { toast.error((e as Error).message); }
  };
  const progressPct = task.checklist_total + task.subtask_count
    ? Math.round(((task.checklist_done + task.subtask_done) / (task.checklist_total + task.subtask_count)) * 100)
    : done ? 100 : 0;

  const del = useMutation({
    mutationFn: () => api(`/orgs/${orgId}/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Tarea eliminada"); invalidate(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleWatch = async () => {
    await api(`/orgs/${orgId}/tasks/${task.id}/watchers${isWatching ? `/${me!.id}` : ""}`, {
      method: isWatching ? "DELETE" : "POST", body: isWatching ? undefined : { user_id: me!.id },
    });
    invalidate(task.id);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/o/${orgId}/projects/${task.project_id}/board?task=${task.id}`);
    toast.success("Enlace copiado");
  };

  return (
    <>
      {/* Cabecera */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-5">
        <TypeIcon type={task.type} />
        <Link href={`/o/${orgId}/projects/${task.project_id}/board`} className="text-xs font-medium text-ink-2 hover:text-ink">
          {task.key}
        </Link>
        {task.blocked && (
          <span className="chip bg-blocked/10 text-blocked"><AlertTriangle className="h-3 w-3" /> Bloqueada</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={toggleWatch} aria-label={isWatching ? "Dejar de seguir" : "Seguir"} title={isWatching ? "Dejar de seguir" : "Seguir"}>
            {isWatching ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Más acciones"><MoreHorizontal className="h-4 w-4" /></Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Copy />} onSelect={copyLink}>Copiar enlace</MenuItem>
              {can("create") && <MenuItem icon={<Plus />} onSelect={() => setSubOpen(true)}>Añadir subtarea</MenuItem>}
              {canDelete && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirmDelete(true)}>Eliminar tarea</MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar panel"><X className="h-4 w-4" /></Button>
        </div>
      </div>

      {deleted && (
        <div className="flex items-center gap-3 border-b border-blocked/20 bg-blocked/[0.06] px-5 py-2 text-[13px] text-blocked">
          <Trash2 className="h-4 w-4" />
          <span className="flex-1">Eliminada {fmtRelative(task.deleted_at)}. Sólo tú la ves.</span>
          <Button size="sm" variant="secondary" onClick={restore}>Restaurar</Button>
        </div>
      )}
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className={cn("px-5 pb-6 pt-5", deleted && "opacity-70")}>
          {task.parent && (
            <Link href={`?task=${task.parent.id}`} scroll={false} className="mb-2 inline-flex items-center gap-1 text-xs text-ink-2 hover:text-primary">
              <ArrowUpRight className="h-3 w-3" /> {task.parent.key} · {task.parent.title}
            </Link>
          )}
          <textarea
            value={title}
            readOnly={!editable}
            rows={1}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && patch({ title: title.trim() })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
            className={cn("w-full resize-none overflow-hidden bg-transparent font-display text-[22px] font-semibold leading-tight tracking-tight outline-none [field-sizing:content]", deleted && "line-through")}
            aria-label="Título"
          />

          {/* Estado + progreso */}
          <div className="mt-4 flex items-center gap-3">
            <Picker
              disabled={!canStatus}
              searchable={false}
              options={(project?.statuses ?? []).map((s) => ({ value: s.id, label: s.name, icon: <StatusIcon status={s} /> }))}
              value={task.status_id}
              onChange={(v) => patch({ status_id: v })}
              trigger={
                <button className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium"
                  style={{ background: `${task.status?.color}18`, color: task.status?.color }}>
                  <StatusIcon status={task.status} /> {task.status?.name}
                </button>
              }
            />
            <div className="flex flex-1 items-center gap-2">
              <span className="w-9 text-right text-[13px] font-medium tabular-nums">{progressPct}%</span>
              <ProgressBar value={progressPct} color={done ? "#12B76A" : "#2563EB"} />
            </div>
          </div>
          {!deleted && (task.in_qa || (task.assignee?.id === me?.id && !done)) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-review/25 bg-review/[0.06] px-3 py-2 text-[13px]">
              {task.in_qa ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-review" />
                  <span className="flex-1">En revisión de QA</span>
                  {cap("qa") && task.assignee?.id !== me?.id && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setQaDialog("reject")}>Rechazar</Button>
                      <Button size="sm" onClick={() => setQaDialog("approve")}>Validar</Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 text-review" />
                  <span className="flex-1">¿Terminaste? Envía tu entrega a QA para validarla.</span>
                  <Button size="sm" onClick={() => setQaDialog("submit")}>Enviar a QA</Button>
                </>
              )}
            </div>
          )}

          {/* Propiedades */}
          <div className="mt-5 space-y-0.5">
            <PropRow icon={Users} label="Equipo">
              <div className="flex items-center gap-1">
                <span className={cn(ghost, "pointer-events-none")}>
                  {task.team ? <><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: task.team.color }} />{task.team.name}{task.team.is_qa && <span className="text-2xs text-ink-3">QA</span>}</>
                    : <span className="text-ink-3">Sin equipo (visible para todo el proyecto)</span>}
                </span>
                {cap("transfer") && !deleted && (
                  <Button size="sm" variant="ghost" onClick={() => setTransferOpen(true)}><ArrowRightLeft className="h-3.5 w-3.5" /> Transferir</Button>
                )}
              </div>
            </PropRow>
            <PropRow icon={User} label="Responsable">
              <div className="flex items-center gap-1">
                <span className={cn(ghost, "pointer-events-none")}>
                  <Avatar user={task.assignee} size={20} />{task.assignee?.full_name ?? <span className="text-ink-3">Sin asignar</span>}
                </span>
                {cap("assign") && !deleted && (
                  <Button size="sm" variant="ghost" onClick={() => setAssignOpen(true)}>{task.assignee ? "Reasignar" : "Asignar"}</Button>
                )}
              </div>
            </PropRow>
            <PropRow icon={Flag} label="Prioridad">
              <Picker
                disabled={!editable}
                searchable={false}
                options={(["urgent", "high", "medium", "low", "none"] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))}
                value={task.priority}
                onChange={(v) => patch({ priority: v })}
                trigger={<button disabled={!editable} className={ghost}><PriorityIcon priority={task.priority} withLabel /></button>}
              />
            </PropRow>
            <PropRow icon={Tag} label="Tipo">
              <Picker
                disabled={!editable}
                searchable={false}
                options={(Object.keys(TYPE_LABEL) as TaskType[]).map((t) => ({ value: t, label: TYPE_LABEL[t], icon: <TypeIcon type={t} /> }))}
                value={task.type}
                onChange={(v) => patch({ type: v })}
                trigger={<button disabled={!editable} className={ghost}><TypeIcon type={task.type} withLabel /></button>}
              />
            </PropRow>
            <PropRow icon={CalendarDays} label="Fechas">
              <div className="flex flex-wrap items-center gap-1 text-[13px]">
                <DateInput value={task.start_date} disabled={!editable} max={task.due_date} onChange={(v) => patch({ start_date: v })} placeholder="Inicio" />
                <span className="text-ink-3">→</span>
                <DateInput value={task.due_date} disabled={!editable} min={task.start_date} onChange={(v) => patch({ due_date: v })} placeholder="Fecha límite"
                  danger={dueState(task.due_date, done) === "overdue"} />
              </div>
            </PropRow>
            <PropRow icon={Timer} label="Estimación">
              <EstimateInput value={task.estimate_minutes} disabled={!editable} onChange={(v) => patch({ estimate_minutes: v })} />
              {task.time_spent_minutes > 0 && (
                <span className="ml-2 text-xs text-ink-2">{fmtMinutes(task.time_spent_minutes)} registradas</span>
              )}
            </PropRow>
            <PropRow icon={Tag} label="Etiquetas">
              <Picker
                disabled={!editable}
                multiple
                options={(project?.labels ?? []).map((l) => ({ value: l.id, label: l.name, icon: <span className="h-2 w-2 rounded-full" style={{ background: l.color }} /> }))}
                value={task.labels.map((l) => l.id)}
                onChange={(v) => patch({ label_ids: v })}
                createLabel="Crear etiqueta"
                onCreate={async (name) => {
                  try {
                    const lb = await api<{ id: number }>(`/orgs/${orgId}/projects/${task.project_id}/labels`, {
                      method: "POST", body: { name, color: SWATCHES[(project?.labels.length ?? 0) % SWATCHES.length] },
                    });
                    qc.invalidateQueries({ queryKey: ["project", orgId, task.project_id] });
                    patch({ label_ids: [...task.labels.map((l) => l.id), lb.id] });
                  } catch (e) { toast.error((e as Error).message); }
                }}
                trigger={
                  <button disabled={!editable} className={cn(ghost, "h-auto min-h-8 flex-wrap py-1")}>
                    {task.labels.length ? task.labels.map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />) : <span className="text-ink-3">Añadir etiquetas</span>}
                  </button>
                }
              />
            </PropRow>
            {!!sprints?.length && (
              <PropRow icon={Clock} label="Sprint">
                <Picker
                  disabled={!editable}
                  searchable={false}
                  options={[{ value: null, label: "Sin sprint" }, ...sprints.filter((s) => s.state !== "closed" || s.id === task.sprint_id).map((s) => ({ value: s.id, label: s.name, hint: s.state === "active" ? "Activo" : undefined }))]}
                  value={task.sprint_id}
                  onChange={(v) => patch({ sprint_id: v })}
                  trigger={<button disabled={!editable} className={ghost}>{sprints.find((s) => s.id === task.sprint_id)?.name ?? <span className="text-ink-3">Sin sprint</span>}</button>}
                />
              </PropRow>
            )}
            {!!milestones?.length && (
              <PropRow icon={Flag} label="Hito">
                <Picker
                  disabled={!editable}
                  searchable={false}
                  options={[{ value: null, label: "Sin hito" }, ...milestones.map((m) => ({ value: m.id, label: m.name, hint: fmtDate(m.due_date) }))]}
                  value={task.milestone_id}
                  onChange={(v) => patch({ milestone_id: v })}
                  trigger={<button disabled={!editable} className={ghost}>{milestones.find((m) => m.id === task.milestone_id)?.name ?? <span className="text-ink-3">Sin hito</span>}</button>}
                />
              </PropRow>
            )}
            <PropRow icon={Users} label="Observadores">
              <div className="flex items-center gap-2 px-2">
                <div className="flex -space-x-1.5">{task.watchers.map((w) => <Avatar key={w.id} user={w} size={22} />)}</div>
                {!task.watchers.length && <span className="text-[13px] text-ink-3">Nadie</span>}
              </div>
            </PropRow>
          </div>

          {/* Descripción */}
          <section className="mt-6">
            <h3 className="mb-2 text-[13px] font-semibold">Descripción</h3>
            {editingDesc ? (
              <div className="rounded-lg border border-line p-3 focus-within:border-primary">
                <RichEditor value={desc} onChange={setDesc} autofocus />
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setDesc(task.description); setEditingDesc(false); }}>Cancelar</Button>
                  <Button size="sm" onClick={() => { patch({ description: desc }); setEditingDesc(false); }}>Guardar</Button>
                </div>
              </div>
            ) : (
              <div
                role={editable ? "button" : undefined}
                tabIndex={editable ? 0 : undefined}
                onClick={() => editable && setEditingDesc(true)}
                onKeyDown={(e) => editable && e.key === "Enter" && setEditingDesc(true)}
                className={cn("-mx-2 rounded-lg px-2 py-1", editable && "cursor-text hover:bg-muted")}
              >
                {task.description ? (
                  <div className="prose-orbita" dangerouslySetInnerHTML={{ __html: task.description }} />
                ) : (
                  <p className="text-sm text-ink-3">{editable ? "Añade una descripción…" : "Sin descripción"}</p>
                )}
              </div>
            )}
          </section>

          <Subtasks orgId={orgId} task={task} canCreate={can("create") && !deleted} onAdd={() => setSubOpen(true)} />
          <Checklist orgId={orgId} task={task} editable={editable} />
          <Relations orgId={orgId} task={task} editable={editable} />
          <TimeLog orgId={orgId} task={task} editable={canStatus} />
          <Attachments orgId={orgId} task={task} canAttach={cap("attach") && !deleted} canManage={can("manage")} />

          {/* Comentarios / actividad */}
          <section className="mt-8 border-t border-line pt-5">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "comments", label: `Comentarios${task.comment_count ? ` · ${task.comment_count}` : ""}` },
                { value: "history", label: "Asignaciones y QA" },
                { value: "activity", label: "Actividad" },
              ]}
            />
            <div className="mt-4">
              {tab === "comments" ? (
                <CommentThread orgId={orgId} taskId={task.id} projectId={task.project_id} canComment={cap("comment")} canAttach={cap("attach")} />
              ) : tab === "history" ? (
                <TaskHistory orgId={orgId} taskId={task.id} />
              ) : (
                <TaskActivity orgId={orgId} taskId={task.id} />
              )}
            </div>
          </section>

          <p className="mt-8 text-xs text-ink-3">
            Creada {fmtRelative(task.created_at)}{task.reporter ? ` por ${task.reporter.full_name}` : ""} · Actualizada {fmtRelative(task.updated_at)}
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Eliminar tarea?"
        description={`${task.key} se moverá a la papelera (borrado lógico). El historial se conserva.`}
        confirmLabel="Eliminar"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
      <NewTaskDialog orgId={orgId} open={subOpen} onOpenChange={setSubOpen} defaults={{ project_id: task.project_id, parent_id: task.id }} />
      {assignOpen && <AssignDialog orgId={orgId} task={task} onClose={() => setAssignOpen(false)} />}
      {transferOpen && <TransferDialog orgId={orgId} task={task} teams={project?.teams ?? []} onClose={() => setTransferOpen(false)} />}
      {qaDialog && <QADialog orgId={orgId} task={task} mode={qaDialog} onClose={() => setQaDialog(null)} />}
    </>
  );
}

function DateInput({ value, onChange, disabled, placeholder, min, max, danger }: {
  value: string | null; onChange: (v: string | null) => void; disabled?: boolean; placeholder: string;
  min?: string | null; max?: string | null; danger?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.showPicker?.()}
        className={cn(ghost, danger && "font-medium text-blocked")}
      >
        {value ? fmtDate(value, "d MMM yyyy") : <span className="text-ink-3">{placeholder}</span>}
      </button>
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        aria-label={placeholder}
        className="pointer-events-none absolute inset-0 opacity-0"
        value={value ?? ""}
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(e) => onChange(e.target.value || null)}
      />
      {value && !disabled && (
        <button type="button" onClick={() => onChange(null)} className="ml-0.5 rounded p-0.5 text-ink-3 hover:text-ink" aria-label={`Quitar ${placeholder}`}>
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function EstimateInput({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(value ? fmtMinutes(value).replace(" min", "m").replace(" h", "h") : "");
  useEffect(() => setText(value ? fmtMinutes(value).replace(" min", "m").replace(" h", "h") : ""), [value]);
  return (
    <input
      disabled={disabled}
      value={text}
      placeholder="p. ej. 4h 30m"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const m = parseDuration(text);
        if (m !== value) onChange(m);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-8 w-32 rounded-md bg-transparent px-2 text-[13px] outline-none placeholder:text-ink-3 hover:bg-subtle focus:bg-subtle"
      aria-label="Estimación"
    />
  );
}

function SectionTitle({ title, extra, action }: { title: string; extra?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">{title}{extra && <span className="font-normal text-ink-3">{extra}</span>}</h3>
      {action}
    </div>
  );
}

function Subtasks({ orgId, task, canCreate, onAdd }: { orgId: number; task: TaskDetail; canCreate: boolean; onAdd: () => void }) {
  if (!task.subtasks.length && !canCreate) return null;
  return (
    <section className="mt-6">
      <SectionTitle
        title="Subtareas"
        extra={task.subtask_count ? `${task.subtask_done}/${task.subtask_count}` : undefined}
        action={canCreate && <Button size="sm" variant="ghost" onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Añadir</Button>}
      />
      {task.subtasks.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {task.subtasks.map((s: Task) => (
            <li key={s.id}>
              <Link href={`?task=${s.id}`} scroll={false} className="flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-muted">
                <StatusIcon status={s.status} />
                <span className="w-14 shrink-0 text-xs text-ink-3">{s.key}</span>
                <span className={cn("flex-1 truncate", s.status?.category === "done" && "text-ink-2 line-through")}>{s.title}</span>
                <Avatar user={s.assignee} size={20} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-3">Divide el trabajo en partes más pequeñas.</p>
      )}
    </section>
  );
}

function Checklist({ orgId, task, editable }: { orgId: number; task: TaskDetail; editable: boolean }) {
  const invalidate = useInvalidateTasks(orgId);
  const [text, setText] = useState("");
  const base = `/orgs/${orgId}/tasks/${task.id}/checklist`;
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); invalidate(task.id); } catch (e) { toast.error((e as Error).message); }
  };
  if (!task.checklist.length && !editable) return null;
  return (
    <section className="mt-6">
      <SectionTitle title="Checklist" extra={task.checklist_total ? `${task.checklist_done}/${task.checklist_total}` : undefined} />
      <ul className="space-y-0.5">
        {task.checklist.map((i) => (
          <li key={i.id} className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-muted">
            <input
              type="checkbox"
              checked={i.done}
              disabled={!editable}
              onChange={() => run(() => api(`${base}/${i.id}`, { method: "PATCH", body: { done: !i.done } }))}
              className="h-4 w-4 rounded accent-primary"
              aria-label={i.text}
            />
            <span className={cn("flex-1 text-[13px]", i.done && "text-ink-3 line-through")}>{i.text}</span>
            {editable && (
              <button onClick={() => run(() => api(`${base}/${i.id}`, { method: "DELETE" }))} className="invisible rounded p-0.5 text-ink-3 hover:text-blocked group-hover:visible" aria-label="Eliminar elemento">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            const t = text;
            setText("");
            run(() => api(base, { method: "POST", body: { text: t } }));
          }}
          className="mt-1 flex items-center gap-2.5 px-1"
        >
          <Plus className="h-4 w-4 text-ink-3" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Añadir elemento" maxLength={255} className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3" />
        </form>
      )}
    </section>
  );
}

const REL_OPTIONS: { value: RelationType; label: string }[] = [
  { value: "blocks", label: "Bloquea a" },
  { value: "depends_on", label: "Depende de" },
  { value: "relates_to", label: "Relacionada con" },
  { value: "duplicates", label: "Duplica a" },
];

function Relations({ orgId, task, editable }: { orgId: number; task: TaskDetail; editable: boolean }) {
  const invalidate = useInvalidateTasks(orgId);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<RelationType>("blocks");
  const [q, setQ] = useState("");
  const { data: results } = useQuery({
    queryKey: ["tasks", orgId, { q, rel: task.id }],
    queryFn: () => api<Task[]>(`/orgs/${orgId}/tasks?q=${encodeURIComponent(q)}&limit=8&sort=updated`),
    enabled: adding,
  });
  const add = async (target: number) => {
    try {
      await api(`/orgs/${orgId}/tasks/${task.id}/relations`, { method: "POST", body: { target_task_id: target, type } });
      setAdding(false);
      setQ("");
      invalidate(task.id);
      invalidate(target);
    } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (id: number, other: number) => {
    await api(`/orgs/${orgId}/tasks/${task.id}/relations/${id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    invalidate(task.id);
    invalidate(other);
  };
  if (!task.relations.length && !editable) return null;
  return (
    <section className="mt-6">
      <SectionTitle title="Dependencias y relaciones" action={editable && !adding && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Link2 className="h-3.5 w-3.5" /> Vincular</Button>} />
      {task.relations.length > 0 && (
        <ul className="space-y-1">
          {task.relations.map((r) => (
            <li key={r.id} className="group flex items-center gap-2.5 rounded-md px-1 py-1 text-[13px] hover:bg-muted">
              <span className={cn("w-28 shrink-0 text-xs", r.label.startsWith("Bloqueada") ? "font-medium text-blocked" : "text-ink-2")}>{r.label}</span>
              <StatusIcon status={r.task.status} />
              <Link href={`?task=${r.task.id}`} scroll={false} className="flex min-w-0 flex-1 gap-2 hover:text-primary">
                <span className="text-xs text-ink-3">{r.task.key}</span>
                <span className="truncate">{r.task.title}</span>
              </Link>
              {editable && (
                <button onClick={() => remove(r.id, r.task.id)} className="invisible rounded p-0.5 text-ink-3 hover:text-blocked group-hover:visible" aria-label="Quitar relación">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!task.relations.length && !adding && <p className="text-[13px] text-ink-3">Sin relaciones.</p>}
      {adding && (
        <div className="mt-2 rounded-lg border border-line p-2">
          <div className="flex gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as RelationType)} className="input h-8 w-40 text-[13px]" aria-label="Tipo de relación">
              {REL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarea o clave…" className="input h-8 text-[13px]" />
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button>
          </div>
          <ul className="mt-1 max-h-48 overflow-y-auto">
            {results?.filter((t) => t.id !== task.id).map((t) => (
              <li key={t.id}>
                <button onClick={() => add(t.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-subtle">
                  <StatusIcon status={t.status} />
                  <span className="w-16 text-xs text-ink-3">{t.key}</span>
                  <span className="truncate">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function TimeLog({ orgId, task, editable }: { orgId: number; task: TaskDetail; editable: boolean }) {
  const invalidate = useInvalidateTasks(orgId);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dur, setDur] = useState("");
  const [note, setNote] = useState("");
  const { data: entries } = useQuery({
    queryKey: ["time", orgId, task.id],
    queryFn: () => api<TimeEntry[]>(`/orgs/${orgId}/tasks/${task.id}/time-entries`),
    enabled: open,
  });
  const est = task.estimate_minutes ?? 0;
  const pct = est ? Math.round((task.time_spent_minutes / est) * 100) : 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const minutes = parseDuration(dur);
    if (!minutes) return toast.error("Indica una duración válida, p. ej. 1h 30m");
    try {
      await api(`/orgs/${orgId}/tasks/${task.id}/time-entries`, { method: "POST", body: { minutes, note } });
      setDur(""); setNote("");
      invalidate(task.id);
      qc.invalidateQueries({ queryKey: ["time", orgId, task.id] });
    } catch (err) { toast.error((err as Error).message); }
  };
  return (
    <section className="mt-6">
      <SectionTitle
        title="Tiempo"
        extra={`${fmtMinutes(task.time_spent_minutes)}${est ? ` de ${fmtMinutes(est)}` : ""}`}
        action={<Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Ocultar" : editable ? "Registrar" : "Ver registros"}</Button>}
      />
      {est > 0 && <ProgressBar value={pct} color={pct > 100 ? "#F04438" : "#2563EB"} />}
      {open && (
        <div className="mt-3 space-y-2">
          {editable && (
            <form onSubmit={submit} className="flex gap-2">
              <input value={dur} onChange={(e) => setDur(e.target.value)} placeholder="1h 30m" className="input h-8 w-24 text-[13px]" aria-label="Duración" />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" maxLength={255} className="input h-8 text-[13px]" />
              <Button size="sm" type="submit">Añadir</Button>
            </form>
          )}
          <ul className="space-y-1">
            {entries?.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-[13px]">
                <Avatar user={e.user} size={18} />
                <span className="font-medium">{fmtMinutes(e.minutes)}</span>
                <span className="truncate text-ink-2">{e.note}</span>
                <span className="ml-auto text-xs text-ink-3">{fmtDate(e.spent_on)}</span>
              </li>
            ))}
            {entries?.length === 0 && <li className="text-[13px] text-ink-3">Sin registros.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

function Attachments({ orgId, task, canAttach, canManage }: { orgId: number; task: TaskDetail; canAttach: boolean; canManage: boolean }) {
  const { data } = useAttachments(orgId, task.id);
  const { me } = useAuth();
  const qc = useQueryClient();
  const invalidate = useInvalidateTasks(orgId);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      if (f.size > 25 * 1024 * 1024) { toast.error(`${f.name} supera 25 MB`); continue; }
      const fd = new FormData();
      fd.append("file", f);
      try {
        await api(`/orgs/${orgId}/tasks/${task.id}/attachments`, { method: "POST", body: fd });
      } catch (e) { toast.error(`${f.name}: ${(e as Error).message}`); }
    }
    setUploading(false);
    qc.invalidateQueries({ queryKey: ["attachments", orgId, task.id] });
    invalidate(task.id);
  };
  const remove = async (id: number) => {
    await api(`/orgs/${orgId}/tasks/${task.id}/attachments/${id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    qc.invalidateQueries({ queryKey: ["attachments", orgId, task.id] });
    invalidate(task.id);
  };

  return (
    <section
      className="mt-6"
      onDragOver={(e) => { if (canAttach) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (canAttach) upload(e.dataTransfer.files); }}
    >
      <SectionTitle
        title="Adjuntos"
        extra={data?.length ? String(data.length) : undefined}
        action={canAttach && <Button size="sm" variant="ghost" loading={uploading} onClick={() => input.current?.click()}><Paperclip className="h-3.5 w-3.5" /> Subir</Button>}
      />
      <input ref={input} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      <div className={cn("rounded-lg transition-colors", drag && "bg-primary-soft ring-2 ring-dashed ring-primary/40")}>
        {data?.length ? (
          <ul className="space-y-1.5">
            {data.map((a) => (
              <li key={a.id} className="group flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-2xs font-bold uppercase text-primary">
                  {a.filename.split(".").pop()?.slice(0, 4)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{a.filename}</p>
                  <p className="text-xs text-ink-3">{fmtBytes(a.size)} · {fmtDate(a.created_at)}{a.uploader ? ` · ${a.uploader.full_name}` : ""}</p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Descargar ${a.filename}`}
                  onClick={() => downloadFile(`/orgs/${orgId}/tasks/${task.id}/attachments/${a.id}/download`, a.filename).catch((e) => toast.error(e.message))}>
                  <Download className="h-4 w-4" />
                </Button>
                {(canManage || a.uploader?.id === me?.id) && (
                  <Button size="icon-sm" variant="ghost" aria-label={`Eliminar ${a.filename}`} onClick={() => remove(a.id)} className="invisible group-hover:visible">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">{canAttach ? "Arrastra archivos aquí (máx. 25 MB)." : "Sin adjuntos."}</p>
        )}
      </div>
    </section>
  );
}

function TaskActivity({ orgId, taskId }: { orgId: number; taskId: number }) {
  const { data } = useTaskActivity(orgId, taskId, true);
  if (!data) return <Spinner />;
  return <ActivityFeed items={data} />;
}
