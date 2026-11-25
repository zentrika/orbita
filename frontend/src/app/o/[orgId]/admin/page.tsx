"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Empty, PageLoader, Segmented } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface AdminOrg { id: number; name: string; slug: string; plan: string; members: number; projects: number; tasks: number }
interface AdminUser { id: number; email: string; full_name: string; is_active: boolean; is_platform_admin: boolean; email_verified: boolean; organizations: number }

export default function PlatformAdminPage() {
  const { me } = useAuth();
  const [tab, setTab] = useState<"orgs" | "users">("orgs");
  const [q, setQ] = useState("");
  const orgs = useQuery({ queryKey: ["admin", "orgs"], queryFn: () => api<AdminOrg[]>("/admin/organizations"), enabled: !!me?.is_platform_admin });
  const users = useQuery({ queryKey: ["admin", "users", q], queryFn: () => api<AdminUser[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`), enabled: !!me?.is_platform_admin && tab === "users" });

  if (!me?.is_platform_admin) return <Empty title="Acceso restringido" description="Sólo administradores de plataforma." />;
  if (orgs.isLoading) return <PageLoader />;

  const toggle = async (u: AdminUser, body: Partial<AdminUser>) => {
    try { await api(`/admin/users/${u.id}`, { method: "PATCH", body }); users.refetch(); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <PageHeader title="Administración de plataforma" description="Metadatos agregados. Por diseño, aquí no se muestra contenido de las empresas.">
        <div className="pb-3"><Segmented value={tab} onChange={setTab} options={[{ value: "orgs", label: "Empresas" }, { value: "users", label: "Usuarios" }]} /></div>
      </PageHeader>
      <div className="px-4 py-6 sm:px-8">
        {tab === "orgs" ? (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-[13.5px]">
              <thead><tr className="border-b border-line text-xs text-ink-2">
                <th className="px-4 py-2.5 font-medium">Empresa</th><th className="px-4 py-2.5 font-medium">Plan</th>
                <th className="px-4 py-2.5 text-right font-medium">Miembros</th><th className="px-4 py-2.5 text-right font-medium">Proyectos</th><th className="px-4 py-2.5 text-right font-medium">Tareas</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {orgs.data?.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2.5"><p className="font-medium">{o.name}</p><p className="text-xs text-ink-3">{o.slug}</p></td>
                    <td className="px-4 py-2.5 capitalize text-ink-2">{o.plan}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{o.members}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{o.projects}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{o.tasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <div className="border-b border-line p-3"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o correo" className="input max-w-xs" /></div>
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <tbody className="divide-y divide-line">
                {users.data?.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5"><p className="font-medium">{u.full_name}</p><p className="text-xs text-ink-3">{u.email}{!u.email_verified && " · sin verificar"}</p></td>
                    <td className="px-4 py-2.5 text-xs text-ink-2">{u.organizations} empresas</td>
                    <td className="px-4 py-2.5 text-xs">{u.is_platform_admin && <span className="chip bg-primary-soft text-primary">Admin plataforma</span>}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant={u.is_active ? "secondary" : "primary"} disabled={u.id === me.id} onClick={() => toggle(u, { is_active: !u.is_active })}>
                        {u.is_active ? "Suspender" : "Reactivar"}
                      </Button>
                    </td>
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
