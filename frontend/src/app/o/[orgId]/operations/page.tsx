"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Award, ChevronDown, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PriorityIcon, StatusIcon } from "@/components/tasks/bits";
import { CommentThread } from "@/components/tasks/comments";
import { Picker } from "@/components/ui/menu";
import { Avatar, Empty, PageLoader, Segmented, Spinner } from "@/components/ui/misc";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAchievements, useMembers, useOrgId, useProjects, useTeams } from "@/lib/queries";
import type { Priority, StatusCategory, Task } from "@/lib/types";
import { CATEGORY_LABEL, cn, fmtDate, PRIORITY_LABEL } from "@/lib/utils";

const PAGE = 60;
// Notas adhesivas: tono suave por estado, legible en claro y oscuro.
const NOTE: Record<StatusCategory, string> = {
  todo: "bg-[#FFFBEB] border-[#FDE68A] dark:bg-[#2A2414] dark:border-[#5C4A12]",
  in_progress: "bg-[#EFF6FF] border-[#BFDBFE] dark:bg-[#132036] dark:border-[#1E3A8A]",
  review: "bg-[#F5F3FF] border-[#DDD6FE] dark:bg-[#1F1A36] dark:border-[#4C1D95]",
  done: "bg-[#ECFDF3] border-[#A6F4C5] dark:bg-[#11271C] dark:border-[#065F46]",
  blocked: "bg-[#FEF3F2] border-[#FECDCA] dark:bg-[#2D1715] dark:border-[#7A271A]",
};
const TILT = ["-rotate-[0.8deg]", "rotate-[0.6deg]", "rotate-0", "-rotate-[0.4deg]", "rotate-[1deg]"];

function StickyNote({ t, onComments }: { t: Task; onComments: () => void }) {
  const cat = t.status?.category ?? "todo";
  return (
    <article className={cn("relative flex min-h-[150px] flex-col rounded-md border p-3 shadow-sm transition-transform hover:z-10 hover:rotate-0 hover:shadow-md", NOTE[cat], TILT[t.id % TILT.length])}>
      <span className="absolute left-1/2 top-0 h-2.5 w-12 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-ink/10" aria-hidden />
      <div className="flex items-center gap-1.5 text-2xs">
        <span className="font-semibold text-ink-2">{t.key}</span>
        <span className="ml-auto inline-flex items-center gap-1"><PriorityIcon priority={t.priority} />{PRIORITY_LABEL[t.priority]}</span>
      </div>
      <p className="mt-1.5 line-clamp-3 flex-1 text-[13.5px] font-semibold leading-snug">{t.title}</p>
      <div className="mt-2 flex items-center gap-1.5 text-2xs text-ink-2"><StatusIcon status={t.status} size={12} />{t.status?.name}
        {t.due_date && <span className="ml-auto">{fmtDate(t.due_date)}</span>}</div>
      <div className="mt-2 flex items-center gap-2 border-t border-ink/10 pt-2">
        {t.team ? <span className="inline-flex min-w-0 items-center gap-1 truncate text-2xs font-medium"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.team.color }} />{t.team.name}</span>
          : <span className="text-2xs text-ink-3">Sin equipo</span>}
        <Avatar user={t.assignee} size={20} className="ml-auto ring-transparent" />
        <button
          onClick={onComments}
          className="relative inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-surface px-2 text-2xs font-semibold shadow-xs ring-1 ring-line transition-transform hover:scale-105"
          aria-label={`${t.comment_count} comentarios de ${t.key}`}
        >
          <MessageCircle className="mr-1 h-3.5 w-3.5 text-primary" />{t.comment_count}
        </button>
      </div>
    </article>
  );
}

