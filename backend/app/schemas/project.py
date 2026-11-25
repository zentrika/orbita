from typing import Literal

from app.schemas.common import (
    ORM,
    BaseModel,
    Color,
    Field,
    ProjectRole,
    StatusCategory,
    Str,
    UserBrief,
    date,
    datetime,
)

ProjectHealth = Literal["on_track", "at_risk", "off_track", "done"]
Visibility = Literal["organization", "private"]


class ProjectCreate(BaseModel):
    name: Str = Field(min_length=2, max_length=120)
    key: Str = Field(min_length=2, max_length=10, pattern=r"^[A-Za-z][A-Za-z0-9]{1,9}$")
    description: Str = Field(default="", max_length=500)
    color: Color = "#4F46E5"
    visibility: Visibility = "private"
    team_ids: list[int] = []
    start_date: date | None = None
    end_date: date | None = None


class ProjectUpdate(BaseModel):
    name: Str | None = Field(default=None, min_length=2, max_length=120)
    description: Str | None = Field(default=None, max_length=500)
    scope: str | None = Field(default=None, max_length=20000)
    color: Color | None = None
    status: ProjectHealth | None = None
    visibility: Visibility | None = None
    start_date: date | None = None
    end_date: date | None = None


class StatusOut(ORM):
    id: int
    name: str
    category: str
    color: str
    position: int


class LabelOut(ORM):
    id: int
    name: str
    color: str


class ProjectOut(ORM):
    id: int
    key: str
    name: str
    description: str
    scope: str
    color: str
    status: str
    visibility: str
    start_date: date | None
    end_date: date | None
    created_at: datetime
    my_role: str | None = None
    permissions: list[str] = []
    task_count: int = 0
    done_count: int = 0
    progress: int = 0
    members: list[UserBrief] = []
    teams: list[dict] = []


class ProjectDetail(ProjectOut):
    statuses: list[StatusOut] = []
    labels: list[LabelOut] = []


class ProjectMemberIn(BaseModel):
    user_id: int
    role: ProjectRole = "member"


class ProjectMemberOut(BaseModel):
    user: UserBrief
    role: str


class StatusIn(BaseModel):
    name: Str = Field(min_length=1, max_length=60)
    category: StatusCategory = "todo"
    color: Color = "#98A2B3"
    position: int | None = None


class StatusUpdate(BaseModel):
    name: Str | None = Field(default=None, min_length=1, max_length=60)
    category: StatusCategory | None = None
    color: Color | None = None
    position: int | None = None


class LabelIn(BaseModel):
    name: Str = Field(min_length=1, max_length=40)
    color: Color = "#667085"


class LabelUpdate(BaseModel):
    name: Str | None = Field(default=None, min_length=1, max_length=40)
    color: Color | None = None


class MilestoneIn(BaseModel):
    name: Str = Field(min_length=1, max_length=120)
    description: Str = Field(default="", max_length=500)
    due_date: date | None = None
    status: Literal["open", "done"] = "open"


class MilestoneUpdate(BaseModel):
    name: Str | None = Field(default=None, min_length=1, max_length=120)
    description: Str | None = Field(default=None, max_length=500)
    due_date: date | None = None
    status: Literal["open", "done"] | None = None


class MilestoneOut(ORM):
    id: int
    name: str
    description: str
    due_date: date | None
    status: str
    task_count: int = 0
    done_count: int = 0


class SprintIn(BaseModel):
    name: Str = Field(min_length=1, max_length=80)
    goal: Str = Field(default="", max_length=500)
    start_date: date | None = None
    end_date: date | None = None
    state: Literal["planned", "active", "closed"] = "planned"


class SprintUpdate(BaseModel):
    name: Str | None = Field(default=None, min_length=1, max_length=80)
    goal: Str | None = Field(default=None, max_length=500)
    start_date: date | None = None
    end_date: date | None = None
    state: Literal["planned", "active", "closed"] | None = None


class SprintOut(ORM):
    id: int
    name: str
    goal: str
    start_date: date | None
    end_date: date | None
    state: str
    task_count: int = 0
    done_count: int = 0


class GoalIn(BaseModel):
    title: Str = Field(min_length=1, max_length=160)
    description: Str = Field(default="", max_length=500)
    target_date: date | None = None
    progress: int = Field(default=0, ge=0, le=100)
    owner_id: int | None = None


class GoalUpdate(BaseModel):
    title: Str | None = Field(default=None, min_length=1, max_length=160)
    description: Str | None = Field(default=None, max_length=500)
    target_date: date | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    owner_id: int | None = None


class GoalOut(ORM):
    id: int
    title: str
    description: str
    target_date: date | None
    progress: int
    owner_id: int | None


class ActivityOut(BaseModel):
    id: int
    action: str
    entity_type: str
    entity_id: int | None
    task_id: int | None
    task_key: str | None = None
    changes: dict | None
    actor: UserBrief | None
    created_at: datetime
