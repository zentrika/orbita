"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { CommandSearch } from "@/components/layout/command-search";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { NewProjectDialog, NewTaskDialog } from "@/components/tasks/new-dialogs";
import { TaskPanelHost } from "@/components/tasks/task-panel";
import { PageLoader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRealtime } from "@/lib/realtime";

import { WorkspaceCtx, type TaskDefaults as Defaults } from "@/components/layout/workspace-context";

function Shell({ orgId, children }: { orgId: number; children: React.ReactNode }) {
  const { me } = useAuth();
  const rt = useRealtime(orgId);
  const [nav, setNav] = useState(false);
  const [search, setSearch] = useState(false);
  const [taskDlg, setTaskDlg] = useState<{ open: boolean; defaults?: Defaults }>({ open: false });
  const [projectDlg, setProjectDlg] = useState(false);
  const role = me?.organizations.find((o) => o.organization_id === orgId)?.role;

  useEffect(() => {
    try {
      localStorage.setItem("orbita-org", String(orgId));
    } catch {
      /* sin almacenamiento */
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orgId]);

  const ctx = { newTask: (d?: Defaults) => setTaskDlg({ open: true, defaults: d }), newProject: () => setProjectDlg(true) };

  return (
    <WorkspaceCtx.Provider value={ctx}>
      <div className="flex h-full">
        <div className="hidden lg:block">
          <div className="fixed inset-y-0 left-0"><Sidebar orgId={orgId} onNewProject={() => setProjectDlg(true)} /></div>
          <div className="w-[248px]" />
        </div>
        {nav && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-[#0C111D]/50" onClick={() => setNav(false)} />
            <div className="absolute inset-y-0 left-0 animate-slide-in shadow-lg">
              <Sidebar orgId={orgId} onNavigate={() => setNav(false)} onClose={() => setNav(false)} onNewProject={() => { setNav(false); setProjectDlg(true); }} />
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar orgId={orgId} rt={rt} onMenu={() => setNav(true)} onSearch={() => setSearch(true)} onNewTask={() => ctx.newTask()} canCreate={role !== "guest"} />
          {me && !me.email_verified && (
            <div className="flex flex-wrap items-center gap-2 border-b border-risk/20 bg-risk/[0.07] px-6 py-2 text-[13px] text-[#B54708] dark:text-risk">
              Confirma tu correo {me.email} para asegurar tu cuenta.
              <button
                className="font-medium underline underline-offset-2"
                onClick={() => api("/auth/resend-verification", { method: "POST" }).then(() => toast.success("Te enviamos un nuevo enlace")).catch((e) => toast.error(e.message))}
              >
                Reenviar enlace
              </button>
            </div>
          )}
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
      <CommandSearch orgId={orgId} open={search} onOpenChange={setSearch} />
      <NewTaskDialog orgId={orgId} open={taskDlg.open} defaults={taskDlg.defaults} onOpenChange={(o) => setTaskDlg((s) => ({ ...s, open: o }))} />
      <NewProjectDialog orgId={orgId} open={projectDlg} onOpenChange={setProjectDlg} />
      <Suspense>
        <TaskPanelHost orgId={orgId} />
      </Suspense>
    </WorkspaceCtx.Provider>
  );
}

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const { me, loading } = useAuth();
  const router = useRouter();
  const id = Number(orgId);
  const member = me?.organizations.some((o) => o.organization_id === id);

  useEffect(() => {
    if (loading) return;
    if (!me) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    else if (!member) router.replace("/");
  }, [loading, me, member, router]);

  if (loading || !me || !member) return <PageLoader />;
  return <Shell orgId={id}>{children}</Shell>;
}