export default function OperationsPage() {
  const orgId = useOrgId();
  const { me } = useAuth();
  const role = me?.organizations.find((o) => o.organization_id === orgId)?.role;
  const allowed = role === "owner" || role === "admin" || role === "pmo";
  const { data: projects } = useProjects(orgId);
  const { data: teams } = useTeams(orgId);
  const { data: members } = useMembers(orgId);
  const [tab, setTab] = useState<"canvas" | "recognition">("canvas");
  const [f, setF] = useState<{ project_id?: number; team_id?: number; status_category?: string; priority?: string; assignee_id?: number }>({ status_category: "todo,in_progress,review,blocked" });
  const [panel, setPanel] = useState<Task | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["tasks", orgId, "ops", f],
    queryFn: ({ pageParam }) => api<Task[]>(`/orgs/${orgId}/tasks${qs({ ...f, limit: PAGE, offset: pageParam, sort: "updated", include_deleted: false, top_level: true })}`),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
    enabled: allowed,
  });
  const tasks = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  if (!allowed) return <Empty title="Centro de Operaciones" description="Disponible para el CEO, la administración y el PMO." />;

  const pill = (active: boolean) => cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]", active ? "border-primary/40 bg-primary-soft text-primary" : "border-line bg-surface hover:bg-subtle");
  const projectName = projects?.find((p) => p.id === f.project_id)?.name;
  const teamName = teams?.find((t) => t.id === f.team_id)?.name;
  const assigneeName = members?.find((m) => m.user.id === f.assignee_id)?.user.full_name;
  const cats = (Object.keys(CATEGORY_LABEL) as StatusCategory[]);

  return (
    <>
      <PageHeader title="Centro de Operaciones" description="Vista de lectura del trabajo de toda la organización. Las tareas se modifican desde su proyecto.">
        <div className="pb-3"><Segmented value={tab} onChange={setTab} options={[{ value: "canvas", label: "Tablero de notas" }, { value: "recognition", label: "Reconocimientos" }]} /></div>
      </PageHeader>
      {tab === "recognition" ? <Recognition orgId={orgId} /> : (
        <div className="px-4 py-4 sm:px-8">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Picker options={[{ value: null, label: "Todos los proyectos" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]}
              value={f.project_id ?? null} onChange={(v) => setF({ ...f, project_id: (v as number) || undefined })}
              trigger={<button className={pill(!!f.project_id)}>{projectName ?? "Proyecto"}<ChevronDown className="h-3.5 w-3.5 opacity-60" /></button>} />
            <Picker options={[{ value: null, label: "Todos los equipos" }, ...(teams ?? []).map((t) => ({ value: t.id, label: t.name, icon: <span className="h-2 w-2 rounded-full" style={{ background: t.color }} /> }))]}
              value={f.team_id ?? null} onChange={(v) => setF({ ...f, team_id: (v as number) || undefined })}
              trigger={<button className={pill(!!f.team_id)}>{teamName ?? "Equipo"}<ChevronDown className="h-3.5 w-3.5 opacity-60" /></button>} />
            <Picker multiple searchable={false} options={cats.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
              value={(f.status_category ?? "").split(",").filter(Boolean)} onChange={(v) => setF({ ...f, status_category: (v as string[]).join(",") || undefined })}
              trigger={<button className={pill(!!f.status_category)}>Estado{f.status_category ? ` · ${f.status_category.split(",").length}` : ""}<ChevronDown className="h-3.5 w-3.5 opacity-60" /></button>} />
            <Picker searchable={false} options={[{ value: null, label: "Todas" }, ...(["urgent", "high", "medium", "low", "none"] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))]}
              value={f.priority ?? null} onChange={(v) => setF({ ...f, priority: (v as string) || undefined })}
              trigger={<button className={pill(!!f.priority)}>{f.priority ? PRIORITY_LABEL[f.priority as Priority] : "Prioridad"}<ChevronDown className="h-3.5 w-3.5 opacity-60" /></button>} />
            <Picker options={[{ value: null, label: "Todos" }, ...(members ?? []).map((m) => ({ value: m.user.id, label: m.user.full_name, icon: <Avatar user={m.user} size={18} /> }))]}
              value={f.assignee_id ?? null} onChange={(v) => setF({ ...f, assignee_id: (v as number) || undefined })}
              trigger={<button className={pill(!!f.assignee_id)}>{assigneeName ?? "Responsable"}<ChevronDown className="h-3.5 w-3.5 opacity-60" /></button>} />
            <span className="ml-auto text-[13px] text-ink-2">{tasks.length}{query.hasNextPage ? "+" : ""} tareas</span>
          </div>
          {query.isLoading ? <PageLoader /> : !tasks.length ? <div className="card"><Empty title="Sin tareas con esos filtros" /></div> : (
            <div className="rounded-2xl border border-line bg-muted/50 p-5"
              style={{ backgroundImage: "radial-gradient(rgb(var(--line-strong) / 0.5) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
                {tasks.map((t) => <StickyNote key={t.id} t={t} onComments={() => setPanel(t)} />)}
              </div>
              <div ref={sentinel} className="flex justify-center py-6">{query.isFetchingNextPage && <Spinner />}</div>
            </div>
          )}
        </div>
      )}
      {panel && (
        <>
          <div className="fixed inset-0 z-30 bg-[#0C111D]/20" onClick={() => setPanel(null)} aria-hidden />
          <aside className="fixed inset-y-0 right-0 z-40 flex w-full animate-slide-in flex-col border-l border-line bg-surface shadow-lg sm:w-[480px]" aria-label="Comentarios">
            <div className="flex h-14 items-center gap-2 border-b border-line px-5">
              <span className="text-xs font-medium text-ink-2">{panel.key}</span>
              <span className="truncate text-[13.5px] font-semibold">{panel.title}</span>
              <Link href={`/o/${orgId}/projects/${panel.project_id}/board?task=${panel.id}`} className="ml-auto shrink-0 text-xs font-medium text-primary hover:underline">Abrir tarea</Link>
              <button onClick={() => setPanel(null)} className="rounded-md p-1.5 text-ink-3 hover:bg-subtle" aria-label="Cerrar"><X className="h-4 w-4" /></button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto p-5">
              <CommentThread orgId={orgId} taskId={panel.id} projectId={panel.project_id} canComment canAttach />
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function Recognition({ orgId }: { orgId: number }) {
  const { data: teams } = useTeams(orgId);
  const { data: projects } = useProjects(orgId);
  const [teamId, setTeamId] = useState<number | undefined>();
  const [projectId, setProjectId] = useState<number | undefined>();
  const { data, isLoading } = useAchievements(orgId, { team_id: teamId, project_id: projectId }, true);
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8">
      <p className="mb-4 text-[13px] text-ink-2">
        Reconocimientos verificados (resoluciones validadas por QA, validaciones con evidencia y rachas). No es un ranking: cada uno muestra su contexto,
        y tareas de distinta complejidad no son comparables entre sí.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input h-8 w-48 text-[13px]" value={teamId ?? ""} onChange={(e) => setTeamId(Number(e.target.value) || undefined)} aria-label="Equipo">
          <option value="">Todos los equipos</option>{teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="input h-8 w-48 text-[13px]" value={projectId ?? ""} onChange={(e) => setProjectId(Number(e.target.value) || undefined)} aria-label="Proyecto">
          <option value="">Todos los proyectos</option>{projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {isLoading ? <PageLoader /> : !data?.length ? <div className="card"><Empty title="Aún no hay reconocimientos" description="Aparecen cuando QA valida una entrega o alguien sostiene una racha de contribuciones." /></div> : (
        <ul className="card divide-y divide-line">
          {data.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3 text-[13px]">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-risk/10"><Award className="h-4 w-4 text-risk" /></span>
              <div className="min-w-0 flex-1">
                <p><strong>{a.user.full_name}</strong> · {a.name}</p>
                <p className="text-xs text-ink-2">
                  {a.task ? <Link href={`/o/${orgId}/projects/${a.project?.id}/board?task=${a.task.id}`} className="text-primary hover:underline">{a.task.key}</Link> : null}
                  {a.task && ` ${a.task.title}`}{a.team && ` · ${a.team.name}`}
                </p>
                {a.evidence && (a.evidence.qa_note || a.evidence.evidence) ? <p className="mt-0.5 text-xs text-ink-3">Evidencia: «{String(a.evidence.qa_note ?? a.evidence.evidence)}»</p> : null}
              </div>
              <span className="shrink-0 text-xs text-ink-3">{fmtDate(a.awarded_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
