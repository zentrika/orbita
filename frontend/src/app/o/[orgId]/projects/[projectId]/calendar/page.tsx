"use client";

import { CalendarView } from "@/components/views/calendar";
import { FilterBar, toQuery, useProjectFilters } from "@/components/views/filters";
import { PageLoader } from "@/components/ui/misc";
import { useAssignable, useOrgId, useProject, useProjectId, useTasks } from "@/lib/queries";

export default function CalendarPage() {
  const orgId = useOrgId();
  const projectId = useProjectId();
  const [filters] = useProjectFilters();
  const { data: project } = useProject(orgId, projectId);
  const { data: people } = useAssignable(orgId, projectId);
  const { data: tasks } = useTasks(orgId, toQuery(projectId, filters));
  if (!project || !tasks) return <PageLoader />;
  return (
    <>
      <FilterBar project={project} people={people ?? []} />
      <CalendarView orgId={orgId} project={project} tasks={tasks} />
    </>
  );
}
