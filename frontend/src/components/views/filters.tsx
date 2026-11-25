"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PriorityIcon, TypeIcon } from "@/components/tasks/bits";
import { Picker } from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import type { Priority, ProjectDetail, TaskType, UserBrief } from "@/lib/types";
import { cn, PRIORITY_LABEL, TYPE_LABEL } from "@/lib/utils";

export interface ProjectFilters {
  q?: string;
  assignee_id?: number;
  type?: string;
  priority?: string;
  label_id?: number;
  sprint_id?: number;
}

/** Filtros persistidos en la URL para que se puedan compartir y sobrevivan a recargas. */
export function useProjectFilters(): [ProjectFilters, (f: Partial<ProjectFilters>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
  const filters: ProjectFilters = {
    q: params.get("q") ?? undefined,
    assignee_id: num("assignee"),
    type: params.get("type") ?? undefined,
    priority: params.get("priority") ?? undefined,
    label_id: num("label"),
    sprint_id: num("sprint"),
  };
  const set = (f: Partial<ProjectFilters>) => {
    const next = new URLSearchParams(params.toString());
    const map: Record<string, string> = { assignee_id: "assignee", label_id: "label", sprint_id: "sprint" };
    for (const [k, v] of Object.entries(f)) {
      const key = map[k] ?? k;
      if (v === undefined || v === null || v === "") next.delete(key);
      else next.set(key, String(v));
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  return [filters, set];
}

const pill = "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors";

export function FilterBar({ project, people, extra }: { project: ProjectDetail; people: UserBrief[]; extra?: React.ReactNode }) {
  const [f, set] = useProjectFilters();
  const [q, setQ] = useState(f.q ?? "");
  useEffect(() => {
    const t = setTimeout(() => q !== (f.q ?? "") && set({ q: q || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = (v: unknown) => (v ? "border-primary/40 bg-primary-soft text-primary" : "border-line bg-surface text-ink hover:bg-subtle");
  const assignee = people.find((p) => p.id === f.assignee_id);
  const label = project.labels.find((l) => l.id === f.label_id);
  const anyActive = f.q || f.assignee_id || f.type || f.priority || f.label_id;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-8">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar tareas…" className="input h-8 w-48 pl-8 text-[13px]" aria-label="Filtrar tareas" />
      </div>
      <Picker
        options={[{ value: -1, label: "Sin asignar", icon: <Avatar user={null} size={18} /> }, ...people.map((u) => ({ value: u.id, label: u.full_name, icon: <Avatar user={u} size={18} /> }))]}
        value={f.assignee_id ?? null}
        onChange={(v) => set({ assignee_id: f.assignee_id === v ? undefined : (v as number) })}
        trigger={<button className={cn(pill, active(f.assignee_id))}>{assignee ? <><Avatar user={assignee} size={16} />{assignee.full_name.split(" ")[0]}</> : f.assignee_id === -1 ? "Sin asignar" : "Responsable"}<ChevronDown className="h-3.5 w-3.5 opacity-60" /></button>}
      />
      <Picker
        searchable={false}
        options={(Object.keys(TYPE_LABEL) as TaskType[]).map((t) => ({ value: t, label: TYPE_LABEL[t], icon: <TypeIcon type={t} /> }))}
        value={f.type ?? null}
        onChange={(v) => set({ type: f.type === v ? undefined : (v as string) })}
        trigger={<button className={cn(pill, active(f.type))}>{f.type ? TYPE_LABEL[f.type as TaskType] : "Tipo"}<ChevronDown className="h-3.5 w-3.5 opacity-60" /></button>}
      />
      <Picker
        searchable={false}
        options={(["urgent", "high", "medium", "low", "none"] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))}
        value={f.priority ?? null}
        onChange={(v) => set({ priority: f.priority === v ? undefined : (v as string) })}
        trigger={<button className={cn(pill, active(f.priority))}>{f.priority ? PRIORITY_LABEL[f.priority as Priority] : "Prioridad"}<ChevronDown className="h-3.5 w-3.5 opacity-60" /></button>}
      />
      {project.labels.length > 0 && (
        <Picker
          options={project.labels.map((l) => ({ value: l.id, label: l.name, icon: <span className="h-2 w-2 rounded-full" style={{ background: l.color }} /> }))}
          value={f.label_id ?? null}
          onChange={(v) => set({ label_id: f.label_id === v ? undefined : (v as number) })}
          trigger={<button className={cn(pill, active(f.label_id))}>{label?.name ?? "Etiqueta"}<ChevronDown className="h-3.5 w-3.5 opacity-60" /></button>}
        />
      )}
      {anyActive && (
        <button onClick={() => { setQ(""); set({ q: undefined, assignee_id: undefined, type: undefined, priority: undefined, label_id: undefined }); }}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-ink-2 hover:bg-subtle hover:text-ink">
          <X className="h-3.5 w-3.5" /> Limpiar
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">{extra}</div>
    </div>
  );
}

/** Convierte filtros de UI en parámetros de la API. */
export function toQuery(projectId: number, f: ProjectFilters) {
  return {
    project_id: projectId,
    q: f.q,
    assignee_id: f.assignee_id && f.assignee_id > 0 ? f.assignee_id : undefined,
    unassigned: f.assignee_id === -1 ? true : undefined,
    type: f.type,
    priority: f.priority,
    label_id: f.label_id,
    sprint_id: f.sprint_id,
  };
}
