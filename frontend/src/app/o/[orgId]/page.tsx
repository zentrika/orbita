"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { useWorkspace } from "@/components/layout/workspace-context";
import { ActivityFeed } from "@/components/tasks/activity";
import { TaskRow } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { Avatar, Empty, PageLoader, ProgressBar } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { useDashboard, useOrgId } from "@/lib/queries";
import { CATEGORY_LABEL, cn, fmtMinutes, HEALTH } from "@/lib/utils";

const CAT_COLOR: Record<string, string> = { todo: "#98A2B3", in_progress: "#2563EB", review: "#8B5CF6", blocked: "#F04438", done: "#12B76A" };

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: "danger" | "warn"; hint?: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className={cn("mt-1 font-display text-[28px] font-bold leading-none tabular-nums", tone === "danger" && value > 0 && "text-blocked", tone === "warn" && value > 0 && "text-risk")}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

export default function DashboardPage() {
  const orgId = useOrgId();
  const { me } = useAuth();
  const { data, isLoading } = useDashboard(orgId);
  const { newProject } = useWorkspace();
  const org = me?.organizations.find((o) => o.organization_id === orgId);

  if (isLoading || !data) return <PageLoader />;
  const statusTotal = Object.values(data.by_status).reduce((a, b) => a + b, 0);
  const maxLoad = Math.max(1, ...data.workload.map((w) => w.open));

  return (
    <>
      <PageHeader title={`${greeting()}, ${me?.full_name.split(" ")[0]}`} description={`Resumen del trabajo en ${org?.name}.`} />
      <div className="space-y-6 px-4 py-6 sm:px-8">
        <div className="card grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-line md:[&>*:nth-child(-n+2)]:border-b-0">
          <Stat label="Tareas abiertas" value={data.open_tasks} hint={`${data.in_review} en revisión`} />
          <Stat label="Vencidas" value={data.overdue_tasks} tone="danger" hint={data.blocked ? `${data.blocked} bloqueadas` : "Ninguna bloqueada"} />
          <Stat label="Vencen esta semana" value={data.due_this_week} tone="warn" hint="Próximos 7 días" />
          <Stat label="Completadas" value={data.completed_last_7_days} hint="Últimos 7 días" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[15px] font-semibold">Mis tareas</h2>
              <Link href={`/o/${orgId}/my-work`} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                Ver todo <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {data.my_open.length ? (
              <div className="divide-y divide-line">{data.my_open.map((t) => <TaskRow key={t.id} task={t} showProject />)}</div>
            ) : (
              <Empty title="No tienes tareas pendientes" description="Las tareas asignadas a ti aparecerán aquí." />
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-[15px] font-semibold">Distribución por estado</h2>
            {statusTotal ? (
              <>
                <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                  {Object.entries(CAT_COLOR).map(([k, c]) => data.by_status[k] ? (
                    <div key={k} style={{ width: `${(data.by_status[k] / statusTotal) * 100}%`, background: c }} title={`${CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL]}: ${data.by_status[k]}`} />
                  ) : null)}
                </div>
                <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
                  {Object.entries(CAT_COLOR).map(([k, c]) => (
                    <li key={k} className="flex items-center gap-2 text-[13px]">
                      <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                      <span className="flex-1 text-ink-2">{CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL]}</span>
                      <span className="font-medium tabular-nums">{data.by_status[k] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="mt-3 text-sm text-ink-3">Aún no hay tareas.</p>}

            <h2 className="mt-8 text-[15px] font-semibold">Carga por persona</h2>
            <p className="text-xs text-ink-3">Tareas abiertas asignadas</p>
            <ul className="mt-4 space-y-3">
              {data.workload.slice(0, 8).map((w, i) => (
                <li key={w.user?.id ?? `u${i}`} className="flex items-center gap-3 text-[13px]">
                  <Avatar user={w.user} size={24} />
                  <span className="w-28 truncate">{w.user?.full_name ?? "Sin asignar"}</span>
                  <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-subtle">
                    <div className="h-full bg-progress" style={{ width: `${((w.open - w.overdue) / maxLoad) * 100}%` }} />
                    <div className="h-full bg-blocked" style={{ width: `${(w.overdue / maxLoad) * 100}%` }} />
                  </div>
                  <span className="w-6 text-right font-medium tabular-nums">{w.open}</span>
                  <span className="hidden w-14 text-right text-xs text-ink-3 sm:inline">{w.estimate_minutes ? fmtMinutes(w.estimate_minutes) : ""}</span>
                </li>
              ))}
              {!data.workload.length && <li className="text-sm text-ink-3">Sin tareas abiertas.</li>}
            </ul>
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[15px] font-semibold">Progreso de proyectos</h2>
              <Link href={`/o/${orgId}/projects`} className="text-[13px] font-medium text-primary hover:underline">Todos</Link>
            </div>
            {data.projects.length ? (
              <ul className="divide-y divide-line">
                {data.projects.map((p) => (
                  <li key={p.id}>
                    <Link href={`/o/${orgId}/projects/${p.id}/board`} className="grid grid-cols-[minmax(0,1fr)_120px_48px] items-center gap-4 px-4 py-3 hover:bg-muted sm:grid-cols-[minmax(0,1fr)_100px_160px_48px]">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
                        <span className="truncate text-[13.5px] font-medium">{p.name}</span>
                      </span>
                      <span className="hidden items-center gap-1.5 text-xs sm:flex" style={{ color: HEALTH[p.status]?.color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEALTH[p.status]?.color }} />{HEALTH[p.status]?.label}
                      </span>
                      <ProgressBar value={p.progress} color={p.color} />
                      <span className="text-right text-[13px] font-medium tabular-nums">{p.progress}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Sin proyectos" description="Crea el primero para empezar a organizar el trabajo." action={org?.role !== "guest" && <Button onClick={newProject}>Nuevo proyecto</Button>} />
            )}
          </section>
          <section className="card p-5">
            <h2 className="mb-4 text-[15px] font-semibold">Actividad reciente</h2>
            <ActivityFeed items={data.recent_activity} withTask />
          </section>
        </div>
      </div>
    </>
  );
}
