"""Oficina virtual, presencia, rendimiento y reconocimientos."""

from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import OrgCtx, get_org_ctx
from app.api.permissions import accessible_project_ids, forbidden, led_team_ids, not_found, task_visibility_clause, user_team_ids
from app.core.db import get_db
from app.models import (
    AchievementDefinition,
    Membership,
    Organization,
    Project,
    Task,
    TaskContribution,
    Team,
    TeamMember,
    User,
    UserAchievement,
    WorkflowStatus,
)
from app.schemas.common import UserBrief
from app.services.achievements import compute_streak
from app.services.presence import online_users

router = APIRouter(prefix="/orgs/{org_id}", tags=["insights"])


class ActiveTask(BaseModel):
    id: int
    key: str
    title: str
    project_id: int
    priority: str


class OfficeMember(BaseModel):
    user: UserBrief
    online: bool
    last_seen: int | None
    is_lead: bool
    pending: int
    in_progress: int
    capacity: int
    active_tasks: list[ActiveTask]  # sólo las tareas que quien consulta tiene permiso de ver


class OfficeTeam(BaseModel):
    id: int
    name: str
    color: str
    is_qa: bool
    lead: UserBrief | None
    members: list[OfficeMember]
    online: int
    pending: int
    in_progress: int


class Office(BaseModel):
    wip_limit: int
    teams: list[OfficeTeam]
    unassigned_online: list[UserBrief]


@router.get("/presence", response_model=dict)
def presence(ctx: OrgCtx = Depends(get_org_ctx)):
    return {"online": sorted(online_users(ctx.org_id))}


@router.get("/office", response_model=Office)
def office(ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    org = db.get(Organization, ctx.org_id)
    online = online_users(ctx.org_id)
    teams = db.scalars(select(Team).where(Team.organization_id == ctx.org_id).order_by(Team.name)).all()
    member_ids = {tm.user_id for t in teams for tm in t.members} | {t.lead_id for t in teams if t.lead_id}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(member_ids or {0})))}

    # Conteos de carga (sin títulos: no revelan contenido).
    pending: dict[int, int] = defaultdict(int)
    active: dict[int, int] = defaultdict(int)
    for uid, cat in db.execute(
        select(Task.assignee_id, WorkflowStatus.category).join(WorkflowStatus, WorkflowStatus.id == Task.status_id)
        .where(Task.organization_id == ctx.org_id, Task.assignee_id.in_(member_ids or {0}), Task.deleted_at.is_(None),
               WorkflowStatus.category != "done")
    ):
        pending[uid] += 1
        active[uid] += cat == "in_progress"

    # Tareas en ejecución visibles para quien consulta.
    visible_projects = accessible_project_ids(db, ctx)
    q = (select(Task, Project.key).join(Project, Project.id == Task.project_id)
         .join(WorkflowStatus, WorkflowStatus.id == Task.status_id)
         .where(Task.organization_id == ctx.org_id, Task.deleted_at.is_(None), WorkflowStatus.category == "in_progress",
                Task.assignee_id.in_(member_ids or {0}), Task.project_id.in_(visible_projects or [0])))
    vis = task_visibility_clause(db, ctx)
    if vis is not None:
        q = q.where(vis)
    running: dict[int, list[ActiveTask]] = defaultdict(list)
    for t, key in db.execute(q):
        running[t.assignee_id].append(ActiveTask(id=t.id, key=f"{key}-{t.number}", title=t.title, project_id=t.project_id,
                                                 priority=t.priority))

    out = []
    for t in teams:
        ids = sorted({tm.user_id for tm in t.members} | ({t.lead_id} if t.lead_id else set()),
                     key=lambda i: (i != t.lead_id, users[i].full_name if i in users else ""))
        members = [OfficeMember(user=UserBrief.model_validate(users[i]), online=i in online, last_seen=online.get(i),
                                is_lead=i == t.lead_id, pending=pending[i], in_progress=active[i], capacity=org.wip_limit,
                                active_tasks=running[i]) for i in ids if i in users]
        out.append(OfficeTeam(id=t.id, name=t.name, color=t.color, is_qa=t.is_qa,
                              lead=UserBrief.model_validate(users[t.lead_id]) if t.lead_id in users else None,
                              members=members, online=sum(m.online for m in members),
                              pending=sum(m.pending for m in members), in_progress=sum(m.in_progress for m in members)))
    loose = [UserBrief.model_validate(u) for u in db.scalars(select(User).where(User.id.in_(set(online) - member_ids or {0})))]
    return Office(wip_limit=org.wip_limit, teams=out, unassigned_online=loose)


# ---- Rendimiento y reconocimientos ---------------------------------------------------


