from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from app.api.deps import OrgCtx, get_org_ctx
from app.api.permissions import (
    accessible_project_ids,
    forbidden,
    load_project,
    not_found,
    permissions_for,
    project_role,
)
from app.core.db import get_db, utcnow
from app.models import (
    ActivityLog,
    Goal,
    Label,
    Membership,
    Milestone,
    Project,
    ProjectMember,
    ProjectTeam,
    Sprint,
    Team,
    Task,
    User,
    WorkflowStatus,
)
from app.schemas.common import Message, UserBrief
from app.schemas.project import (
    ActivityOut,
    GoalIn,
    GoalOut,
    GoalUpdate,
    LabelIn,
    LabelOut,
    LabelUpdate,
    MilestoneIn,
    MilestoneOut,
    MilestoneUpdate,
    ProjectCreate,
    ProjectDetail,
    ProjectMemberIn,
    ProjectMemberOut,
    ProjectOut,
    ProjectUpdate,
    SprintIn,
    SprintOut,
    SprintUpdate,
    StatusIn,
    StatusOut,
    StatusUpdate,
)
from app.services.audit import diff, log_activity
from app.services.orgs import create_project
from app.services.realtime import emit_org

router = APIRouter(prefix="/orgs/{org_id}/projects", tags=["projects"])


def _counts(db: Session, project_ids: list[int], group_col) -> dict[int, tuple[int, int]]:
    """{id: (total, hechas)} de tareas no borradas agrupadas por la columna dada."""
    if not project_ids:
        return {}
    rows = db.execute(
        select(
            group_col,
            func.count(Task.id),
            func.sum(case((WorkflowStatus.category == "done", 1), else_=0)),
        )
        .join(WorkflowStatus, WorkflowStatus.id == Task.status_id)
        .where(group_col.in_(project_ids), Task.deleted_at.is_(None))
        .group_by(group_col)
    ).all()
    return {r[0]: (int(r[1] or 0), int(r[2] or 0)) for r in rows}


def _project_members(db: Session, project_ids: list[int]) -> dict[int, list[UserBrief]]:
    out: dict[int, list[UserBrief]] = defaultdict(list)
    if not project_ids:
        return out
    rows = db.execute(
        select(ProjectMember.project_id, User).join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id.in_(project_ids))
    ).all()
    for pid, u in rows:
        out[pid].append(UserBrief.model_validate(u))
    return out


