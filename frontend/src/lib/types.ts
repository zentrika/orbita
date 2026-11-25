export type OrgRole = "owner" | "admin" | "pmo" | "member" | "guest";
export type ProjectRole = "manager" | "member" | "guest";
export type StatusCategory = "todo" | "in_progress" | "review" | "done" | "blocked";
export type TaskType = "task" | "bug" | "story" | "incident" | "ticket";
export type Priority = "none" | "low" | "medium" | "high" | "urgent";
export type RelationType = "blocks" | "depends_on" | "duplicates" | "relates_to";
export type Action = "view" | "create" | "edit" | "comment" | "attach" | "manage" | "delete";

export interface UserBrief {
  id: number;
  full_name: string;
  email: string;
  avatar_color: string;
}

export interface Me extends UserBrief {
  is_platform_admin: boolean;
  email_verified: boolean;
  created_at: string;
  organizations: { organization_id: number; name: string; slug: string; role: OrgRole }[];
}

export interface Org {
  id: number;
  name: string;
  slug: string;
  plan: string;
  timezone: string;
  workdays: string;
  wip_limit: number;
  created_at: string;
  my_role: OrgRole;
}

export interface Member {
  user: UserBrief;
  role: OrgRole;
  title: string;
  joined_at: string;
}

export interface Invitation {
  id: number;
  email: string;
  role: OrgRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  invite_url?: string | null;
}

export interface Team {
  id: number;
  name: string;
  description: string;
  color: string;
  is_qa: boolean;
  lead: UserBrief | null;
  members: UserBrief[];
}

export interface TeamBrief {
  id: number;
  name: string;
  color: string;
  is_qa: boolean;
}

export interface Status {
  id: number;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
}

export interface Label {
  id: number;
  name: string;
  color: string;
}

export interface Project {
  id: number;
  key: string;
  name: string;
  description: string;
  scope: string;
  color: string;
  status: "on_track" | "at_risk" | "off_track" | "done";
  visibility: "organization" | "private";
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  my_role: ProjectRole | null;
  permissions: Action[];
  task_count: number;
  done_count: number;
  progress: number;
  members: UserBrief[];
  teams: TeamBrief[];
}

export interface ProjectDetail extends Project {
  statuses: Status[];
  labels: Label[];
}

export interface Milestone {
  id: number;
  name: string;
  description: string;
  due_date: string | null;
  status: "open" | "done";
  task_count: number;
  done_count: number;
}

export interface Sprint {
  id: number;
  name: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  state: "planned" | "active" | "closed";
  task_count: number;
  done_count: number;
}

export interface Goal {
  id: number;
  title: string;
  description: string;
  target_date: string | null;
  progress: number;
  owner_id: number | null;
}

export interface Task {
  id: number;
  project_id: number;
  project_key: string;
  key: string;
  number: number;
  type: TaskType;
  title: string;
  status_id: number;
  status: Status | null;
  priority: Priority;
  assignee: UserBrief | null;
  reporter: UserBrief | null;
  parent_id: number | null;
  milestone_id: number | null;
  sprint_id: number | null;
  start_date: string | null;
  due_date: string | null;
  estimate_minutes: number | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  team_id: number | null;
  team: TeamBrief | null;
  deleted_at: string | null;
  labels: Label[];
  subtask_count: number;
  subtask_done: number;
  comment_count: number;
  attachment_count: number;
  checklist_total: number;
  checklist_done: number;
  blocked: boolean;
}

export interface RelatedTask {
  id: number;
  key: string;
  title: string;
  status: Status | null;
}

export interface Relation {
  id: number;
  type: RelationType;
  direction: "outgoing" | "incoming";
  label: string;
  task: RelatedTask;
}

export interface ChecklistItem {
  id: number;
  text: string;
  done: boolean;
  position: number;
}

export interface TaskDetail extends Task {
  description: string;
  watchers: UserBrief[];
  subtasks: Task[];
  checklist: ChecklistItem[];
  relations: Relation[];
  time_spent_minutes: number;
  parent: RelatedTask | null;
  my_role: ProjectRole | null;
  permissions: Action[];
  capabilities: TaskCapability[];
  in_qa: boolean;
}

export type TaskCapability = "view" | "comment" | "attach" | "edit" | "status" | "assign" | "transfer" | "delete" | "qa";

