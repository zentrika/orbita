"use client";

import { Lock, Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { useWorkspace } from "@/components/layout/workspace-context";
import { Button } from "@/components/ui/button";
import { AvatarStack, Empty, PageLoader, ProgressBar } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { useOrgId, useProjects } from "@/lib/queries";
import { fmtDate, HEALTH, ROLE_LABEL } from "@/lib/utils";

export default function ProjectsPage() {
  const orgId = useOrgId();
  const { data, isLoading } = useProjects(orgId);
  const { newProject } = useWorkspace();
  const { me } = useAuth();
  const canCreate = me?.organizations.find((o) => o.organization_id === orgId)?.role !== "guest";

  if (isLoading || !data) return <PageLoader />;
  return (
    <>
      <PageHeader
        title="Proyectos"
        description={`${data.length} proyectos a los que tienes acceso`}
        actions={canCreate && <Button onClick={newProject}><Plus className="h-4 w-4" /> Nuevo proyecto</Button>}
      />
      <div className="px-4 py-6 sm:px-8">
        {!data.length ? (
          <div className="card">
            <Empty
              title="Aún no hay proyectos"
              description={canCreate ? "Crea un proyecto para organizar tareas, hitos y sprints." : "Pide a un administrador que te añada a un proyecto."}
              action={canCreate && <Button onClick={newProject}>Crear proyecto</Button>}
            />
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-4 py-2.5 font-medium">Proyecto</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="w-56 px-4 py-2.5 font-medium">Progreso</th>
                  <th className="px-4 py-2.5 font-medium">Equipo</th>
                  <th className="px-4 py-2.5 font-medium">Fechas</th>
                  <th className="px-4 py-2.5 font-medium">Tu rol</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((p) => (
                  <tr key={p.id} className="hover:bg-muted">
                    <td className="px-4 py-3">
                      <Link href={`/o/${orgId}/projects/${p.id}/board`} className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: p.color }}>
                          {p.key.slice(0, 2)}
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            {p.name} {p.visibility === "private" && <Lock className="h-3 w-3 text-ink-3" aria-label="Privado" />}
                          </span>
                          <span className="block max-w-xs truncate text-xs text-ink-2">{p.description || p.key}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: HEALTH[p.status].color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEALTH[p.status].color }} />
                        {HEALTH[p.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ProgressBar value={p.progress} color={p.color} />
                        <span className="w-20 shrink-0 text-xs text-ink-2 tabular-nums">{p.done_count}/{p.task_count} · {p.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><AvatarStack users={p.members} size={24} /></td>
                    <td className="px-4 py-3 text-xs text-ink-2">
                      {p.start_date || p.end_date ? `${fmtDate(p.start_date) || "—"} → ${fmtDate(p.end_date) || "—"}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-2">{p.my_role ? ROLE_LABEL[p.my_role] : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