class AchievementOut(BaseModel):
    id: int
    code: str
    name: str
    description: str
    kind: str
    status: str
    awarded_at: datetime
    revoked_at: datetime | None
    revoke_reason: str
    evidence: dict | None
    user: UserBrief
    project: dict | None
    task: dict | None
    team: dict | None


class Performance(BaseModel):
    user: UserBrief
    resolutions: int
    validations: int
    contributions: int
    contributions_by_kind: dict[str, int]
    current_streak: int
    best_streak: int
    last_contribution_day: str | None
    achievements: list[AchievementOut]


def _can_see_user(db: Session, ctx: OrgCtx, user_id: int) -> bool:
    """Uno mismo, gerentes (CEO, administración, PMO) o el líder de algún equipo de esa persona."""
    if user_id == ctx.user.id or ctx.is_manager:
        return True
    return bool(led_team_ids(db, ctx.org_id, ctx.user.id) & user_team_ids(db, ctx.org_id, user_id))


def _achievements_out(db: Session, ctx: OrgCtx, rows) -> list[AchievementOut]:
    defs = {d.id: d for d in db.scalars(select(AchievementDefinition))}
    visible = set(accessible_project_ids(db, ctx))
    out = []
    for ua in rows:
        d = defs[ua.definition_id]
        u = db.get(User, ua.user_id)
        project = db.get(Project, ua.project_id) if ua.project_id else None
        task = db.get(Task, ua.task_id) if ua.task_id else None
        # El contexto (proyecto y tarea) sólo se muestra si quien consulta puede ver ese proyecto.
        show = project is not None and project.id in visible
        team = db.get(Team, ua.team_id) if ua.team_id else None
        out.append(AchievementOut(
            id=ua.id, code=d.code, name=d.name, description=d.description, kind=d.kind, status=ua.status,
            awarded_at=ua.awarded_at, revoked_at=ua.revoked_at, revoke_reason=ua.revoke_reason,
            evidence=ua.evidence if show or not project else None, user=UserBrief.model_validate(u),
            project={"id": project.id, "key": project.key, "name": project.name} if show else None,
            task={"id": task.id, "key": f"{project.key}-{task.number}", "title": task.title} if show and task else None,
            team={"id": team.id, "name": team.name, "color": team.color} if team else None,
        ))
    return out


@router.get("/users/{user_id}/performance", response_model=Performance)
def performance(user_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    if not db.scalar(select(Membership.id).where(Membership.organization_id == ctx.org_id, Membership.user_id == user_id)):
        raise not_found("Usuario")
    if not _can_see_user(db, ctx, user_id):
        raise forbidden("Sólo la persona, su líder o la dirección pueden consultar este panel")
    org = db.get(Organization, ctx.org_id)
    rows = db.scalars(select(UserAchievement).where(UserAchievement.organization_id == ctx.org_id,
                                                    UserAchievement.user_id == user_id)
                      .order_by(UserAchievement.awarded_at.desc()).limit(100)).all()
    active = [r for r in rows if r.status == "active"]
    defs = {d.id: d.code for d in db.scalars(select(AchievementDefinition))}
    by_kind = dict(db.execute(select(TaskContribution.kind, func.count()).where(
        TaskContribution.organization_id == ctx.org_id, TaskContribution.user_id == user_id).group_by(TaskContribution.kind)).all())
    current, best, last, _ = compute_streak(db, org, user_id)
    return Performance(
        user=UserBrief.model_validate(db.get(User, user_id)),
        resolutions=sum(defs[r.definition_id] == "resolution" for r in active),
        validations=sum(defs[r.definition_id] == "qa_validation" for r in active),
        contributions=sum(by_kind.values()), contributions_by_kind=by_kind,
        current_streak=current, best_streak=best, last_contribution_day=str(last) if last else None,
        achievements=_achievements_out(db, ctx, rows),
    )


@router.get("/achievements", response_model=list[AchievementOut])
def achievements(team_id: int | None = None, project_id: int | None = None, limit: int = Query(100, le=300),
                 ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    """Reconocimientos por equipo o proyecto (CEO, administración y PMO). No es un ranking: cada logro lleva su contexto."""
    if not ctx.is_manager:
        raise forbidden("Disponible para CEO, administración y PMO")
    q = select(UserAchievement).where(UserAchievement.organization_id == ctx.org_id, UserAchievement.status == "active")
    if team_id:
        q = q.where(UserAchievement.team_id == team_id)
    if project_id:
        q = q.where(UserAchievement.project_id == project_id)
    return _achievements_out(db, ctx, db.scalars(q.order_by(UserAchievement.awarded_at.desc()).limit(limit)).all())