export interface Comment {
  id: number;
  body: string;
  author: UserBrief | null;
  parent_id: number | null;
  version: number;
  created_at: string;
  edited_at: string | null;
  can_delete: boolean;
  can_request_edit: boolean;
  edit_pending: boolean;
  attachments: { id: number; filename: string; content_type: string; size: number }[];
}

export interface EditRequest {
  id: number;
  organization_id: number;
  project: { id: number; key: string; name: string };
  team: TeamBrief | null;
  task: { id: number; key: string; title: string; project_id: number };
  comment_id: number;
  original_body: string;
  proposed_body: string;
  reason: string;
  requester: UserBrief | null;
  approver: UserBrief | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_by: UserBrief | null;
  decided_at: string | null;
  decision_note: string;
  can_decide: boolean;
}

export interface EligibleAssignee {
  user: UserBrief;
  pending: number;
  in_progress: number;
  capacity: number;
  at_capacity: boolean;
  is_lead: boolean;
}

export interface AssignmentHistory {
  id: number;
  from_user: UserBrief | null;
  to_user: UserBrief | null;
  changed_by: UserBrief | null;
  team: TeamBrief | null;
  reason: string;
  created_at: string;
}

export interface TeamTransfer {
  id: number;
  from_team: TeamBrief | null;
  to_team: TeamBrief | null;
  transferred_by: UserBrief | null;
  reason: string;
  created_at: string;
}

export interface Cycle {
  id: number;
  number: number;
  status: "in_qa" | "accepted" | "rejected" | "revoked";
  submitted_by: UserBrief | null;
  submitted_at: string;
  submission_note: string;
  reviewed_by: UserBrief | null;
  reviewed_at: string | null;
  review_note: string;
}

export interface OfficeMember {
  user: UserBrief;
  online: boolean;
  last_seen: number | null;
  is_lead: boolean;
  pending: number;
  in_progress: number;
  capacity: number;
  active_tasks: { id: number; key: string; title: string; project_id: number; priority: Priority }[];
}

export interface OfficeTeam {
  id: number;
  name: string;
  color: string;
  is_qa: boolean;
  lead: UserBrief | null;
  members: OfficeMember[];
  online: number;
  pending: number;
  in_progress: number;
}

export interface Office {
  wip_limit: number;
  teams: OfficeTeam[];
  unassigned_online: UserBrief[];
}

export interface Achievement {
  id: number;
  code: string;
  name: string;
  description: string;
  kind: "resolution" | "validation" | "streak";
  status: "active" | "revoked";
  awarded_at: string;
  revoked_at: string | null;
  revoke_reason: string;
  evidence: Record<string, unknown> | null;
  user: UserBrief;
  project: { id: number; key: string; name: string } | null;
  task: { id: number; key: string; title: string } | null;
  team: { id: number; name: string; color: string } | null;
}

export interface Performance {
  user: UserBrief;
  resolutions: number;
  validations: number;
  contributions: number;
  contributions_by_kind: Record<string, number>;
  current_streak: number;
  best_streak: number;
  last_contribution_day: string | null;
  achievements: Achievement[];
}

export interface Attachment {
  comment_id: number | null;
  id: number;
  filename: string;
  content_type: string;
  size: number;
  uploader: UserBrief | null;
  created_at: string;
}

export interface TimeEntry {
  id: number;
  minutes: number;
  note: string;
  spent_on: string;
  user: UserBrief | null;
  created_at: string;
}

export interface Activity {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  task_id: number | null;
  task_key: string | null;
  changes: Record<string, unknown> | null;
  actor: UserBrief | null;
  created_at: string;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  task_id: number | null;
  project_id: number | null;
  read_at: string | null;
  created_at: string;
  actor: UserBrief | null;
}

export interface Dashboard {
  open_tasks: number;
  overdue_tasks: number;
  due_this_week: number;
  completed_last_7_days: number;
  in_review: number;
  blocked: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  workload: { user: UserBrief | null; open: number; overdue: number; estimate_minutes: number }[];
  projects: {
    id: number; key: string; name: string; color: string; status: string;
    total: number; done: number; overdue: number; progress: number;
  }[];
  my_open: Task[];
  recent_activity: Activity[];
}

export interface RelationEdge {
  id: number;
  source_task_id: number;
  target_task_id: number;
  type: RelationType;
}
