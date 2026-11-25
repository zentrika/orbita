"use client";

import { useState } from "react";
import { FilterBar, toQuery, useProjectFilters } from "@/components/views/filters";
import { ListView } from "@/components/views/list";
import { PageLoader, Segmented } from "@/components/ui/misc";
import { useAssignable, useOrgId, useProject, useProjectId, useTasks } from "@/lib/queries";

export default function ListPage() {
  const orgId = useOrgId();
  const projectId = useProjectId();
  const [filters] = useProjectFilters();
  const [groupBy, setGroupBy] = useState<"status" | "none">("status");
  const { data: project } = useProject(orgId, projectId);
  const { data: people } = useAssignable(orgId, projectId);
  const { data: tasks } = useTasks(orgId, toQuery(projectId, filters));
  if (!project || !tasks) return <PageLoader />;
  return (
    <>
      <FilterBar
        project={project}
        people={people ?? []}
        extra={<Segmented value={groupBy} onChange={setGroupBy} options={[{ value: "status", label: "Por estado" }, { value: "none", label: "Sin agrupar" }]} />}
      />
      <ListView orgId={orgId} project={project} tasks={tasks} groupBy={groupBy} />
    </>
  );
}
