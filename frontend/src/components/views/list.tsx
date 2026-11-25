"use client";

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DueBadge, PriorityIcon, StatusIcon, TypeIcon } from "@/components/tasks/bits";
import { Picker } from "@/components/ui/menu";
import { Avatar, Empty, LabelChip } from "@/components/ui/misc";
import { useUpdateTask } from "@/lib/queries";
import type { ProjectDetail, Task } from "@/lib/types";
import { cn, fmtMinutes, fmtRelative } from "@/lib/utils";

type SortKey = "number" | "title" | "status" | "priority" | "assignee" | "due" | "updated";
const PRIO_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export function ListView({ orgId, project, tasks, groupBy }: { orgId: number; project: ProjectDetail; tasks: Task[]; groupBy: "status" | "none" }) {
  const router = useRouter();
  const pathname = usePathname();
  const update = useUpdateTask(orgId);
  const canEdit = project.permissions.includes("edit");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "number", dir: -1 });
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  const sorted = useMemo(() => {
    const statusPos = Object.fromEntries(project.statuses.map((s) => [s.id, s.position]));
    const val = (t: Task): string | number => {
      switch (sort.key) {
        case "title": return t.title.toLowerCase();
        case "status": return statusPos[t.status_id] ?? 0;
        case "priority": return PRIO_RANK[t.priority];
        case "assignee": return t.assignee?.full_name.toLowerCase() ?? "~";
        case "due": return t.due_date ?? "9999";
        case "updated": return t.updated_at;
        default: return t.number;
      }
    };
    return [...tasks].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [tasks, sort, project.statuses]);

  const groups = groupBy === "status"
    ? [...project.statuses].sort((a, b) => a.position - b.position).map((s) => ({ status: s, items: sorted.filter((t) => t.status_id === s.id) }))
    : [{ status: null, items: sorted }];

  const open = (id: number) => router.replace(`${pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(window.location.search)), task: String(id) })}`, { scroll: false });

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn("px-3 py-2.5 font-medium", className)} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : 1 }))} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  if (!tasks.length) return <div className="card mx-4 sm:mx-8"><Empty title="Sin tareas" description="No hay tareas que coincidan con los filtros." /></div>;

  return (
    <div className="card mx-4 mb-8 overflow-x-auto sm:mx-8">
      <table className="w-full min-w-[920px] text-left text-[13.5px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line text-xs text-ink-2">
            <Th k="number" className="w-24 pl-4">Clave</Th>
            <Th k="title">Título</Th>
            <Th k="status" className="w-40">Estado</Th>
            <Th k="priority" className="w-32">Prioridad</Th>
            <Th k="assignee" className="w-44">Responsable</Th>
            <Th k="due" className="w-28">Fecha límite</Th>
            <th className="w-24 px-3 py-2.5 font-medium">Estimación</th>
            <Th k="updated" className="w-32">Actualizada</Th>
          </tr>
        </thead>
        {groups.map(({ status, items }) => (
          <tbody key={status?.id ?? "all"} className="divide-y divide-line">
            {status && (
              <tr className="bg-muted">
                <td colSpan={8} className="px-4 py-2">
                  <button onClick={() => setCollapsed((c) => ({ ...c, [status.id]: !c[status.id] }))} className="flex items-center gap-2 text-[13px] font-semibold">
                    {collapsed[status.id] ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <StatusIcon status={status} /> {status.name}
                    <span className="font-normal text-ink-3">{items.length}</span>
                  </button>
                </td>
              </tr>
            )}
            {!(status && collapsed[status.id]) && items.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-muted" onClick={() => open(t.id)}>
                <td className="py-2.5 pl-4 pr-3 text-xs text-ink-2">
                  <span className="inline-flex items-center gap-1.5"><TypeIcon type={t.type} />{t.key}</span>
                </td>
                <td className="max-w-0 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {t.parent_id && <span className="text-ink-3" aria-label="Subtarea">↳</span>}
                    <span className={cn("truncate font-medium", t.deleted_at && "text-ink-3 line-through")}>{t.title}</span>
                    {t.deleted_at && <span className="chip h-5 bg-blocked/10 px-1.5 text-2xs text-blocked">Eliminada</span>}
                    {t.team && <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-ink-3"><span className="h-1.5 w-1.5 rounded-full" style={{ background: t.team.color }} />{t.team.name}</span>}
                    {t.labels.slice(0, 2).map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />)}
                  </div>
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Picker
                    disabled={!canEdit}
                    searchable={false}
                    options={project.statuses.map((s) => ({ value: s.id, label: s.name, icon: <StatusIcon status={s} /> }))}
                    value={t.status_id}
                    onChange={(v) => update.mutate({ id: t.id, data: { status_id: v } })}
                    trigger={<button className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 hover:bg-subtle"><StatusIcon status={t.status} />{t.status?.name}</button>}
                  />
                </td>
                <td className="px-3 py-2.5"><PriorityIcon priority={t.priority} withLabel /></td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-2"><Avatar user={t.assignee} size={22} /><span className="truncate">{t.assignee?.full_name ?? <span className="text-ink-3">—</span>}</span></span>
                </td>
                <td className="px-3 py-2.5"><DueBadge date={t.due_date} done={t.status?.category === "done"} /></td>
                <td className="px-3 py-2.5 text-xs text-ink-2">{t.estimate_minutes ? fmtMinutes(t.estimate_minutes) : "—"}</td>
                <td className="px-3 py-2.5 text-xs text-ink-2">{fmtRelative(t.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
