from app.schemas.common import (
    ORM,
    BaseModel,
    Field,
    Priority,
    RelationType,
    Str,
    TaskType,
    UserBrief,
    date,
    datetime,
)
from app.schemas.project import LabelOut, StatusOut


class TaskCreate(BaseModel):
    project_id: int
    title: Str = Field(min_length=1, max_length=255)
    type: TaskType = "task"
    description: str = Field(default="", max_length=100_000)
    status_id: int | None = None
    priority: Priority = "none"
    assignee_id: int | None = None
    parent_id: int | None = None
    milestone_id: int | None = None
    sprint_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimate_minutes: int | None = Field(default=None, ge=0, le=100_000)
    label_ids: list[int] = []
    watcher_ids: list[int] = []
    team_id: int | None = None


class TaskUpdate(BaseModel):
    title: Str | None = Field(default=None, min_length=1, max_length=255)
    type: TaskType | None = None
    description: str | None = Field(default=None, max_length=100_000)
    status_id: int | None = None
    priority: Priority | None = None
    assignee_id: int | None = None
    parent_id: int | None = None
    milestone_id: int | None = None
    sprint_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimate_minutes: int | None = Field(default=None, ge=0, le=100_000)
    label_ids: list[int] | None = None


class TaskMove(BaseModel):
    status_id: int
    position: float


class TeamBrief(ORM):
    id: int
    name: str
    color: str
    is_qa: bool = False


class AssignIn(BaseModel):
    assignee_id: int | None
    reason: Str = Field(default="", max_length=500)


class TransferIn(BaseModel):
    team_id: int
    reason: Str = Field(min_length=3, max_length=500)


class SubmitQAIn(BaseModel):
    note: Str = Field(min_length=10, max_length=1000)


class QAReviewIn(BaseModel):
    approve: bool
    evidence: Str = Field(min_length=10, max_length=1000)


class EligibleAssignee(BaseModel):
    user: UserBrief
    pending: int
    in_progress: int
    capacity: int
    at_capacity: bool
    is_lead: bool


class AssignmentHistoryOut(BaseModel):
    id: int
    from_user: UserBrief | None
    to_user: UserBrief | None
    changed_by: UserBrief | None
    team: TeamBrief | None
    reason: str
    created_at: datetime


class TransferOut(BaseModel):
    id: int
    from_team: TeamBrief | None
    to_team: TeamBrief | None
    transferred_by: UserBrief | None
    reason: str
    created_at: datetime


class CycleOut(BaseModel):
    id: int
    number: int
    status: str
    submitted_by: UserBrief | None
    submitted_at: datetime
    submission_note: str
    reviewed_by: UserBrief | None
    reviewed_at: datetime | None
    review_note: str


class TaskOut(ORM):
    id: int
    project_id: int
    project_key: str = ""
    key: str = ""
    number: int
    type: str
    title: str
    status_id: int
    status: StatusOut | None = None
    priority: str
    assignee: UserBrief | None = None
    reporter: UserBrief | None = None
    parent_id: int | None
    milestone_id: int | None
    sprint_id: int | None
    start_date: date | None
    due_date: date | None
    estimate_minutes: int | None
    position: float
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    team_id: int | None = None
    team: TeamBrief | None = None
    deleted_at: datetime | None = None
    labels: list[LabelOut] = []
    subtask_count: int = 0
    subtask_done: int = 0
    comment_count: int = 0
    attachment_count: int = 0
    checklist_total: int = 0
    checklist_done: int = 0
    blocked: bool = False


class ChecklistItemOut(ORM):
    id: int
    text: str
    done: bool
    position: int


class ChecklistIn(BaseModel):
    text: Str = Field(min_length=1, max_length=255)


class ChecklistUpdate(BaseModel):
    text: Str | None = Field(default=None, min_length=1, max_length=255)
    done: bool | None = None
    position: int | None = None


class RelatedTask(BaseModel):
    id: int
    key: str
    title: str
    status: StatusOut | None


class RelationIn(BaseModel):
    target_task_id: int
    type: RelationType


class RelationOut(BaseModel):
    id: int
    type: str
    direction: str  # outgoing | incoming
    label: str
    task: RelatedTask


class TimeEntryIn(BaseModel):
    minutes: int = Field(ge=1, le=24 * 60)
    note: Str = Field(default="", max_length=255)
    spent_on: date | None = None


class TimeEntryOut(BaseModel):
    id: int
    minutes: int
    note: str
    spent_on: date
    user: UserBrief | None
    created_at: datetime


class TaskDetail(TaskOut):
    description: str
    watchers: list[UserBrief] = []
    subtasks: list[TaskOut] = []
    checklist: list[ChecklistItemOut] = []
    relations: list[RelationOut] = []
    time_spent_minutes: int = 0
    parent: RelatedTask | None = None
    my_role: str | None = None
    permissions: list[str] = []
    capabilities: list[str] = []
    in_qa: bool = False


class WatcherIn(BaseModel):
    user_id: int


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    parent_id: int | None = None


class CommentAttachment(BaseModel):
    id: int
    filename: str
    content_type: str
    size: int


class CommentOut(BaseModel):
    id: int
    body: str
    author: UserBrief | None
    parent_id: int | None = None
    version: int = 1
    created_at: datetime
    edited_at: datetime | None
    can_delete: bool = False
    can_request_edit: bool = False
    edit_pending: bool = False
    attachments: list[CommentAttachment] = []


class EditRequestIn(BaseModel):
    proposed_body: str = Field(min_length=1, max_length=20_000)
    reason: Str = Field(min_length=5, max_length=500)


class DecisionIn(BaseModel):
    approve: bool
    note: Str = Field(default="", max_length=500)
    expected_status: str = "pending"


class EditRequestOut(BaseModel):
    id: int
    organization_id: int
    project: dict
    team: TeamBrief | None
    task: dict
    comment_id: int
    original_body: str
    proposed_body: str
    reason: str
    requester: UserBrief | None
    approver: UserBrief | None
    status: str
    created_at: datetime
    decided_by: UserBrief | None
    decided_at: datetime | None
    decision_note: str
    can_decide: bool = False


class CommentVersionOut(BaseModel):
    version: int
    body: str
    created_at: datetime
    edit_request_id: int | None


class AttachmentOut(BaseModel):
    comment_id: int | None = None
    id: int
    filename: str
    content_type: str
    size: int
    uploader: UserBrief | None
    created_at: datetime


class NotificationOut(ORM):
    id: int
    type: str
    title: str
    body: str
    task_id: int | None
    project_id: int | None
    read_at: datetime | None
    created_at: datetime
    actor: UserBrief | None = None
