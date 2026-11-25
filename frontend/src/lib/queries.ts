"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api, qs } from "./api";
import type {
  EditRequest, Office, Performance, Achievement,
  Activity, Attachment, Comment, Dashboard, Goal, Invitation, Member, Milestone, Notification, Org, Project,
  ProjectDetail, RelationEdge, Sprint, Task, TaskDetail, Team, UserBrief,
} from "./types";

export function useOrgId(): number {
  const p = useParams<{ orgId: string }>();
  return Number(p.orgId);
}

export function useProjectId(): number {
  const p = useParams<{ projectId: string }>();
  return Number(p.projectId);
}

const o = (orgId: number) => `/orgs/${orgId}`;

export const useOrg = (orgId: number) =>
  useQuery({ queryKey: ["org", orgId], queryFn: () => api<Org>(o(orgId)), enabled: !!orgId });

export const useProjects = (orgId: number) =>
  useQuery({ queryKey: ["projects", orgId], queryFn: () => api<Project[]>(`${o(orgId)}/projects`) });

export const useProject = (orgId: number, projectId: number) =>
  useQuery({
    queryKey: ["project", orgId, projectId],
    queryFn: () => api<ProjectDetail>(`${o(orgId)}/projects/${projectId}`),
    enabled: !!projectId,
  });

export const useMembers = (orgId: number) =>
  useQuery({ queryKey: ["members", orgId], queryFn: () => api<Member[]>(`${o(orgId)}/members`), staleTime: 60_000 });

export const useAssignable = (orgId: number, projectId: number | undefined) =>
  useQuery({
    queryKey: ["assignable", orgId, projectId],
    queryFn: () => api<UserBrief[]>(`${o(orgId)}/projects/${projectId}/assignable`),
    enabled: !!projectId,
    staleTime: 60_000,
  });

export type TaskFilters = Record<string, string | number | boolean | undefined | null>;

export const useTasks = (orgId: number, filters: TaskFilters, enabled = true) =>
  useQuery({
    queryKey: ["tasks", orgId, filters],
    queryFn: () => api<Task[]>(`${o(orgId)}/tasks${qs(filters)}`),
    enabled,
    placeholderData: (prev) => prev,
  });

export const useTask = (orgId: number, taskId: number | null) =>
  useQuery({
    queryKey: ["task", orgId, taskId],
    queryFn: () => api<TaskDetail>(`${o(orgId)}/tasks/${taskId}`),
    enabled: !!taskId,
  });

export const useComments = (orgId: number, taskId: number) =>
  useQuery({ queryKey: ["comments", orgId, taskId], queryFn: () => api<Comment[]>(`${o(orgId)}/tasks/${taskId}/comments`) });

export const useAttachments = (orgId: number, taskId: number) =>
  useQuery({
    queryKey: ["attachments", orgId, taskId],
    queryFn: () => api<Attachment[]>(`${o(orgId)}/tasks/${taskId}/attachments`),
  });

export const useTaskActivity = (orgId: number, taskId: number, enabled: boolean) =>
  useQuery({
    queryKey: ["task-activity", orgId, taskId],
    queryFn: () => api<Activity[]>(`${o(orgId)}/tasks/${taskId}/activity`),
    enabled,
  });

export const useRelations = (orgId: number, projectId: number) =>
  useQuery({
    queryKey: ["relations", orgId, projectId],
    queryFn: () => api<RelationEdge[]>(`${o(orgId)}/relations?project_id=${projectId}`),
  });

export const useDashboard = (orgId: number, projectId?: number) =>
  useQuery({
    queryKey: ["dashboard", orgId, projectId ?? null],
    queryFn: () => api<Dashboard>(`${o(orgId)}/dashboard${qs({ project_id: projectId })}`),
  });

export const useNotifications = (orgId: number) =>
  useQuery({
    queryKey: ["notifications", orgId],
    queryFn: () => api<{ items: Notification[]; unread: number }>(`${o(orgId)}/notifications`),
    refetchInterval: 120_000,
  });

export const useMyWork = (orgId: number) =>
  useQuery({ queryKey: ["my-work", orgId], queryFn: () => api<Task[]>(`${o(orgId)}/my-work`) });

export const useTeams = (orgId: number) =>
  useQuery({ queryKey: ["teams", orgId], queryFn: () => api<Team[]>(`${o(orgId)}/teams`) });

export const useInvitations = (orgId: number, enabled: boolean) =>
  useQuery({ queryKey: ["invitations", orgId], queryFn: () => api<Invitation[]>(`${o(orgId)}/invitations`), enabled });

export const useMilestones = (orgId: number, projectId: number) =>
  useQuery({
    queryKey: ["project", orgId, projectId, "milestones"],
    queryFn: () => api<Milestone[]>(`${o(orgId)}/projects/${projectId}/milestones`),
  });

