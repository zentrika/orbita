import { redirect } from "next/navigation";

export default async function ProjectIndex({ params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const { orgId, projectId } = await params;
  redirect(`/o/${orgId}/projects/${projectId}/board`);
}
