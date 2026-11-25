from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

Str = Annotated[str, StringConstraints(strip_whitespace=True)]
Color = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]

OrgRole = Literal["owner", "admin", "pmo", "member", "guest"]
ProjectRole = Literal["manager", "member", "guest"]
StatusCategory = Literal["todo", "in_progress", "review", "done", "blocked"]
TaskType = Literal["task", "bug", "story", "incident", "ticket"]
Priority = Literal["none", "low", "medium", "high", "urgent"]
RelationType = Literal["blocks", "depends_on", "duplicates", "relates_to"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserBrief(ORM):
    id: int
    full_name: str
    email: EmailStr
    avatar_color: str


class Message(BaseModel):
    detail: str


__all__ = [
    "ORM", "Str", "Color", "UserBrief", "Message", "Field", "BaseModel", "EmailStr",
    "date", "datetime", "OrgRole", "ProjectRole", "StatusCategory", "TaskType", "Priority", "RelationType",
]
