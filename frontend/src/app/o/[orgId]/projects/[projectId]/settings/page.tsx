"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusIcon } from "@/components/tasks/bits";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Avatar, Empty, Field, PageLoader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useMembers, useOrgId, useProject, useProjectId, useTeams, useUpdateProject } from "@/lib/queries";
import type { ProjectRole, StatusCategory, UserBrief } from "@/lib/types";
import { CATEGORY_LABEL, cn, ROLE_LABEL, SWATCHES } from "@/lib/utils";

export default function ProjectSettingsPage() {
  const orgId = useOrgId();
  const projectId = useProjectId();
  const { data: project } = useProject(orgId, projectId);
  const update = useUpdateProject(orgId, projectId);
  const qc = useQueryClient();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", description: "", color: "", visibility: "organization", start_date: "", end_date: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (project) setForm({ name: project.name, description: project.description, color: project.color, visibility: project.visibility, start_date: project.start_date ?? "", end_date: project.end_date ?? "" });
  }, [project]);

  if (!project) return <PageLoader />;
  if (!project.permissions.includes("manage")) return <Empty title="Sin permisos" description="Sólo los gerentes del proyecto pueden cambiar sus ajustes." />;
  const refresh = () => qc.invalidateQueries({ queryKey: ["project", orgId, projectId] });
  const call = async (path: string, method: string, body?: unknown) => {
    try { await api(`/orgs/${orgId}/projects/${projectId}${path}`, { method, body }); refresh(); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-8">
      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">General</h2>
        <form className="mt-4 space-y-4" onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ ...form, start_date: form.start_date || null, end_date: form.end_date || null }, { onSuccess: () => toast.success("Proyecto actualizado") });
        }}>
          <Field label="Nombre" htmlFor="s-name"><input id="s-name" required minLength={2} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Descripción" htmlFor="s-desc"><textarea id="s-desc" rows={2} className="input h-auto py-2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inicio" htmlFor="s-s"><input id="s-s" type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="Fin" htmlFor="s-e"><input id="s-e" type="date" className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          </div>
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <span className="label">Color</span>
              <div className="flex gap-2">
                {SWATCHES.map((c) => (
                  <button type="button" key={c} onClick={() => setForm({ ...form, color: c })} aria-label={`Color ${c}`}
                    className={cn("h-7 w-7 rounded-lg ring-offset-2 ring-offset-surface", form.color === c && "ring-2 ring-ink/40")} style={{ background: c }} />
                ))}
              </div>
            </div>
            <Field label="Visibilidad" htmlFor="s-v">
              <select id="s-v" className="input w-56" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
                <option value="organization">Toda la organización</option>
                <option value="private">Privado</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end"><Button type="submit" loading={update.isPending}>Guardar cambios</Button></div>
        </form>
      </section>

      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Estados del flujo</h2>
        <p className="mt-0.5 text-sm text-ink-2">Columnas del tablero. La categoría define el comportamiento (p. ej. «Hecho» marca la tarea como completada).</p>
        <StatusEditor statuses={project.statuses} onCall={call} />
      </section>

      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Etiquetas</h2>
        <LabelEditor labels={project.labels} onCall={call} />
      </section>

      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Equipos con acceso</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Los integrantes de estos equipos ven el proyecto. Cada uno ve las tareas de su equipo y las que no tienen equipo; los equipos QA ven todas para validarlas.
        </p>
        <ProjectTeams orgId={orgId} linked={project.teams} onCall={call} />
      </section>

      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Personas del proyecto</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          {project.visibility === "organization"
            ? "Todos los miembros de la organización pueden ver este proyecto. Para excluir a alguien, cambia la visibilidad a «Privado»."
            : "Privado: sólo lo ven las personas añadidas aquí, los equipos con acceso y la dirección (CEO, administración y PMO)."}
        </p>
        <ProjectMembers orgId={orgId} projectId={projectId} onCall={call} />
      </section>

      <section className="card border-blocked/30 p-6">
        <h2 className="text-[15px] font-semibold text-blocked">Archivar proyecto</h2>
        <p className="mt-0.5 text-sm text-ink-2">El proyecto dejará de mostrarse. Los datos se conservan (borrado lógico) y un administrador de base de datos puede restaurarlo.</p>
        <Button variant="danger" className="mt-4" onClick={() => setConfirmDelete(true)} disabled={!project.permissions.includes("delete")}>Archivar proyecto</Button>
      </section>

      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} danger title="¿Archivar proyecto?" confirmLabel="Archivar"
        description={`${project.name} y sus tareas dejarán de ser visibles para todo el equipo.`}
        onConfirm={async () => {
          await api(`/orgs/${orgId}/projects/${projectId}`, { method: "DELETE" });
          qc.invalidateQueries({ queryKey: ["projects", orgId] });
          router.replace(`/o/${orgId}/projects`);
        }} />
    </div>
  );
}

