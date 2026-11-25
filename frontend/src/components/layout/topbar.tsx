"use client";

import { Bell, Menu as MenuIcon, Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/misc";
import { useNotifications } from "@/lib/queries";
import type { RealtimeStatus } from "@/lib/realtime";
import { cn } from "@/lib/utils";

export function Topbar({ orgId, rt, onMenu, onSearch, onNewTask, canCreate }: {
  orgId: number; rt: RealtimeStatus; onMenu: () => void; onSearch: () => void; onNewTask: () => void; canCreate: boolean;
}) {
  const { data: notes } = useNotifications(orgId);
  const { theme, setTheme } = useTheme();
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Abrir menú">
        <MenuIcon className="h-5 w-5" />
      </Button>
      <button
        onClick={onSearch}
        className="flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink-3 shadow-xs transition-colors hover:border-line-strong"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 truncate text-left">Buscar proyectos, tareas…</span>
        <span className="hidden sm:inline"><Kbd>⌘ K</Kbd></span>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <span
          className="mr-2 hidden items-center gap-1.5 text-xs text-ink-3 md:flex"
          title={rt === "online" ? "Actualizaciones en tiempo real activas" : "Reconectando…"}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", rt === "online" ? "bg-done" : rt === "connecting" ? "bg-risk" : "bg-ink-3")} />
          {rt === "online" ? "En vivo" : "Sin conexión"}
        </span>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Tema"><ThemeIcon className="h-[18px] w-[18px]" /></Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Sun />} onSelect={() => setTheme("light")}>Claro</MenuItem>
            <MenuItem icon={<Moon />} onSelect={() => setTheme("dark")}>Oscuro</MenuItem>
            <MenuItem icon={<Monitor />} onSelect={() => setTheme("system")}>Sistema</MenuItem>
          </MenuContent>
        </Menu>
        <Link
          href={`/o/${orgId}/inbox`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-subtle hover:text-ink"
          aria-label={`Notificaciones${notes?.unread ? `, ${notes.unread} sin leer` : ""}`}
        >
          <Bell className="h-[18px] w-[18px]" />
          {!!notes?.unread && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blocked ring-2 ring-bg" />}
        </Link>
        {canCreate && (
          <Button onClick={onNewTask} className="ml-1">
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nueva tarea</span>
          </Button>
        )}
      </div>
    </header>
  );
}