def _project_teams(db: Session, project_ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = defaultdict(list)
    if not project_ids:
        return out
    for pid, t in db.execute(select(ProjectTeam.project_id, Team).join(Team, Team.id == ProjectTeam.team_id)
                             .where(ProjectTeam.project_id.in_(project_ids)).order_by(Team.name)):
        out[pid].append({"id": t.id, "name": t.name, "color": t.color, "is_qa": t.is_qa})
    return out


def _project_out(db: Session, ctx: OrgCtx, p: Project, role: str | None = None, counts=None, members=None,
                 cls=ProjectOut, teams=None):
    role = role or project_role(db, ctx, p)
    total, done = (counts or _counts(db, [p.id], Task.project_id)).get(p.id, (0, 0))
    mem = (members if members is not None else _project_members(db, [p.id])).get(p.id, [])
    return cls.model_validate(p).model_copy(update={
        "my_role": role, "permissions": permissions_for(role), "task_count": total, "done_count": done,
        "progress": round(done * 100 / total) if total else 0, "members": mem,
        "teams": (teams if teams is not None else _project_teams(db, [p.id])).get(p.id, []),
    })


@router.get("", response_model=list[ProjectOut])
def list_projects(ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    ids = accessible_project_ids(db, ctx)
    if not ids:
        return []
    projects = db.scalars(select(Project).where(Project.id.in_(ids)).order_by(Project.name)).all()
    counts = _counts(db, ids, Task.project_id)
    members = _project_members(db, ids)
    teams = _project_teams(db, ids)
    return [_project_out(db, ctx, p, counts=counts, members=members, teams=teams) for p in projects]


@router.post("", response_model=ProjectDetail, status_code=201)
def create(data: ProjectCreate, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    if ctx.role == "guest":
        raise forbidden("Los invitados no pueden crear proyectos")
    key = data.key.upper()
    if db.scalar(select(Project.id).where(Project.organization_id == ctx.org_id, Project.key == key)):
        raise HTTPException(409, "Ya existe un proyecto con esa clave")
    team_ids = data.team_ids
    p = create_project(db, ctx.org_id, ctx.user, **data.model_dump(exclude={"team_ids"}) | {"key": key})
    for tid in _valid_team_ids(db, ctx, team_ids):
        db.add(ProjectTeam(organization_id=ctx.org_id, project_id=p.id, team_id=tid))
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="created", entity_type="project",
                 entity_id=p.id, project_id=p.id, changes={"name": [None, p.name]})
    emit_org(db, ctx.org_id, "project.created", project_id=p.id)
    db.commit()
    return get_project(p.id, ctx, db)


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(project_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, role = load_project(db, ctx, project_id)
    out = _project_out(db, ctx, p, role, cls=ProjectDetail)
    out.statuses = [StatusOut.model_validate(s) for s in db.scalars(
        select(WorkflowStatus).where(WorkflowStatus.project_id == p.id).order_by(WorkflowStatus.position))]
    out.labels = [LabelOut.model_validate(lb) for lb in db.scalars(
        select(Label).where(Label.project_id == p.id).order_by(Label.name))]
    return out


@router.patch("/{project_id}", response_model=ProjectDetail)
def update_project(project_id: int, data: ProjectUpdate, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "manage")
    values = data.model_dump(exclude_unset=True)
    changes = diff(p, values)
    for k, v in values.items():
        setattr(p, k, v)
    if changes:
        log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="updated", entity_type="project",
                     entity_id=p.id, project_id=p.id, changes={k: v for k, v in changes.items() if k != "scope"})
        emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
    db.commit()
    return get_project(p.id, ctx, db)


@router.delete("/{project_id}", response_model=Message)
def delete_project(project_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "delete")
    p.deleted_at = utcnow()  # borrado lógico
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="deleted", entity_type="project",
                 entity_id=p.id, project_id=p.id)
    emit_org(db, ctx.org_id, "project.deleted", project_id=p.id)
    db.commit()
    return Message(detail="Proyecto archivado")


# ---- Miembros del proyecto ------------------------------------------------------------


@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
def project_members(project_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id)
    rows = db.execute(
        select(ProjectMember, User).join(User, User.id == ProjectMember.user_id).where(ProjectMember.project_id == p.id)
    ).all()
    return [ProjectMemberOut(user=UserBrief.model_validate(u), role=pm.role) for pm, u in rows]


@router.get("/{project_id}/assignable", response_model=list[UserBrief])
def assignable_users(project_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    """Personas que pueden ver el proyecto (candidatas a responsable, observador o mención)."""
    p, _ = load_project(db, ctx, project_id)
    out = []
    for m, u in db.execute(select(Membership, User).join(User, User.id == Membership.user_id)
                           .where(Membership.organization_id == ctx.org_id).order_by(User.full_name)):
        if project_role(db, OrgCtx(org_id=ctx.org_id, user=u, role=m.role), p):
            out.append(UserBrief.model_validate(u))
    return out


@router.post("/{project_id}/members", response_model=ProjectMemberOut, status_code=201)
def add_project_member(project_id: int, data: ProjectMemberIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "manage")
    m = db.scalar(select(Membership).where(Membership.organization_id == ctx.org_id, Membership.user_id == data.user_id))
    if not m:
        raise HTTPException(400, "El usuario no pertenece a la organización")
    role = "guest" if m.role == "guest" else data.role
    pm = db.scalar(select(ProjectMember).where(ProjectMember.project_id == p.id, ProjectMember.user_id == data.user_id))
    if pm:
        pm.role = role
    else:
        pm = ProjectMember(organization_id=ctx.org_id, project_id=p.id, user_id=data.user_id, role=role)
        db.add(pm)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="member_added", entity_type="project",
                 entity_id=p.id, project_id=p.id, changes={"user_id": data.user_id, "role": role})
    emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
    db.commit()
    return ProjectMemberOut(user=UserBrief.model_validate(m.user), role=role)


@router.delete("/{project_id}/members/{user_id}", response_model=Message)
def remove_project_member(project_id: int, user_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "manage")
    pm = db.scalar(select(ProjectMember).where(ProjectMember.project_id == p.id, ProjectMember.user_id == user_id))
    if not pm:
        raise not_found("Miembro")
    db.delete(pm)
    emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
    db.commit()
    return Message(detail="Miembro quitado del proyecto")


# ---- Equipos con acceso al proyecto ---------------------------------------------------


def _valid_team_ids(db: Session, ctx: OrgCtx, ids: list[int]) -> set[int]:
    if not ids:
        return set()
    valid = set(db.scalars(select(Team.id).where(Team.organization_id == ctx.org_id, Team.id.in_(ids))))
    if valid != set(ids):
        raise HTTPException(400, "Equipo no válido")
    return valid


class TeamLinkIn(BaseModel):
    team_id: int


@router.get("/{project_id}/teams", response_model=list[dict])
def list_project_teams(project_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id)
    return _project_teams(db, [p.id]).get(p.id, [])


@router.post("/{project_id}/teams", response_model=list[dict], status_code=201)
def link_team(project_id: int, data: TeamLinkIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "manage")
    _valid_team_ids(db, ctx, [data.team_id])
    if not db.scalar(select(ProjectTeam.id).where(ProjectTeam.project_id == p.id, ProjectTeam.team_id == data.team_id)):
        db.add(ProjectTeam(organization_id=ctx.org_id, project_id=p.id, team_id=data.team_id))
        log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="team_linked", entity_type="project", entity_id=p.id,
                     project_id=p.id, changes={"team_id": [None, data.team_id]})
        emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
        db.commit()
    return _project_teams(db, [p.id]).get(p.id, [])