type Call = (path: string, method: string, body?: unknown) => Promise<void>;

function StatusEditor({ statuses, onCall }: { statuses: { id: number; name: string; category: StatusCategory; color: string; position: number }[]; onCall: Call }) {
  const sorted = [...statuses].sort((a, b) => a.position - b.position);
  const [name, setName] = useState("");
  const [cat, setCat] = useState<StatusCategory>("todo");
  const [del, setDel] = useState<number | null>(null);
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const reorder = (i: number, dir: -1 | 1) => {
    const ids = sorted.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    onCall("/statuses/reorder", "POST", { ids });
  };
  return (
    <div className="mt-4">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {sorted.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2">
            <StatusIcon status={s} />
            <input defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && onCall(`/statuses/${s.id}`, "PATCH", { name: e.target.value.trim() })}
              className="h-8 flex-1 rounded-md bg-transparent px-2 text-[13.5px] outline-none hover:bg-subtle focus:bg-subtle" aria-label="Nombre del estado" />
            <select value={s.category} onChange={(e) => onCall(`/statuses/${s.id}`, "PATCH", { category: e.target.value })} className="input h-8 w-36 text-[13px]" aria-label="Categoría">
              {(Object.keys(CATEGORY_LABEL) as StatusCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <input type="color" value={s.color} onChange={(e) => onCall(`/statuses/${s.id}`, "PATCH", { color: e.target.value.toUpperCase() })} className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent" aria-label="Color" />
            <Button size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => reorder(i, -1)} aria-label="Subir"><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button size="icon-sm" variant="ghost" disabled={i === sorted.length - 1} onClick={() => reorder(i, 1)} aria-label="Bajar"><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Button size="icon-sm" variant="ghost" disabled={sorted.length <= 1} onClick={() => { setDel(s.id); setMoveTo(sorted.find((x) => x.id !== s.id)?.id ?? null); }} aria-label="Eliminar"><Trash2 className="h-3.5 w-3.5" /></Button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onCall("/statuses", "POST", { name: name.trim(), category: cat, color: { todo: "#98A2B3", in_progress: "#2563EB", review: "#8B5CF6", done: "#12B76A", blocked: "#F04438" }[cat] }); setName(""); } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo estado" className="input h-8 text-[13px]" />
        <select value={cat} onChange={(e) => setCat(e.target.value as StatusCategory)} className="input h-8 w-40 text-[13px]" aria-label="Categoría">
          {(Object.keys(CATEGORY_LABEL) as StatusCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <Button size="sm" type="submit"><Plus className="h-3.5 w-3.5" /> Añadir</Button>
      </form>
      {del !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-risk/10 p-3 text-[13px]">
          Mover sus tareas a
          <select value={moveTo ?? ""} onChange={(e) => setMoveTo(Number(e.target.value))} className="input h-8 w-44 text-[13px]">
            {sorted.filter((s) => s.id !== del).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button size="sm" variant="danger" onClick={() => { onCall(`/statuses/${del}?move_to=${moveTo}`, "DELETE"); setDel(null); }}>Eliminar estado</Button>
          <Button size="sm" variant="ghost" onClick={() => setDel(null)}>Cancelar</Button>
        </div>
      )}
    </div>
  );
}

function LabelEditor({ labels, onCall }: { labels: { id: number; name: string; color: string }[]; onCall: Call }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {labels.map((l) => (
          <span key={l.id} className="chip h-7 gap-1.5 pr-1" style={{ background: `${l.color}14`, color: l.color }}>
            {l.name}
            <button onClick={() => onCall(`/labels/${l.id}`, "DELETE")} className="rounded p-0.5 hover:bg-black/5" aria-label={`Eliminar ${l.name}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        {!labels.length && <p className="text-sm text-ink-3">Sin etiquetas.</p>}
      </div>
      <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onCall("/labels", "POST", { name: name.trim(), color }); setName(""); } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Nueva etiqueta" className="input h-8 max-w-xs text-[13px]" />
        <div className="flex gap-1">
          {SWATCHES.slice(0, 8).map((c) => (
            <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`} className={cn("h-6 w-6 rounded-md", color === c && "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface")} style={{ background: c }} />
          ))}
        </div>
        <Button size="sm" type="submit"><Plus className="h-3.5 w-3.5" /> Añadir</Button>
      </form>
    </div>
  );
}

function ProjectMembers({ orgId, projectId, onCall }: { orgId: number; projectId: number; onCall: Call }) {
  const { data: orgMembers } = useMembers(orgId);
  const { data: members, refetch } = useQuery({
    queryKey: ["project", orgId, projectId, "members"],
    queryFn: () => api<{ user: UserBrief; role: ProjectRole }[]>(`/orgs/${orgId}/projects/${projectId}/members`),
  });
  const [userId, setUserId] = useState<number | "">("");
  const [role, setRole] = useState<ProjectRole>("member");
  const candidates = (orgMembers ?? []).filter((m) => !members?.some((pm) => pm.user.id === m.user.id));
  const run = async (path: string, method: string, body?: unknown) => { await onCall(path, method, body); refetch(); };
  return (
    <div className="mt-4">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {members?.map((m) => (
          <li key={m.user.id} className="flex items-center gap-3 px-3 py-2">
            <Avatar user={m.user} size={28} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium">{m.user.full_name}</p>
              <p className="truncate text-xs text-ink-2">{m.user.email}</p>
            </div>
            <select value={m.role} onChange={(e) => run("/members", "POST", { user_id: m.user.id, role: e.target.value })} className="input h-8 w-48 text-[13px]" aria-label="Rol en el proyecto">
              {(["manager", "member", "guest"] as ProjectRole[]).map((r) => <option key={r} value={r}>{r === "guest" ? "Invitado (ver y comentar)" : ROLE_LABEL[r]}</option>)}
            </select>
            <Button size="icon-sm" variant="ghost" onClick={() => run(`/members/${m.user.id}`, "DELETE")} aria-label="Quitar"><X className="h-3.5 w-3.5" /></Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <select value={userId} onChange={(e) => setUserId(Number(e.target.value) || "")} className="input h-8 text-[13px]" aria-label="Persona">
          <option value="">Añadir persona…</option>
          {candidates.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.full_name} · {ROLE_LABEL[m.role]}</option>)}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} className="input h-8 w-44 text-[13px]" aria-label="Rol">
          <option value="manager">Gerente de proyecto</option><option value="member">Miembro</option><option value="guest">Invitado</option>
        </select>
        <Button size="sm" disabled={!userId} onClick={() => { run("/members", "POST", { user_id: userId, role }); setUserId(""); }}>Añadir</Button>
      </div>
    </div>
  );
}


function ProjectTeams({ orgId, linked, onCall }: { orgId: number; linked: { id: number; name: string; color: string; is_qa: boolean }[]; onCall: Call }) {
  const { data: teams } = useTeams(orgId);
  const [teamId, setTeamId] = useState<number | "">("");
  const available = (teams ?? []).filter((t) => !linked.some((l) => l.id === t.id));
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {linked.map((t) => (
          <span key={t.id} className="inline-flex h-8 items-center gap-2 rounded-lg border border-line pl-2.5 pr-1 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: t.color }} />{t.name}
            {t.is_qa && <span className="text-2xs text-review">QA</span>}
            <button onClick={() => onCall(`/teams/${t.id}`, "DELETE")} className="rounded p-1 text-ink-3 hover:bg-subtle hover:text-blocked" aria-label={`Quitar ${t.name}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        {!linked.length && <p className="text-sm text-ink-3">Ningún equipo tiene acceso todavía.</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <select value={teamId} onChange={(e) => setTeamId(Number(e.target.value) || "")} className="input h-8 max-w-xs text-[13px]" aria-label="Equipo">
          <option value="">Dar acceso a un equipo…</option>
          {available.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_qa ? " (QA)" : ""}</option>)}
        </select>
        <Button size="sm" disabled={!teamId} onClick={() => { onCall("/teams", "POST", { team_id: teamId }); setTeamId(""); }}>Dar acceso</Button>
      </div>
    </div>
  );
}
