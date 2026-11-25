import re
import secrets
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Membership, Organization, Project, ProjectMember, User, WorkflowStatus

DEFAULT_STATUSES = [
    ("Por hacer", "todo", "#98A2B3"),
    ("En progreso", "in_progress", "#2563EB"),
    ("En revisión", "review", "#8B5CF6"),
    ("Bloqueado", "blocked", "#F04438"),
    ("Hecho", "done", "#12B76A"),
]

AVATAR_COLORS = ["#4F46E5", "#2563EB", "#0E9384", "#12B76A", "#F79009", "#DD2590", "#7A5AF8", "#475467"]


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value[:60] or "org"


def unique_slug(db: Session, name: str) -> str:
    base = slugify(name)
    slug = base
    while db.scalar(select(Organization.id).where(Organization.slug == slug)):
        slug = f"{base}-{secrets.token_hex(2)}"
    return slug


def create_organization(db: Session, owner: User, name: str) -> Organization:
    org = Organization(name=name, slug=unique_slug(db, name), created_by_id=owner.id)
    db.add(org)
    db.flush()
    db.add(Membership(organization_id=org.id, user_id=owner.id, role="owner"))
    return org


def create_project(db: Session, org_id: int, creator: User, **fields) -> Project:
    project = Project(organization_id=org_id, created_by_id=creator.id, **fields)
    project.key = project.key.upper()
    db.add(project)
    db.flush()
    for i, (name, cat, color) in enumerate(DEFAULT_STATUSES):
        db.add(
            WorkflowStatus(
                organization_id=org_id, project_id=project.id, name=name, category=cat, color=color, position=i
            )
        )
    db.add(ProjectMember(organization_id=org_id, project_id=project.id, user_id=creator.id, role="manager"))
    db.flush()
    return project


def pick_avatar_color(email: str) -> str:
    return AVATAR_COLORS[sum(map(ord, email)) % len(AVATAR_COLORS)]
