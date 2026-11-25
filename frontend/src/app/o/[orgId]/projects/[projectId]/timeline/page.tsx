"use client";

import { FilterBar, toQuery, useProjectFilters } from "@/components/views/filters";
import { TimelineView } from "@/components/views/timeline";
import { PageLoader } from "@/components/ui/misc";
import { useAssignable, useOrgId, useProject, useProjectId, useTasks } from "@/lib/queries";

export default function TimelinePage() {
  const orgId = useOrgId();
  const projectId = useProjectId();
  const [filters] = useProjectFilters();
  const { data: project } = useProject(orgId, projectId);
  const { data: people } = useAssignable(orgId, projectId);
  const { data: tasks } = useTasks(orgId, { ...toQuery(projectId, filters), top_level: true });
  if (!project || !tasks) return <PageLoader />;
  return (
    <>
      <FilterBar project={project} people={people ?? []} />
      <TimelineView orgId={orgId} project={project} tasks={tasks} />
    </>
  );
}
