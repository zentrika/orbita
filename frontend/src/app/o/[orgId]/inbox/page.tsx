"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, CheckCheck, Clock, MessageSquare, RefreshCw, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, Empty, PageLoader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useNotifications, useOrgId } from "@/lib/queries";
import type { Notification } from "@/lib/types";
import { cn, fmtRelative } from "@/lib/utils";

const ICON: Record<string, typeof Bell> = {
  mentioned: AtSign, commented: MessageSquare, assigned: UserPlus, due_soon: Clock, status_changed: RefreshCw,
};

export default function InboxPage() {
  const orgId = useOrgId();
  const { data, isLoading } = useNotifications(orgId);
  const qc = useQueryClient();
  const router = useRouter();
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications", orgId] });

  const open = async (n: Notification) => {
    if (!n.read_at) api(`/orgs/${orgId}/notifications/${n.id}/read`, { method: "POST" }).then(refresh);
    if (n.task_id && n.project_id) router.push(`/o/${orgId}/projects/${n.project_id}/board?task=${n.task_id}`);
  };

  if (isLoading || !data) return <PageLoader />;
  return (
    <>
      <PageHeader
        title="Bandeja"
        description={data.unread ? `${data.unread} sin leer` : "Estás al día"}
        actions={data.unread > 0 && (
          <Button variant="secondary" onClick={() => api(`/orgs/${orgId}/notifications/read-all`, { method: "POST" }).then(refresh)}>
            <CheckCheck className="h-4 w-4" /> Marcar todo como leído
          </Button>
        )}
      />
      <div className="px-4 py-6 sm:px-8">
        <div className="card overflow-hidden">
          {!data.items.length && <Empty title="Sin notificaciones" description="Te avisaremos de menciones, asignaciones y vencimientos." />}
          <ul className="divide-y divide-line">
            {data.items.map((n) => {
              const Icon = ICON[n.type] ?? Bell;
              return (
                <li key={n.id}>
                  <button onClick={() => open(n)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted", !n.read_at && "bg-primary-soft/40")}>
                    <span className="relative mt-0.5">
                      {n.actor ? (
                        <Avatar user={n.actor} size={28} />
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-risk/10 text-risk"><Icon className="h-3.5 w-3.5" /></span>
                      )}
                      {n.actor && (
                        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface ring-1 ring-line">
                          <Icon className="h-2.5 w-2.5 text-ink-2" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[13.5px]", !n.read_at && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="block truncate text-[13px] text-ink-2">{n.body}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">{fmtRelative(n.created_at)}</span>
                    {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Sin leer" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
