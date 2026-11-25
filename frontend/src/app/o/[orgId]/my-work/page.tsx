"use client";

import { isThisWeek } from "date-fns";
import { PageHeader } from "@/components/layout/page-header";
import { TaskRow } from "@/components/tasks/task-row";
import { Empty, PageLoader } from "@/components/ui/misc";
import { useMyWork, useOrgId } from "@/lib/queries";
import type { Task } from "@/lib/types";
import { dueState, parseDate } from "@/lib/utils";

export default function MyWorkPage() {
  const orgId = useOrgId();
  const { data, isLoading } = useMyWork(orgId);
  if (isLoading || !data) return <PageLoader />;

  const thisWeek = (t: Task) => !!t.due_date && isThisWeek(parseDate(t.due_date)!, { weekStartsOn: 1 });
  const overdue = (t: Task) => dueState(t.due_date, false) === "overdue";
  const groups: { title: string; items: Task[] }[] = [
    { title: "Vencidas", items: data.filter(overdue) },
    { title: "Esta semana", items: data.filter((t) => !overdue(t) && thisWeek(t)) },
    { title: "Más adelante", items: data.filter((t) => t.due_date && !overdue(t) && !thisWeek(t)) },
    { title: "Sin fecha", items: data.filter((t) => !t.due_date) },
  ];

  return (
    <>
      <PageHeader title="Mi trabajo" description={`${data.length} tareas abiertas asignadas a ti`} />
      <div className="space-y-6 px-4 py-6 sm:px-8">
        {!data.length && (
          <div className="card">
            <Empty title="Todo al día" description="No tienes tareas abiertas asignadas." />
          </div>
        )}
        {groups.filter((g) => g.items.length).map((g) => (
          <section key={g.title} className="card overflow-hidden">
            <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold">
              {g.title} <span className="font-normal text-ink-3">{g.items.length}</span>
            </h2>
            <div className="divide-y divide-line">
              {g.items.map((t) => <TaskRow key={t.id} task={t} showProject />)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
