"use client";

import { Building2, ChevronsUpDown, FolderKanban, Gauge, Home, Inbox, LayoutGrid, Plus, Settings, Shield, SquareCheck, StickyNote, Trophy, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { useMyWork, useNotifications, usePendingApprovals, useProjects } from "@/lib/queries";
import { cn, ROLE_LABEL } from "@/lib/utils";
import { Logo } from "./logo";

function NavItem({ href, icon: Icon, label, count, active, onNavigate }: {
  href: string; icon: typeof Home; label: string; count?: number; active: boolean; onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors",
        active ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white",
      )}
    >
      <Icon className={cn("h-[17px] w-[17px]", active ? "text-white" : "text-white/50 group-hover:text-white/80")} aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {!!count && (
        <span className="min-w-5 rounded-md bg-white/10 px-1.5 py-px text-center text-2xs font-semibold text-white/80">{count}</span>
      )}
    </Link>
  );
}

export function Sidebar({ orgId, onNavigate, onClose, onNewProject }: {
  orgId: number; onNavigate?: () => void; onClose?: () => void; onNewProject: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, logout } = useAuth();
  const { data: projects } = useProjects(orgId);
  const { data: notes } = useNotifications(orgId);
  const { data: mine } = useMyWork(orgId);
  const { data: approvals } = usePendingApprovals(orgId);
  const base = `/o/${orgId}`;
  const org = me?.organizations.find((o) => o.organization_id === orgId);
  const canCreate = org && org.role !== "guest";
  const isAdmin = org && ["owner", "admin"].includes(org.role);
  const isManager = org && ["owner", "admin", "pmo"].includes(org.role);

  const switchOrg = (id: number) => {
    try {
      localStorage.setItem("orbita-org", String(id));
    } catch {
      /* sin almacenamiento */
    }
    router.push(`/o/${id}`);
  };

  return (
    <nav className="flex h-full w-[248px] flex-col bg-night px-3 pb-3 pt-4 text-white" aria-label="Navegación principal">
      <div className="mb-4 flex items-center justify-between px-1.5">
        <Logo light />
        {onClose && (
          <button onClick={onClose} className="rounded-md p-1 text-white/60 hover:bg-white/10 lg:hidden" aria-label="Cerrar menú">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Menu>
        <MenuTrigger className="mb-4 flex w-full items-center gap-2.5 rounded-lg border border-white/10 px-2.5 py-2 text-left hover:bg-white/[0.04]">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold">
            {org?.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{org?.name}</span>
            <span className="block text-2xs text-white/50">{org ? ROLE_LABEL[org.role] : ""}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-white/40" />
        </MenuTrigger>
        <MenuContent align="start" className="w-[224px]">
          <MenuLabel>Organizaciones</MenuLabel>
          {me?.organizations.map((o) => (
            <MenuItem key={o.organization_id} onSelect={() => switchOrg(o.organization_id)}>
              <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-2xs font-bold text-primary">{o.name[0]}</span>
              <span className="flex-1 truncate">{o.name}</span>
              {o.organization_id === orgId && <span className="text-2xs text-ink-3">Actual</span>}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={<Plus />} onSelect={() => router.push("/onboarding")}>Nueva organización</MenuItem>
        </MenuContent>
      </Menu>

      <div className="space-y-0.5">
        <NavItem href={base} icon={Home} label="Inicio" active={pathname === base} onNavigate={onNavigate} />
        <NavItem href={`${base}/my-work`} icon={SquareCheck} label="Mi trabajo" count={mine?.length} active={pathname.startsWith(`${base}/my-work`)} onNavigate={onNavigate} />
        <NavItem href={`${base}/inbox`} icon={Inbox} label="Bandeja" count={notes?.unread} active={pathname.startsWith(`${base}/inbox`)} onNavigate={onNavigate} />
        <NavItem href={`${base}/approvals`} icon={Gauge} label="Aprobaciones" count={approvals?.pending} active={pathname.startsWith(`${base}/approvals`)} onNavigate={onNavigate} />
      </div>

      <div className="my-4 h-px bg-white/[0.08]" />

      <div className="space-y-0.5">
        <NavItem href={`${base}/office`} icon={Building2} label="Oficina virtual" active={pathname.startsWith(`${base}/office`)} onNavigate={onNavigate} />
        {isManager && <NavItem href={`${base}/operations`} icon={StickyNote} label="Operaciones" active={pathname.startsWith(`${base}/operations`)} onNavigate={onNavigate} />}
        <NavItem href={`${base}/performance`} icon={Trophy} label="Rendimiento" active={pathname.startsWith(`${base}/performance`)} onNavigate={onNavigate} />
      </div>

      <div className="my-4 h-px bg-white/[0.08]" />

      <div className="space-y-0.5">
        <NavItem href={`${base}/projects`} icon={LayoutGrid} label="Proyectos" active={pathname === `${base}/projects`} onNavigate={onNavigate} />
        <NavItem href={`${base}/team`} icon={Users} label="Equipo" active={pathname.startsWith(`${base}/team`)} onNavigate={onNavigate} />
        <NavItem href={`${base}/settings`} icon={Settings} label="Ajustes" active={pathname.startsWith(`${base}/settings`)} onNavigate={onNavigate} />
        {me?.is_platform_admin && (
          <NavItem href={`${base}/admin`} icon={Shield} label="Plataforma" active={pathname.startsWith(`${base}/admin`)} onNavigate={onNavigate} />
        )}
      </div>

      <div className="mt-5 flex items-center justify-between px-2.5">
        <span className="text-2xs font-semibold uppercase tracking-wider text-white/40">Proyectos</span>
        {canCreate && (
          <button onClick={onNewProject} className="rounded p-0.5 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Nuevo proyecto">
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="scroll-thin mt-1.5 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {projects?.map((p) => {
          const href = `${base}/projects/${p.id}`;
          const active = pathname.startsWith(href);
          return (
            <Link
              key={p.id}
              href={`${href}/board`}
              onClick={onNavigate}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
                active ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white",
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
              <span className="truncate">{p.name}</span>
            </Link>
          );
        })}
        {projects?.length === 0 && (
          <p className="px-2.5 py-1 text-xs text-white/40">
            <FolderKanban className="mb-1 h-4 w-4" />
            Aún no hay proyectos
          </p>
        )}
      </div>

      <Menu>
        <MenuTrigger className="mt-3 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/[0.05]">
          <Avatar user={me} size={30} className="ring-night" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{me?.full_name}</span>
            <span className="block truncate text-2xs text-white/50">{me?.email}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-white/40" />
        </MenuTrigger>
        <MenuContent align="start" className="w-[224px]">
          <MenuItem icon={<Settings />} onSelect={() => router.push(`${base}/settings?tab=account`)}>Mi cuenta</MenuItem>
          {isAdmin && <MenuItem icon={<Users />} onSelect={() => router.push(`${base}/team`)}>Invitar personas</MenuItem>}
          <MenuSeparator />
          <MenuItem onSelect={logout} danger>Cerrar sesión</MenuItem>
        </MenuContent>
      </Menu>
    </nav>
  );
}
