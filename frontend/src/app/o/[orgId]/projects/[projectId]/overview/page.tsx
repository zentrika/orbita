"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Flag, Pencil, Plus, Target, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActivityFeed } from "@/components/tasks/activity";
import { RichEditor } from "@/components/tasks/rich-editor";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Field, PageLoader, ProgressBar } from "@/components/ui/misc";
import { api } from "@/lib/api";
import {
  useAssignable, useDashboard, useGoals, useMilestones, useOrgId, useProject, useProjectActivity, useProjectId, useSprints,
  useUpdateProject,
} from "@/lib/queries";
import type { Goal, Milestone, Sprint } from "@/lib/types";
import { cn, dueState, fmtDate } from "@/lib/utils";

type Kind = "milestones" | "sprints" | "goals";
type Editing = { kind: Kind; item?: Milestone | Sprint | Goal } | null;

export default function OverviewPage() {
  const orgId = useOrgId();
  const projectId = useProjectId();
  const { data: project } = useProject(orgId, projectId);
  const { data: stats } = useDashboard(orgId, projectId);
  const { data: milestones } = useMilestones(orgId, projectId);
  const { data: sprints } = useSprints(orgId, projectId);
  const { data: goals } = useGoals(orgId, projectId);
  const { data: activity } = useProjectActivity(orgId, projectId);
  const { data: people } = useAssignable(orgId, projectId);
  const updateProject = useUpdateProject(orgId, projectId);
  const [editingScope, setEditingScope] = useState(false);
  const [scope, setScope] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const qc = useQueryClient();

  if (!project || !stats) return <PageLoader />;
  const canManage = project.permissions.includes("manage");
  const remove = async (kind: Kind, id: number) => {
    if (!confirm("¿Eliminar este elemento?")) return;
    await api(`/orgs/${orgId}/projects/${projectId}/${kind}/${id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    qc.invalidateQueries({ queryKey: ["project", orgId, projectId] });
  };
  const active = sprints?.find((s) => s.state === "active");

  return (
    <div className="grid gap-6 px-4 py-6 sm:px-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <div className="card grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
          {[
            { l: "Progreso", v: `${project.progress}%`, sub: `${project.done_count} de ${project.task_count} tareas` },
            { l: "Abiertas", v: stats.open_tasks, sub: `${stats.in_review} en revisión` },
            { l: "Vencidas", v: stats.overdue_tasks, sub: `${stats.blocked} bloqueadas`, danger: stats.overdue_tasks > 0 },
            { l: "Completadas (7 d)", v: stats.completed_last_7_days, sub: `${stats.due_this_week} vencen esta semana` },
          ].map((s) => (
            <div key={s.l} className="px-5 py-4">
              <p className="text-[13px] text-ink-2">{s.l}</p>
              <p className={cn("mt-1 font-display text-[26px] font-bold leading-none", s.danger && "text-blocked")}>{s.v}</p>
              <p className="mt-1.5 text-xs text-ink-3">{s.sub}</p>
            </div>
          ))}
        </div>

        {active && (
          <section className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-progress">Sprint activo</p>
                <h2 className="mt-1 text-[17px] font-semibold">{active.name}</h2>
                {active.goal && <p className="mt-0.5 text-sm text-ink-2">{active.goal}</p>}
              </div>
              <span className="text-xs text-ink-2">{fmtDate(active.start_date)} – {fmtDate(active.end_date)}</span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <ProgressBar value={active.task_count ? (active.done_count / active.task_count) * 100 : 0} color="#2563EB" />
              <span className="shrink-0 text-[13px] font-medium tabular-nums">{active.done_count}/{active.task_count}</span>
            </div>
          </section>
        )}

        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Alcance</h2>
            {canManage && !editingScope && (
              <Button size="sm" variant="ghost" onClick={() => { setScope(project.scope); setEditingScope(true); }}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
            )}
          </div>
          {editingScope ? (
            <div className="rounded-lg border border-line p-3">
              <RichEditor value={scope} onChange={setScope} autofocus placeholder="Qué incluye y qué queda fuera del proyecto…" />
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditingScope(false)}>Cancelar</Button>
                <Button size="sm" onClick={() => { updateProject.mutate({ scope }); setEditingScope(false); }}>Guardar</Button>
              </div>
            </div>
          ) : project.scope ? (
            <div className="prose-orbita" dangerouslySetInnerHTML={{ __html: project.scope }} />
          ) : (
            <p className="text-sm text-ink-3">Define qué entra y qué queda fuera del proyecto.</p>
          )}
        </section>

        <section className="card overflow-hidden">
          <Header icon={Flag} title="Hitos" onAdd={canManage ? () => setEditing({ kind: "milestones" }) : undefined} />
          <ul className="divide-y divide-line">
            {milestones?.map((m) => {
              const pct = m.task_count ? Math.round((m.done_count / m.task_count) * 100) : 0;
              const late = m.status !== "done" && dueState(m.due_date, false) === "overdue";
              return (
                <li key={m.id} className="group grid grid-cols-[minmax(0,1fr)_140px_80px_56px] items-center gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">{m.name}{m.status === "done" && <span className="ml-2 text-xs font-normal text-done">Completado</span>}</p>
                    {m.description && <p className="truncate text-xs text-ink-2">{m.description}</p>}
                  </div>
                  <ProgressBar value={pct} color="#F79009" />
                  <span className={cn("text-xs", late ? "font-medium text-blocked" : "text-ink-2")}>{fmtDate(m.due_date) || "Sin fecha"}</span>
                  <RowActions show={canManage} onEdit={() => setEditing({ kind: "milestones", item: m })} onDelete={() => remove("milestones", m.id)} />
                </li>
              );
            })}
            {!milestones?.length && <li className="px-5 py-4 text-sm text-ink-3">Sin hitos definidos.</li>}
          </ul>
        </section>

        <section className="card overflow-hidden">
          <Header icon={Timer} title="Sprints" onAdd={canManage ? () => setEditing({ kind: "sprints" }) : undefined} />
          <ul className="divide-y divide-line">
            {sprints?.map((s) => (
              <li key={s.id} className="group grid grid-cols-[minmax(0,1fr)_90px_130px_56px] items-center gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{s.name}</p>
                  {s.goal && <p className="truncate text-xs text-ink-2">{s.goal}</p>}
                </div>
                <span className={cn("chip w-fit", s.state === "active" ? "bg-progress/10 text-progress" : s.state === "closed" ? "bg-subtle text-ink-2" : "bg-review/10 text-review")}>
                  {{ active: "Activo", planned: "Planificado", closed: "Cerrado" }[s.state]}
                </span>
                <span className="text-xs text-ink-2">{fmtDate(s.start_date)} – {fmtDate(s.end_date)} · {s.done_count}/{s.task_count}</span>
                <RowActions show={canManage} onEdit={() => setEditing({ kind: "sprints", item: s })} onDelete={() => remove("sprints", s.id)} />
              </li>
            ))}
            {!sprints?.length && <li className="px-5 py-4 text-sm text-ink-3">Sin sprints. Crea uno para planificar en iteraciones.</li>}
          </ul>
        </section>
      </div>

      <div className="space-y-6">
        <section className="card overflow-hidden">
          <Header icon={Target} title="Metas" onAdd={canManage ? () => setEditing({ kind: "goals" }) : undefined} />
          <ul className="divide-y divide-line">
            {goals?.map((g) => (
              <li key={g.id} className="group px-5 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">{g.title}</p>
                    {g.description && <p className="text-xs text-ink-2">{g.description}</p>}
                  </div>
                  <RowActions show={canManage} onEdit={() => setEditing({ kind: "goals", item: g })} onDelete={() => remove("goals", g.id)} />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <ProgressBar value={g.progress} color="#4F46E5" />
                  <span className="text-xs font-medium tabular-nums">{g.progress}%</span>
                  <Avatar user={people?.find((p) => p.id === g.owner_id)} size={20} />
                </div>
                {g.target_date && <p className="mt-1 text-2xs text-ink-3">Objetivo: {fmtDate(g.target_date, "d MMM yyyy")}</p>}
              </li>
            ))}
            {!goals?.length && <li className="px-5 py-4 text-sm text-ink-3">Sin metas.</li>}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Actividad</h2>
          <ActivityFeed items={activity ?? []} withTask />
        </section>
      </div>

      {editing && <ItemDialog orgId={orgId} projectId={projectId} editing={editing} people={people ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Header({ icon: Icon, title, onAdd }: { icon: typeof Flag; title: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-5 py-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Icon className="h-4 w-4 text-ink-3" /> {title}</h2>
      {onAdd && <Button size="sm" variant="ghost" onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Añadir</Button>}
    </div>
  );
}

function RowActions({ show, onEdit, onDelete }: { show: boolean; onEdit: () => void; onDelete: () => void }) {
  if (!show) return <span />;
  return (
    <span className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
      <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Eliminar"><Trash2 className="h-3.5 w-3.5" /></Button>
    </span>
  );
}

function ItemDialog({ orgId, projectId, editing, people, onClose }: {
  orgId: number; projectId: number; editing: NonNullable<Editing>; people: { id: number; full_name: string }[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const item = editing.item as Record<string, unknown> | undefined;
  const [form, setForm] = useState<Record<string, string | number | null>>(() => ({
    name: (item?.name as string) ?? "", title: (item?.title as string) ?? "", description: (item?.description as string) ?? "",
    goal: (item?.goal as string) ?? "", due_date: (item?.due_date as string) ?? "", start_date: (item?.start_date as string) ?? "",
    end_date: (item?.end_date as string) ?? "", target_date: (item?.target_date as string) ?? "",
    status: (item?.status as string) ?? "open", state: (item?.state as string) ?? "planned",
    progress: (item?.progress as number) ?? 0, owner_id: (item?.owner_id as number) ?? null,
  }));
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const d = (v: string | number | null) => (v ? v : null);

  const body = editing.kind === "milestones"
    ? { name: form.name, description: form.description, due_date: d(form.due_date), status: form.status }
    : editing.kind === "sprints"
      ? { name: form.name, goal: form.goal, start_date: d(form.start_date), end_date: d(form.end_date), state: form.state }
      : { title: form.title, description: form.description, target_date: d(form.target_date), progress: Number(form.progress), owner_id: form.owner_id ? Number(form.owner_id) : null };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const base = `/orgs/${orgId}/projects/${projectId}/${editing.kind}`;
      await api(item ? `${base}/${item.id}` : base, { method: item ? "PATCH" : "POST", body });
      qc.invalidateQueries({ queryKey: ["project", orgId, projectId] });
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };
  const title = { milestones: "hito", sprints: "sprint", goals: "meta" }[editing.kind];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${item ? "Editar" : "Nuevo"} ${title}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="item-form" loading={busy}>Guardar</Button></>}>
      <form id="item-form" onSubmit={submit} className="space-y-4">
        {editing.kind === "goals" ? (
          <Field label="Título" htmlFor="f-title"><input id="f-title" required className="input" value={form.title as string} onChange={set("title")} /></Field>
        ) : (
          <Field label="Nombre" htmlFor="f-name"><input id="f-name" required className="input" value={form.name as string} onChange={set("name")} /></Field>
        )}
        {editing.kind === "sprints" ? (
          <>
            <Field label="Objetivo del sprint" htmlFor="f-goal"><textarea id="f-goal" rows={2} className="input h-auto py-2" value={form.goal as string} onChange={set("goal")} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Inicio" htmlFor="f-s"><input id="f-s" type="date" className="input" value={form.start_date as string} onChange={set("start_date")} /></Field>
              <Field label="Fin" htmlFor="f-e"><input id="f-e" type="date" className="input" value={form.end_date as string} onChange={set("end_date")} /></Field>
              <Field label="Estado" htmlFor="f-st">
                <select id="f-st" className="input" value={form.state as string} onChange={set("state")}>
                  <option value="planned">Planificado</option><option value="active">Activo</option><option value="closed">Cerrado</option>
                </select>
              </Field>
            </div>
          </>
        ) : (
          <Field label="Descripción" htmlFor="f-desc"><textarea id="f-desc" rows={2} className="input h-auto py-2" value={form.description as string} onChange={set("description")} /></Field>
        )}
        {editing.kind === "milestones" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha" htmlFor="f-due"><input id="f-due" type="date" className="input" value={form.due_date as string} onChange={set("due_date")} /></Field>
            <Field label="Estado" htmlFor="f-ms">
              <select id="f-ms" className="input" value={form.status as string} onChange={set("status")}>
                <option value="open">Abierto</option><option value="done">Completado</option>
              </select>
            </Field>
          </div>
        )}
        {editing.kind === "goals" && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Fecha objetivo" htmlFor="f-t"><input id="f-t" type="date" className="input" value={form.target_date as string} onChange={set("target_date")} /></Field>
            <Field label="Progreso %" htmlFor="f-p"><input id="f-p" type="number" min={0} max={100} className="input" value={form.progress as number} onChange={set("progress")} /></Field>
            <Field label="Responsable" htmlFor="f-o">
              <select id="f-o" className="input" value={(form.owner_id as number) ?? ""} onChange={set("owner_id")}>
                <option value="">—</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
          </div>
        )}
      </form>
    </Dialog>
  );
}