@router.delete("/{project_id}/teams/{team_id}", response_model=list[dict])
def unlink_team(project_id: int, team_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "manage")
    link = db.scalar(select(ProjectTeam).where(ProjectTeam.project_id == p.id, ProjectTeam.team_id == team_id))
    if not link:
        raise not_found("Equipo")
    db.delete(link)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="team_unlinked", entity_type="project", entity_id=p.id,
                 project_id=p.id, changes={"team_id": [team_id, None]})
    emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
    db.commit()
    return _project_teams(db, [p.id]).get(p.id, [])


# ---- Estados --------------------------------------------------------------------------


@router.get("/{project_id}/statuses", response_model=list[StatusOut])
def list_statuses(project_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id)
    return db.scalars(select(WorkflowStatus).where(WorkflowStatus.project_id == p.id).order_by(WorkflowStatus.position)).all()


@router.post("/{project_id}/statuses", response_model=StatusOut, status_code=201)
def create_status(project_id: int, data: StatusIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "manage")
    count = db.scalar(select(func.count()).select_from(WorkflowStatus).where(WorkflowStatus.project_id == p.id))
    if count >= 20:
        raise HTTPException(400, "Máximo 20 estados por proyecto")
    s = WorkflowStatus(organization_id=ctx.org_id, project_id=p.id, name=data.name, category=data.category,
                       color=data.color, position=data.position if data.position is not None else count)
    db.add(s)
    emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
    db.commit()
    return s


def _get_child(db: Session, model, ctx: OrgCtx, project_id: int, obj_id: int, what: str):
    obj = db.scalar(select(model).where(model.id == obj_id, model.organization_id == ctx.org_id, model.project_id == project_id))
    if not obj:
        raise not_found(what)
    return obj


@router.patch("/{project_id}/statuses/{status_id}", response_model=StatusOut)
def update_status(project_id: int, status_id: int, data: StatusUpdate, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "manage")
    s = _get_child(db, WorkflowStatus, ctx, p.id, status_id, "Estado")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
    db.commit()
    return s


class ReorderIn(BaseModel):
    ids: list[int]


@router.post("/{project_id}/statuses/reorder", response_model=list[StatusOut])
def reorder_statuses(project_id: int, data: ReorderIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "manage")
    statuses = {s.id: s for s in db.scalars(select(WorkflowStatus).where(WorkflowStatus.project_id == p.id))}
    if set(data.ids) != set(statuses):
        raise HTTPException(400, "La lista de estados no coincide")
    for i, sid in enumerate(data.ids):
        statuses[sid].position = i
    emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
    db.commit()
    return sorted(statuses.values(), key=lambda s: s.position)


@router.delete("/{project_id}/statuses/{status_id}", response_model=Message)
def delete_status(project_id: int, status_id: int, move_to: int | None = Query(default=None),
                  ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id, "manage")
    s = _get_child(db, WorkflowStatus, ctx, p.id, status_id, "Estado")
    in_use = db.scalar(select(func.count()).select_from(Task).where(Task.status_id == s.id))
    if in_use:
        if not move_to or move_to == s.id:
            raise HTTPException(400, f"Hay {in_use} tareas en este estado; indica a qué estado moverlas")
        target = _get_child(db, WorkflowStatus, ctx, p.id, move_to, "Estado destino")
        db.execute(update(Task).where(Task.status_id == s.id).values(status_id=target.id))
    db.delete(s)
    emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
    db.commit()
    return Message(detail="Estado eliminado")


# ---- Etiquetas, hitos, sprints y metas: CRUD genérico ----------------------------------


