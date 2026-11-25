"use client";

import { CalendarDays, GanttChart, KanbanSquare, LayoutDashboard, List, Lock, Plus, Settings, Share2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useWorkspace } from "@/components/layout/workspace-context";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/menu";
import { AvatarStack, Empty, PageLoader } from "@/components/ui/misc";
import { useOrgId, useProject, useProjectId, useUpdateProject } from "@/lib/queries";
import { cn, HEALTH } from "@/lib/utils";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const orgId = useOrgId();
  const projectId = useProjectId();
  const pathname = usePathname();
  const { data: project, isLoading, error } = useProject(orgId, projectId);
  const { newTask } = useWorkspace();
  const updateProject = useUpdateProject(orgId, projectId);

  if (isLoading) return <PageLoader />;
  if (error || !project) return <Empty title="Proyecto no disponible" description="No existe o no tienes acceso." />;

  const base = `/o/${orgId}/projects/${projectId}`;
  const canManage = project.permissions.includes("manage");
  const tabs = [
    { href: `${base}/overview`, label: "Resumen", icon: LayoutDashboard },
    { href: `${base}/board`, label: "Tablero", icon: KanbanSquare },
    { href: `${base}/list`, label: "Lista", icon: List },
    { href: `${base}/timeline`, label: "Cronograma", icon: GanttChart },
    { href: `${base}/calendar`, label: "Calendario", icon: CalendarDays },
    ...(canManage ? [{ href: `${base}/settings`, label: "Ajustes", icon: Settings }] : []),
  ];
  const health = HEALTH[project.status];

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col">
      <div className="border-b border-line bg-surface/60 px-4 pt-5 sm:px-8">
        <nav className="mb-3 text-xs text-ink-3" aria-label="Ruta">
          <Link href={`/o/${orgId}/projects`} className="hover:text-ink">Proyectos</Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink-2">{project.name}</span>
        </nav>
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold text-white" style={{ background: project.color }}>
            {project.key.slice(0, 3)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[24px] font-bold leading-tight">{project.name}</h1>
              {project.visibility === "private" && <Lock className="h-4 w-4 text-ink-3" aria-label="Privado" />}
              <Picker
                disabled={!canManage}
                searchable={false}
                options={Object.entries(HEALTH).map(([k, v]) => ({ value: k, label: v.label, icon: <span className="h-2 w-2 rounded-full" style={{ background: v.color }} /> }))}
                value={project.status}
                onChange={(v) => updateProject.mutate({ status: v })}
                trigger={
                  <button className="chip h-6 rounded-full" style={{ background: `${health.color}18`, color: health.color }} disabled={!canManage}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: health.color }} /> {health.label}
                  </button>
                }
              />
            </div>
            {project.description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{project.description}</p>}
          </div>
          <div className="flex items-center gap-3">
            <AvatarStack users={project.members} />
            <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success("Enlace copiado"); }}>
              <Share2 className="h-4 w-4" /> <span className="hidden sm:inline">Compartir</span>
            </Button>
            {project.permissions.includes("create") && (
              <Button onClick={() => newTask({ project_id: project.id })}><Plus className="h-4 w-4" /> Crear tarea</Button>
            )}
          </div>
        </div>
        <nav className="-mb-px mt-5 flex gap-1 overflow-x-auto" aria-label="Vistas del proyecto">
          {tabs.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-[13.5px] font-medium transition-colors",
                  active ? "border-primary text-primary" : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