export const useSprints = (orgId: number, projectId: number) =>
  useQuery({
    queryKey: ["project", orgId, projectId, "sprints"],
    queryFn: () => api<Sprint[]>(`${o(orgId)}/projects/${projectId}/sprints`),
  });

export const useGoals = (orgId: number, projectId: number) =>
  useQuery({
    queryKey: ["project", orgId, projectId, "goals"],
    queryFn: () => api<Goal[]>(`${o(orgId)}/projects/${projectId}/goals`),
  });

export const useProjectActivity = (orgId: number, projectId: number) =>
  useQuery({
    queryKey: ["project", orgId, projectId, "activity"],
    queryFn: () => api<Activity[]>(`${o(orgId)}/projects/${projectId}/activity?limit=30`),
  });

/** Invalida todo lo que depende de tareas. */
export function useInvalidateTasks(orgId: number) {
  const qc = useQueryClient();
  return (taskId?: number) => {
    qc.invalidateQueries({ queryKey: ["tasks", orgId] });
    qc.invalidateQueries({ queryKey: ["dashboard", orgId] });
    qc.invalidateQueries({ queryKey: ["my-work", orgId] });
    qc.invalidateQueries({ queryKey: ["projects", orgId] });
    qc.invalidateQueries({ queryKey: ["relations", orgId] });
    if (taskId) {
      qc.invalidateQueries({ queryKey: ["task", orgId, taskId] });
      qc.invalidateQueries({ queryKey: ["task-activity", orgId, taskId] });
    }
  };
}

/** Actualización de tarea con actualización optimista en las listas en caché. */
export function useUpdateTask(orgId: number) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTasks(orgId);
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      api<TaskDetail>(`${o(orgId)}/tasks/${id}`, { method: "PATCH", body: data }),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ["tasks", orgId] });
      const snapshot = qc.getQueriesData<Task[]>({ queryKey: ["tasks", orgId] });
      const simple = Object.fromEntries(Object.entries(data).filter(([k]) => !["label_ids", "assignee_id", "status_id"].includes(k)));
      qc.setQueriesData<Task[]>({ queryKey: ["tasks", orgId] }, (old) =>
        old?.map((t) => (t.id === id ? { ...t, ...simple } : t)),
      );
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      ctx?.snapshot.forEach(([key, value]) => qc.setQueryData<Task[] | undefined>(key, value));
      toast.error((err as Error).message);
    },
    onSuccess: (task) => {
      qc.setQueryData(["task", orgId, task.id], task);
    },
    onSettled: (_d, _e, v) => invalidate(v.id),
  });
}

export function useMoveTask(orgId: number) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTasks(orgId);
  return useMutation({
    mutationFn: ({ id, status_id, position }: { id: number; status_id: number; position: number }) =>
      api<Task>(`${o(orgId)}/tasks/${id}/move`, { method: "POST", body: { status_id, position } }),
    onError: (err) => toast.error((err as Error).message),
    onSettled: (_d, _e, v) => {
      invalidate(v.id);
      qc.invalidateQueries({ queryKey: ["task", orgId, v.id] });
    },
  });
}

export function useUpdateProject(orgId: number, projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api<ProjectDetail>(`${o(orgId)}/projects/${projectId}`, { method: "PATCH", body: data }),
    onSuccess: (p) => {
      qc.setQueryData(["project", orgId, projectId], p);
      qc.invalidateQueries({ queryKey: ["projects", orgId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
}


export const useOffice = (orgId: number) =>
  useQuery({ queryKey: ["office", orgId], queryFn: () => api<Office>(`${o(orgId)}/office`), refetchInterval: 60_000 });

export const useEditRequests = (orgId: number, scope: "inbox" | "mine" | "all", enabled = true) =>
  useQuery({
    queryKey: ["edit-requests", orgId, scope],
    queryFn: () => api<EditRequest[]>(`${o(orgId)}/comment-edit-requests?scope=${scope}`),
    enabled,
  });

export const usePendingApprovals = (orgId: number) =>
  useQuery({
    queryKey: ["edit-requests", orgId, "count"],
    queryFn: () => api<{ pending: number }>(`${o(orgId)}/comment-edit-requests/count`),
    refetchInterval: 120_000,
  });

export const usePerformance = (orgId: number, userId: number | null) =>
  useQuery({
    queryKey: ["performance", orgId, userId],
    queryFn: () => api<Performance>(`${o(orgId)}/users/${userId}/performance`),
    enabled: !!userId,
    retry: false,
  });

export const useAchievements = (orgId: number, filters: { team_id?: number; project_id?: number }, enabled: boolean) =>
  useQuery({
    queryKey: ["achievements", orgId, filters],
    queryFn: () => api<Achievement[]>(`${o(orgId)}/achievements${qs(filters)}`),
    enabled,
  });
