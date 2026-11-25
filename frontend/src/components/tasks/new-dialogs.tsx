"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Picker } from "@/components/ui/menu";
import { Avatar, Field } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAssignable, useInvalidateTasks, useProject, useProjects, useTeams } from "@/lib/queries";
import type { Priority, ProjectDetail, TaskDetail, TaskType } from "@/lib/types";
import { cn, PRIORITY_LABEL, SWATCHES, TYPE_LABEL } from "@/lib/utils";
import { PriorityIcon, StatusIcon, TypeIcon } from "./bits";

export function NewProjectDialog({ orgId, open, onOpenChange }: { orgId: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", key: "", description: "", color: SWATCHES[0], visibility: "private", start_date: "", end_date: "" });
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const { data: teams } = useTeams(orgId);
  const [keyTouched, setKeyTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!keyTouched) {
      const k = form.name.normalize("NFD").replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean)
        .map((w) => w[0]).join("").toUpperCase().slice(0, 4);
      setForm((f) => ({ ...f, key: k.length >= 2 ? k : form.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() }));
    }
  }, [form.name, keyTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api<ProjectDetail>(`/orgs/${orgId}/projects`, {
        method: "POST",
        body: { ...form, start_date: form.start_date || null, end_date: form.end_date || null, team_ids: teamIds },
      });
      qc.invalidateQueries({ queryKey: ["projects", orgId] });
      onOpenChange(false);
      setForm({ name: "", key: "", description: "", color: SWATCHES[0], visibility: "private", start_date: "", end_date: "" });
      setTeamIds([]);
      setKeyTouched(false);
      router.push(`/o/${orgId}/projects/${p.id}/board`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nuevo proyecto"
      description="Los proyectos agrupan tareas, estados y personas."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="new-project" loading={busy}>Crear proyecto</Button>
        </>
      }
    >
      <form id="new-project" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="Nombre" htmlFor="pname">
            <input id="pname" required minLength={2} autoFocus className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Clave" htmlFor="pkey">
            <input id="pkey" required pattern="[A-Za-z][A-Za-z0-9]{1,9}" maxLength={10} className="input uppercase" value={form.key}
              onChange={(e) => { setKeyTouched(true); setForm({ ...form, key: e.target.value.toUpperCase() }); }} />
          </Field>
        </div>
        <Field label="Descripción" htmlFor="pdesc">
          <textarea id="pdesc" rows={2} maxLength={500} className="input h-auto py-2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inicio" htmlFor="ps"><input id="ps" type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="Fin" htmlFor="pe"><input id="pe" type="date" className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
        </div>
        <div>
          <span className="label">Color</span>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((c) => (
              <button type="button" key={c} onClick={() => setForm({ ...form, color: c })} aria-label={`Color ${c}`}
                className={cn("h-7 w-7 rounded-lg ring-offset-2 ring-offset-surface", form.color === c && "ring-2 ring-ink/40")} style={{ background: c }} />
            ))}
          </div>
        </div>
        <div>
          <span className="label">Visibilidad</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: "private", t: "Privado", d: "Sólo tú, los equipos y las personas que añadas." },
              { v: "organization", t: "Toda la organización", d: "Cualquier miembro puede verlo." },
            ].map((o) => (
              <button type="button" key={o.v} onClick={() => setForm({ ...form, visibility: o.v })}
                className={cn("rounded-lg border p-3 text-left transition-colors", form.visibility === o.v ? "border-primary bg-primary-soft" : "border-line hover:border-line-strong")}>
                <span className="block text-[13px] font-medium">{o.t}</span>
                <span className="mt-0.5 block text-xs text-ink-2">{o.d}</span>
              </button>
            ))}
          </div>
        </div>
        {!!teams?.length && (
          <div>
            <span className="label">Equipos con acceso</span>
            <div className="flex flex-wrap gap-2">
              {teams.map((t) => {
                const on = teamIds.includes(t.id);
                return (
                  <button type="button" key={t.id} onClick={() => setTeamIds(on ? teamIds.filter((x) => x !== t.id) : [...teamIds, t.id])}
                    className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]", on ? "border-primary bg-primary-soft text-primary" : "border-line hover:bg-subtle")}>
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: t.color }} />{t.name}{t.is_qa && <span className="text-2xs opacity-70">QA</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}

export function NewTaskDialog({ orgId, open, onOpenChange, defaults }: {
  orgId: number; open: boolean; onOpenChange: (o: boolean) => void;
  defaults?: { project_id?: number; status_id?: number; due_date?: string; start_date?: string; parent_id?: number };
}) {
  const router = useRouter();
  const invalidate = useInvalidateTasks(orgId);
  const { data: projects } = useProjects(orgId);
  const creatable = (projects ?? []).filter((p) => p.permissions.includes("create"));
  const [projectId, setProjectId] = useState<number | undefined>(defaults?.project_id);
  const { data: project } = useProject(orgId, projectId ?? 0);
  const { data: people } = useAssignable(orgId, projectId);
  const empty = { title: "", type: "task" as TaskType, priority: "none" as Priority, status_id: 0, assignee_id: null as number | null,
    start_date: "", due_date: "", estimate: "", label_ids: [] as number[], description: "", team_id: null as number | null };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (open) {
      setProjectId(defaults?.project_id ?? creatable[0]?.id);
      setForm({ ...empty, status_id: defaults?.status_id ?? 0, due_date: defaults?.due_date ?? "", start_date: defaults?.start_date ?? "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const statusId = form.status_id || project?.statuses[0]?.id || 0;
  const status = project?.statuses.find((s) => s.id === statusId) ?? null;
  const assignee = people?.find((u) => u.id === form.assignee_id) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setBusy(true);
    try {
      const t = await api<TaskDetail>(`/orgs/${orgId}/tasks`, {
        method: "POST",
        body: {
          project_id: projectId, title: form.title, type: form.type, priority: form.priority, status_id: statusId || null,
          assignee_id: form.assignee_id, start_date: form.start_date || null, due_date: form.due_date || null,
          estimate_minutes: form.estimate ? Math.round(parseFloat(form.estimate) * 60) : null, label_ids: form.label_ids,
          description: form.description ? `<p>${form.description.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</p>` : "",
          parent_id: defaults?.parent_id ?? null,
          team_id: form.team_id,
        },
      });
      invalidate(defaults?.parent_id);
      toast.success(`${t.key} creada`, {
        action: { label: "Abrir", onClick: () => router.push(`/o/${orgId}/projects/${t.project_id}/board?task=${t.id}`) },
      });
      if (more) setForm({ ...form, title: "", description: "" });
      else onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chip = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] text-ink hover:bg-subtle";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={defaults?.parent_id ? "Nueva subtarea" : "Nueva tarea"}
      footer={
        <div className="flex w-full items-center justify-between">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} className="accent-primary" /> Crear otra
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" form="new-task" loading={busy} disabled={!projectId || !form.title.trim()}>Crear tarea</Button>
          </div>
        </div>
      }
    >
      {creatable.length === 0 && projects ? (
        <p className="text-sm text-ink-2">No tienes permiso para crear tareas en ningún proyecto.</p>
      ) : (
        <form id="new-task" onSubmit={submit} className="space-y-4">
          <input
            autoFocus
            required
            maxLength={255}
            placeholder="Título de la tarea"
            className="w-full bg-transparent font-display text-lg font-semibold outline-none placeholder:text-ink-3"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            rows={3}
            placeholder="Añade una descripción… (podrás darle formato después)"
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-ink-3"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            {!defaults?.parent_id && (
              <Picker
                options={creatable.map((p) => ({ value: p.id, label: p.name, icon: <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} /> }))}
                value={projectId ?? null}
                onChange={(v) => { setProjectId(v as number); setForm({ ...form, status_id: 0, label_ids: [], assignee_id: null }); }}
                trigger={<button type="button" className={chip}>{creatable.find((p) => p.id === projectId)?.name ?? "Proyecto"}</button>}
              />
            )}
            <Picker
              searchable={false}
              options={(Object.keys(TYPE_LABEL) as TaskType[]).map((t) => ({ value: t, label: TYPE_LABEL[t], icon: <TypeIcon type={t} /> }))}
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v as TaskType })}
              trigger={<button type="button" className={chip}><TypeIcon type={form.type} withLabel /></button>}
            />
            <Picker
              searchable={false}
              options={(project?.statuses ?? []).map((s) => ({ value: s.id, label: s.name, icon: <StatusIcon status={s} /> }))}
              value={statusId}
              onChange={(v) => setForm({ ...form, status_id: v as number })}
              trigger={<button type="button" className={chip}><StatusIcon status={status} />{status?.name ?? "Estado"}</button>}
            />
            <Picker
              searchable={false}
              options={(["urgent", "high", "medium", "low", "none"] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))}
              value={form.priority}
              onChange={(v) => setForm({ ...form, priority: v as Priority })}
              trigger={<button type="button" className={chip}><PriorityIcon priority={form.priority} withLabel /></button>}
            />
            <Picker
              options={[{ value: null, label: "Sin asignar", icon: <Avatar user={null} size={18} /> },
                ...(people ?? []).map((u) => ({ value: u.id, label: u.full_name, icon: <Avatar user={u} size={18} /> }))]}
              value={form.assignee_id}
              onChange={(v) => setForm({ ...form, assignee_id: v as number | null })}
              trigger={<button type="button" className={chip}><Avatar user={assignee} size={18} />{assignee?.full_name ?? "Responsable"}</button>}
            />
            {!!project?.teams.length && (
              <Picker
                searchable={false}
                options={[{ value: null, label: "Sin equipo (todo el proyecto)" },
                  ...project.teams.map((t) => ({ value: t.id, label: t.name, icon: <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: t.color }} /> }))]}
                value={form.team_id}
                onChange={(v) => setForm({ ...form, team_id: v as number | null, assignee_id: null })}
                trigger={<button type="button" className={chip}>{project.teams.find((t) => t.id === form.team_id)?.name ?? "Equipo"}</button>}
              />
            )}
            {!!project?.labels.length && (
              <Picker
                multiple
                options={project.labels.map((l) => ({ value: l.id, label: l.name, icon: <span className="h-2 w-2 rounded-full" style={{ background: l.color }} /> }))}
                value={form.label_ids}
                onChange={(v) => setForm({ ...form, label_ids: v as number[] })}
                trigger={<button type="button" className={chip}>{form.label_ids.length ? `${form.label_ids.length} etiquetas` : "Etiquetas"}</button>}
              />
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
            <Field label="Inicio" htmlFor="ts"><input id="ts" type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="Fecha límite" htmlFor="td"><input id="td" type="date" className="input" value={form.due_date} min={form.start_date || undefined} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <Field label="Estimación (h)" htmlFor="te"><input id="te" type="number" min="0" step="0.5" className="input" value={form.estimate} onChange={(e) => setForm({ ...form, estimate: e.target.value })} /></Field>
          </div>
        </form>
      )}
    </Dialog>
  );
}
