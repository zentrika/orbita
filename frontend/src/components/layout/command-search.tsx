"use client";

import * as D from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusIcon } from "@/components/tasks/bits";
import { Kbd, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";

interface Result { tasks: Task[]; projects: { id: number; key: string; name: string; color: string }[] }

export function CommandSearch({ orgId, open, onOpenChange }: { orgId: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", orgId, debounced],
    queryFn: () => api<Result>(`/orgs/${orgId}/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  });

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[#0C111D]/40" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 animate-pop-in overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <D.Title className="sr-only">Buscar</D.Title>
          <D.Description className="sr-only">Busca tareas y proyectos</D.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="h-4 w-4 text-ink-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar tareas, claves (WEB-12) o proyectos…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
            />
            {isFetching && <Spinner className="h-4 w-4" />}
            <Kbd>Esc</Kbd>
          </div>
          <div className="scroll-thin max-h-[50vh] overflow-y-auto p-2">
            {!debounced && <p className="px-3 py-6 text-center text-sm text-ink-3">Escribe para buscar en tu organización</p>}
            {data && data.projects.length + data.tasks.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-ink-3">Sin resultados para “{debounced}”</p>
            )}
            {!!data?.projects.length && <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-ink-3">Proyectos</p>}
            {data?.projects.map((p) => (
              <button key={p.id} onClick={() => go(`/o/${orgId}/projects/${p.id}/board`)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-subtle">
                <FolderKanban className="h-4 w-4" style={{ color: p.color }} />
                <span className="flex-1">{p.name}</span>
                <span className="text-xs text-ink-3">{p.key}</span>
              </button>
            ))}
            {!!data?.tasks.length && <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-ink-3">Tareas</p>}
            {data?.tasks.map((t) => (
              <button key={t.id} onClick={() => go(`/o/${orgId}/projects/${t.project_id}/list?task=${t.id}`)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-subtle">
                <StatusIcon status={t.status} />
                <span className="w-16 shrink-0 text-xs text-ink-3">{t.key}</span>
                <span className="flex-1 truncate">{t.title}</span>
              </button>
            ))}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
