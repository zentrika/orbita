"use client";

import { AlertTriangle, MessageSquare, Paperclip } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, LabelChip } from "@/components/ui/misc";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DueBadge, PriorityIcon, StatusIcon, TypeIcon } from "./bits";

export function TaskRow({ task, showProject, href }: { task: Task; showProject?: boolean; href?: string }) {
  const pathname = usePathname();
  const done = task.status?.category === "done";
  return (
    <Link
      href={href ?? `${pathname}?task=${task.id}`}
      scroll={false}
      className="group flex items-center gap-3 px-4 py-2.5 text-[13.5px] transition-colors hover:bg-muted"
    >
      <PriorityIcon priority={task.priority} />
      <span className="w-[68px] shrink-0 text-xs text-ink-3">{task.key}</span>
      <StatusIcon status={task.status} />
      <TypeIcon type={task.type} />
      <span className={cn("min-w-0 flex-1 truncate", done && "text-ink-2", task.deleted_at && "text-ink-3 line-through")}>{task.title}</span>
      {task.deleted_at && <span className="chip h-5 shrink-0 bg-blocked/10 px-1.5 text-2xs text-blocked">Eliminada</span>}
      {task.blocked && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-blocked" aria-label="Bloqueada" />}
      <span className="hidden shrink-0 items-center gap-1 md:flex">
        {task.labels.slice(0, 2).map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />)}
      </span>
      {showProject && <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">{task.project_key}</span>}
      <span className="hidden w-12 shrink-0 items-center gap-2 text-xs text-ink-3 sm:flex">
        {task.comment_count > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{task.comment_count}</span>}
        {task.attachment_count > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{task.attachment_count}</span>}
      </span>
      <span className="w-16 shrink-0 text-right"><DueBadge date={task.due_date} done={done} /></span>
      <Avatar user={task.assignee} size={22} />
    </Link>
  );
}