def _register_crud(path: str, model, in_schema, upd_schema, out_schema, what: str, counted_col=None, order=None,
                   create_action: str = "manage"):
    def _with_counts(db, items):
        if counted_col is None:
            return [out_schema.model_validate(i) for i in items]
        counts = _counts(db, [i.id for i in items], counted_col)
        return [out_schema.model_validate(i).model_copy(update={
            "task_count": counts.get(i.id, (0, 0))[0], "done_count": counts.get(i.id, (0, 0))[1]}) for i in items]

    @router.get(f"/{{project_id}}/{path}", response_model=list[out_schema], name=f"list_{path}")
    def _list(project_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
        p, _ = load_project(db, ctx, project_id)
        q = select(model).where(model.project_id == p.id, model.organization_id == ctx.org_id)
        return _with_counts(db, db.scalars(q.order_by(order if order is not None else model.id)).all())

    @router.post(f"/{{project_id}}/{path}", response_model=out_schema, status_code=201, name=f"create_{path}")
    def _create(project_id: int, data: in_schema, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
        p, _ = load_project(db, ctx, project_id, create_action)
        if model is Label:
            existing = db.scalar(select(Label).where(Label.project_id == p.id, func.lower(Label.name) == data.name.lower()))
            if existing:
                return _with_counts(db, [existing])[0]  # crear «al vuelo» es idempotente
        obj = model(organization_id=ctx.org_id, project_id=p.id, **data.model_dump())
        db.add(obj)
        log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="created", entity_type=model.__tablename__[:-1],
                     project_id=p.id)
        emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
        try:
            db.commit()
        except Exception as exc:  # noqa: BLE001 — violación de unicidad
            db.rollback()
            raise HTTPException(409, f"{what} duplicado") from exc
        return _with_counts(db, [obj])[0]

    @router.patch(f"/{{project_id}}/{path}/{{obj_id}}", response_model=out_schema, name=f"update_{path}")
    def _update(project_id: int, obj_id: int, data: upd_schema, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
        p, _ = load_project(db, ctx, project_id, "manage")
        obj = _get_child(db, model, ctx, p.id, obj_id, what)
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(obj, k, v)
        emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
        db.commit()
        return _with_counts(db, [obj])[0]

    @router.delete(f"/{{project_id}}/{path}/{{obj_id}}", response_model=Message, name=f"delete_{path}")
    def _delete(project_id: int, obj_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
        p, _ = load_project(db, ctx, project_id, "manage")
        db.delete(_get_child(db, model, ctx, p.id, obj_id, what))
        emit_org(db, ctx.org_id, "project.updated", project_id=p.id)
        db.commit()
        return Message(detail=f"{what} eliminado")


# Las etiquetas pertenecen al proyecto. Cualquiera que pueda crear tareas puede crear una etiqueta nueva desde la tarea.
_register_crud("labels", Label, LabelIn, LabelUpdate, LabelOut, "Etiqueta", order=Label.name, create_action="create")
_register_crud("milestones", Milestone, MilestoneIn, MilestoneUpdate, MilestoneOut, "Hito", Task.milestone_id, Milestone.due_date)
_register_crud("sprints", Sprint, SprintIn, SprintUpdate, SprintOut, "Sprint", Task.sprint_id, Sprint.start_date)
_register_crud("goals", Goal, GoalIn, GoalUpdate, GoalOut, "Meta", order=Goal.target_date)


# ---- Actividad ------------------------------------------------------------------------


@router.get("/{project_id}/activity", response_model=list[ActivityOut])
def project_activity(project_id: int, limit: int = Query(50, le=200), ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    p, _ = load_project(db, ctx, project_id)
    rows = db.scalars(
        select(ActivityLog).where(ActivityLog.organization_id == ctx.org_id, ActivityLog.project_id == p.id)
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(limit)
    ).all()
    return activity_out(db, rows, p.key)


def activity_out(db: Session, rows, project_key: str | None = None) -> list[ActivityOut]:
    actor_ids = {r.actor_id for r in rows if r.actor_id}
    task_ids = {r.task_id for r in rows if r.task_id}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(actor_ids)))} if actor_ids else {}
    keys = {}
    if task_ids:
        for tid, num, key in db.execute(
            select(Task.id, Task.number, Project.key).join(Project, Project.id == Task.project_id).where(Task.id.in_(task_ids))
        ):
            keys[tid] = f"{key}-{num}"
    return [
        ActivityOut(
            id=r.id, action=r.action, entity_type=r.entity_type, entity_id=r.entity_id, task_id=r.task_id,
            task_key=keys.get(r.task_id), changes=r.changes,
            actor=UserBrief.model_validate(users[r.actor_id]) if r.actor_id in users else None, created_at=r.created_at,
        )
        for r in rows
    ]
