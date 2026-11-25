from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import OrgCtx, get_org_ctx
from app.api.permissions import (
    accessible_project_ids,
    can_view_task,
    forbidden,
    is_team_member,
    led_team_ids,
    load_project,
    load_task,
    not_found,
    permissions_for,
    project_role,
    project_team_ids,
    task_capabilities,
    task_visibility_clause,
)
from app.api.routes.projects import activity_out
from app.core.db import get_db, utcnow
from app.models import (
    ActivityLog,
    Attachment,
    ChecklistItem,
    Comment,
    Label,
    Membership,
    Milestone,
    Organization,
    Project,
    Sprint,
    Task,
    TaskLabel,
    TaskRelation,
    TaskAssignmentHistory,
    TaskResolutionCycle,
    TaskTeamTransfer,
    TaskWatcher,
    Team,
    TeamMember,
    TimeEntry,
    User,
    WorkflowStatus,
)
from app.schemas.common import Message, UserBrief
from app.schemas.project import ActivityOut, LabelOut, StatusOut
from app.schemas.task import (
    AssignIn,
    AssignmentHistoryOut,
    CycleOut,
    EligibleAssignee,
    QAReviewIn,
    SubmitQAIn,
    TeamBrief,
    TransferIn,
    TransferOut,
    ChecklistIn,
    ChecklistItemOut,
    ChecklistUpdate,
    RelatedTask,
    RelationIn,
    RelationOut,
    TaskCreate,
    TaskDetail,
    TaskMove,
    TaskOut,
    TaskUpdate,
    TimeEntryIn,
    TimeEntryOut,
    WatcherIn,
)
from app.services.achievements import award, record_contribution, revoke_cycle_achievements
from app.services.audit import diff, log_activity
from app.services.notifications import notify
from app.services.realtime import emit_org
from app.services.sanitize import clean_html

router = APIRouter(prefix="/orgs/{org_id}", tags=["tasks"])

RELATION_LABELS = {
    ("blocks", "outgoing"): "Bloquea a",
    ("blocks", "incoming"): "Bloqueada por",
    ("depends_on", "outgoing"): "Depende de",
    ("depends_on", "incoming"): "Requerida por",
    ("duplicates", "outgoing"): "Duplica a",
    ("duplicates", "incoming"): "Duplicada por",
    ("relates_to", "outgoing"): "Relacionada con",
    ("relates_to", "incoming"): "Relacionada con",
}


# ---- Serialización por lotes ----------------------------------------------------------


def _count_by(db: Session, col, ids, *where) -> dict[int, int]:
    if not ids:
        return {}
    return dict(db.execute(select(col, func.count()).where(col.in_(ids), *where).group_by(col)).all())


def serialize_tasks(db: Session, tasks: list[Task]) -> list[TaskOut]:
    if not tasks:
        return []
    ids = [t.id for t in tasks]
    project_keys = dict(db.execute(select(Project.id, Project.key).where(Project.id.in_({t.project_id for t in tasks}))).all())
    statuses = {s.id: s for s in db.scalars(select(WorkflowStatus).where(WorkflowStatus.id.in_({t.status_id for t in tasks})))}
    user_ids = {u for t in tasks for u in (t.assignee_id, t.reporter_id) if u}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids)))} if user_ids else {}
    team_ids = {t.team_id for t in tasks if t.team_id}
    teams = {tm.id: tm for tm in db.scalars(select(Team).where(Team.id.in_(team_ids)))} if team_ids else {}
    labels: dict[int, list[LabelOut]] = defaultdict(list)
    for tid, lb in db.execute(select(TaskLabel.task_id, Label).join(Label, Label.id == TaskLabel.label_id).where(TaskLabel.task_id.in_(ids))):
        labels[tid].append(LabelOut.model_validate(lb))

    sub_total: dict[int, int] = defaultdict(int)
    sub_done: dict[int, int] = defaultdict(int)
    for pid, cat in db.execute(
        select(Task.parent_id, WorkflowStatus.category).join(WorkflowStatus, WorkflowStatus.id == Task.status_id)
        .where(Task.parent_id.in_(ids), Task.deleted_at.is_(None))
    ):
        sub_total[pid] += 1
        sub_done[pid] += cat == "done"
    comments = _count_by(db, Comment.task_id, ids, Comment.deleted_at.is_(None))
    attachments = _count_by(db, Attachment.task_id, ids, Attachment.deleted_at.is_(None))
    ck_total = _count_by(db, ChecklistItem.task_id, ids)
    ck_done = _count_by(db, ChecklistItem.task_id, ids, ChecklistItem.done.is_(True))

    # Bloqueada: otra tarea no terminada la bloquea, o depende de una tarea no terminada.
    blocked: set[int] = set()
    open_task = (
        select(Task.id).join(WorkflowStatus, WorkflowStatus.id == Task.status_id)
        .where(WorkflowStatus.category != "done", Task.deleted_at.is_(None))
    )
    for (tid,) in db.execute(select(TaskRelation.target_task_id).where(
        TaskRelation.type == "blocks", TaskRelation.target_task_id.in_(ids), TaskRelation.source_task_id.in_(open_task))):
        blocked.add(tid)
    for (tid,) in db.execute(select(TaskRelation.source_task_id).where(
        TaskRelation.type == "depends_on", TaskRelation.source_task_id.in_(ids), TaskRelation.target_task_id.in_(open_task))):
        blocked.add(tid)

    out = []
    for t in tasks:
        st = statuses.get(t.status_id)
        out.append(TaskOut.model_validate(t).model_copy(update={
            "project_key": project_keys.get(t.project_id, ""),
            "key": f"{project_keys.get(t.project_id, '')}-{t.number}",
            "status": StatusOut.model_validate(st) if st else None,
            "assignee": UserBrief.model_validate(users[t.assignee_id]) if t.assignee_id in users else None,
            "reporter": UserBrief.model_validate(users[t.reporter_id]) if t.reporter_id in users else None,
            "labels": labels.get(t.id, []),
            "team": TeamBrief.model_validate(teams[t.team_id]) if t.team_id in teams else None,
            "subtask_count": sub_total.get(t.id, 0), "subtask_done": sub_done.get(t.id, 0),
            "comment_count": comments.get(t.id, 0), "attachment_count": attachments.get(t.id, 0),
            "checklist_total": ck_total.get(t.id, 0), "checklist_done": ck_done.get(t.id, 0),
            "blocked": t.id in blocked and (st is None or st.category != "done"),
        }))
    return out


def _related(db: Session, task: Task) -> RelatedTask:
    key = db.scalar(select(Project.key).where(Project.id == task.project_id))
    st = db.get(WorkflowStatus, task.status_id)
    return RelatedTask(id=task.id, key=f"{key}-{task.number}", title=task.title,
                       status=StatusOut.model_validate(st) if st else None)


def task_detail(db: Session, ctx: OrgCtx, task: Task, project: Project, role: str) -> TaskDetail:
    base = serialize_tasks(db, [task])[0]
    watchers = db.scalars(select(User).join(TaskWatcher, TaskWatcher.user_id == User.id).where(TaskWatcher.task_id == task.id)).all()
    subtasks = db.scalars(select(Task).where(Task.parent_id == task.id, Task.deleted_at.is_(None), Task.organization_id == ctx.org_id).order_by(Task.position, Task.id)).all()
    checklist = db.scalars(select(ChecklistItem).where(ChecklistItem.task_id == task.id).order_by(ChecklistItem.position, ChecklistItem.id)).all()
    spent = db.scalar(select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(TimeEntry.task_id == task.id))

    visible = set(accessible_project_ids(db, ctx))
    relations = []
    for rel in db.scalars(select(TaskRelation).where(
            TaskRelation.organization_id == ctx.org_id,
            or_(TaskRelation.source_task_id == task.id, TaskRelation.target_task_id == task.id))):
        direction = "outgoing" if rel.source_task_id == task.id else "incoming"
        other = db.get(Task, rel.target_task_id if direction == "outgoing" else rel.source_task_id)
        if not other or other.deleted_at or other.project_id not in visible:
            continue
        relations.append(RelationOut(id=rel.id, type=rel.type, direction=direction,
                                     label=RELATION_LABELS[(rel.type, direction)], task=_related(db, other)))
    parent = db.get(Task, task.parent_id) if task.parent_id else None
    return TaskDetail(
        **base.model_dump(),
        description=task.description,
        watchers=[UserBrief.model_validate(u) for u in watchers],
        subtasks=serialize_tasks(db, list(subtasks)),
        checklist=[ChecklistItemOut.model_validate(c) for c in checklist],
        relations=relations,
        time_spent_minutes=int(spent or 0),
        parent=_related(db, parent) if parent and not parent.deleted_at else None,
        my_role=role,
        permissions=permissions_for(role),
        capabilities=sorted(task_capabilities(db, ctx, task, role)),
        in_qa=db.scalar(select(TaskResolutionCycle.id).where(TaskResolutionCycle.task_id == task.id,
                                                             TaskResolutionCycle.status == "in_qa")) is not None,
    )


# ---- Validación de referencias --------------------------------------------------------


def _can_view_project(db: Session, org_id: int, project: Project, user_id: int) -> bool:
    m = db.scalar(select(Membership).where(Membership.organization_id == org_id, Membership.user_id == user_id))
    if not m:
        return False
    from app.api.deps import OrgCtx as _Ctx

    user = db.get(User, user_id)
    return project_role(db, _Ctx(org_id=org_id, user=user, role=m.role), project) is not None


def _validate_refs(db: Session, ctx: OrgCtx, project: Project, values: dict, task: Task | None = None) -> None:
    def same_project(model, obj_id, what):
        if obj_id is None:
            return
        ok = db.scalar(select(model.id).where(model.id == obj_id, model.organization_id == ctx.org_id, model.project_id == project.id))
        if not ok:
            raise HTTPException(400, f"{what} no válido para este proyecto")

    if "status_id" in values:
        if values["status_id"] is None:
            raise HTTPException(400, "El estado es obligatorio")
        same_project(WorkflowStatus, values["status_id"], "Estado")
    if values.get("team_id") is not None and values["team_id"] not in project_team_ids(db, project.id):
        raise HTTPException(400, "El equipo no tiene acceso a este proyecto")
    same_project(Milestone, values.get("milestone_id"), "Hito")
    same_project(Sprint, values.get("sprint_id"), "Sprint")
    if values.get("assignee_id") is not None and not _can_view_project(db, ctx.org_id, project, values["assignee_id"]):
        raise HTTPException(400, "El responsable no tiene acceso a este proyecto")
    parent_id = values.get("parent_id")
    if parent_id is not None:
        parent = db.scalar(select(Task).where(Task.id == parent_id, Task.organization_id == ctx.org_id,
                                             Task.project_id == project.id, Task.deleted_at.is_(None)))
        if not parent:
            raise HTTPException(400, "Tarea padre no válida")
        if task:
            # Evita ciclos padre-hijo.
            cursor = parent
            while cursor:
                if cursor.id == task.id:
                    raise HTTPException(400, "Una tarea no puede ser descendiente de sí misma")
                cursor = db.get(Task, cursor.parent_id) if cursor.parent_id else None
    sd = values.get("start_date", task.start_date if task else None)
    dd = values.get("due_date", task.due_date if task else None)
    if sd and dd and sd > dd:
        raise HTTPException(400, "La fecha de inicio no puede ser posterior a la fecha límite")


def _set_labels(db: Session, ctx: OrgCtx, project: Project, task: Task, label_ids: list[int]) -> None:
    valid = set(db.scalars(select(Label.id).where(Label.id.in_(label_ids or [0]), Label.project_id == project.id,
                                                  Label.organization_id == ctx.org_id)))
    if label_ids and valid != set(label_ids):
        raise HTTPException(400, "Etiqueta no válida para este proyecto")
    db.execute(delete(TaskLabel).where(TaskLabel.task_id == task.id))
    for lid in valid:
        db.add(TaskLabel(organization_id=ctx.org_id, task_id=task.id, label_id=lid))


def _add_watcher(db: Session, org_id: int, task_id: int, user_id: int | None) -> None:
    if user_id and not db.scalar(select(TaskWatcher.id).where(TaskWatcher.task_id == task_id, TaskWatcher.user_id == user_id)):
        db.add(TaskWatcher(organization_id=org_id, task_id=task_id, user_id=user_id))


def _watcher_ids(db: Session, task_id: int) -> list[int]:
    return list(db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == task_id)))


def _apply_completion(db: Session, task: Task) -> None:
    cat = db.scalar(select(WorkflowStatus.category).where(WorkflowStatus.id == task.status_id))
    if cat == "done" and not task.completed_at:
        task.completed_at = utcnow()
    elif cat != "done":
        task.completed_at = None


# ---- Reglas compartidas -----------------------------------------------------------------


def _category(db: Session, status_id: int) -> str | None:
    return db.scalar(select(WorkflowStatus.category).where(WorkflowStatus.id == status_id))


def check_capacity(db: Session, org_id: int, user_id: int | None, exclude_task_id: int | None = None) -> None:
    """Límite de tareas simultáneas en progreso. Bloquea la fila del usuario para serializar operaciones concurrentes."""
    if not user_id:
        return
    db.execute(select(User.id).where(User.id == user_id).with_for_update())
    limit = db.scalar(select(Organization.wip_limit).where(Organization.id == org_id)) or 4
    q = (select(func.count(Task.id)).join(WorkflowStatus, WorkflowStatus.id == Task.status_id)
         .where(Task.organization_id == org_id, Task.assignee_id == user_id, Task.deleted_at.is_(None),
                WorkflowStatus.category == "in_progress"))
    if exclude_task_id:
        q = q.where(Task.id != exclude_task_id)
    if (db.scalar(q) or 0) >= limit:
        raise HTTPException(409, f"Capacidad completa: ya tiene {limit} tareas en progreso. Termina o pausa una antes de iniciar otra.")


def _on_status_change(db: Session, ctx: OrgCtx, task: Task, project: Project, old_status: int) -> None:
    old_cat, new_cat = _category(db, old_status), _category(db, task.status_id)
    if new_cat == "in_progress" and old_cat != "in_progress":
        check_capacity(db, ctx.org_id, task.assignee_id, exclude_task_id=task.id)
    if old_cat == "done" and new_cat != "done":
        # Reapertura: el ciclo aceptado deja de valer y sus logros se revocan.
        cycle = db.scalar(select(TaskResolutionCycle).where(TaskResolutionCycle.task_id == task.id,
                                                            TaskResolutionCycle.status == "accepted")
                          .order_by(TaskResolutionCycle.number.desc()))
        if cycle:
            revoke_cycle_achievements(db, cycle, "Tarea reabierta")
    _apply_completion(db, task)


def eligible_assignee(db: Session, ctx: OrgCtx, task: Task, project: Project, user_id: int) -> None:
    if not _can_view_project(db, ctx.org_id, project, user_id):
        raise HTTPException(400, "El responsable no tiene acceso a este proyecto")
    if task.team_id and not is_team_member(db, task.team_id, user_id):
        raise HTTPException(400, "El responsable debe pertenecer al equipo de la tarea")


def reassign(db: Session, ctx: OrgCtx, task: Task, project: Project, new_user: int | None, reason: str) -> None:
    if new_user == task.assignee_id:
        return
    if new_user is not None:
        eligible_assignee(db, ctx, task, project, new_user)
        if _category(db, task.status_id) == "in_progress":
            check_capacity(db, ctx.org_id, new_user, exclude_task_id=task.id)
    old = task.assignee_id
    task.assignee_id = new_user
    db.add(TaskAssignmentHistory(organization_id=ctx.org_id, task_id=task.id, team_id=task.team_id, from_user_id=old,
                                 to_user_id=new_user, changed_by_id=ctx.user.id, reason=reason or ""))
    key = f"{project.key}-{task.number}"
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="reassigned", entity_type="task", entity_id=task.id,
                 project_id=project.id, task_id=task.id, changes={"assignee_id": [old, new_user], "reason": reason})
    if new_user:
        _add_watcher(db, ctx.org_id, task.id, new_user)
        notify(db, org_id=ctx.org_id, user_ids=[new_user], actor_id=ctx.user.id, type_="assigned",
               title=f"{ctx.user.full_name} te asignó {key}", body=reason or task.title, task_id=task.id, project_id=project.id)
    if old:
        notify(db, org_id=ctx.org_id, user_ids=[old], actor_id=ctx.user.id, type_="unassigned",
               title=f"{key} fue reasignada", body=reason or task.title, task_id=task.id, project_id=project.id)


# ---- Tareas ---------------------------------------------------------------------------

SORTS = {
    "position": (Task.position, Task.id),
    "created": (Task.created_at.desc(),),
    "updated": (Task.updated_at.desc(),),
    "due": (Task.due_date.is_(None), Task.due_date),
    "priority": (func.field(Task.priority, "urgent", "high", "medium", "low", "none"),),
    "title": (Task.title,),
    "number": (Task.number.desc(),),
}


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    project_id: int | None = None,
    status_id: int | None = None,
    assignee_id: int | None = None,
    unassigned: bool = False,
    team_id: int | None = None,
    status_category: str | None = Query(default=None, max_length=60),
    type: str | None = None,
    priority: str | None = None,
    label_id: int | None = None,
    sprint_id: int | None = None,
    milestone_id: int | None = None,
    parent_id: int | None = None,
    top_level: bool = False,
    q: str | None = Query(default=None, max_length=100),
    due_from: date | None = None,
    due_to: date | None = None,
    include_done: bool = True,
    include_deleted: bool = True,
    sort: str = "position",
    limit: int = Query(default=500, le=1000),
    offset: int = Query(default=0, ge=0),
    ctx: OrgCtx = Depends(get_org_ctx),
    db: Session = Depends(get_db),
):
    if project_id is not None:
        load_project(db, ctx, project_id)
        project_ids = [project_id]
    else:
        project_ids = accessible_project_ids(db, ctx)
    if not project_ids:
        return []
    # Borradas: sólo las ve quien las borró (aparecen tachadas con la cinta «Eliminada»).
    deleted_cond = Task.deleted_at.is_(None)
    if include_deleted:
        deleted_cond = or_(Task.deleted_at.is_(None), Task.deleted_by_id == ctx.user.id)
    stmt = select(Task).where(Task.organization_id == ctx.org_id, Task.project_id.in_(project_ids), deleted_cond)
    vis = task_visibility_clause(db, ctx)
    if vis is not None:
        stmt = stmt.where(or_(vis, Task.deleted_by_id == ctx.user.id))
    if status_id:
        stmt = stmt.where(Task.status_id == status_id)
    if assignee_id:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    if unassigned:
        stmt = stmt.where(Task.assignee_id.is_(None))
    if team_id:
        stmt = stmt.where(Task.team_id == team_id)
    if status_category:
        stmt = stmt.where(Task.status_id.in_(select(WorkflowStatus.id).where(WorkflowStatus.category.in_(status_category.split(",")))))
    if type:
        stmt = stmt.where(Task.type.in_(type.split(",")))
    if priority:
        stmt = stmt.where(Task.priority.in_(priority.split(",")))
    if label_id:
        stmt = stmt.where(Task.id.in_(select(TaskLabel.task_id).where(TaskLabel.label_id == label_id)))
    if sprint_id:
        stmt = stmt.where(Task.sprint_id == sprint_id)
    if milestone_id:
        stmt = stmt.where(Task.milestone_id == milestone_id)
    if parent_id:
        stmt = stmt.where(Task.parent_id == parent_id)
    if top_level:
        stmt = stmt.where(Task.parent_id.is_(None))
    if q:
        like = f"%{q.strip()}%"
        num = q.strip().split("-")[-1]
        conds = [Task.title.like(like)]
        if num.isdigit():
            conds.append(Task.number == int(num))
        stmt = stmt.where(or_(*conds))
    if due_from:
        stmt = stmt.where(Task.due_date >= due_from)
    if due_to:
        stmt = stmt.where(Task.due_date <= due_to)
    if not include_done:
        stmt = stmt.where(Task.status_id.in_(select(WorkflowStatus.id).where(WorkflowStatus.category != "done")))
    order = SORTS.get(sort, SORTS["position"])
    if sort == "priority" and db.bind.dialect.name != "mysql":
        order = (Task.priority,)
    tasks = db.scalars(stmt.order_by(*order).offset(offset).limit(limit)).all()
    return serialize_tasks(db, list(tasks))


@router.post("/tasks", response_model=TaskDetail, status_code=201)
def create_task(data: TaskCreate, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    project, role = load_project(db, ctx, data.project_id, "create")
    # Bloqueo de fila para asignar el número correlativo sin carreras.
    project = db.scalar(select(Project).where(Project.id == project.id).with_for_update())
    values = data.model_dump(exclude={"label_ids", "watcher_ids", "project_id"})
    if values["status_id"] is None:
        values["status_id"] = db.scalar(select(WorkflowStatus.id).where(WorkflowStatus.project_id == project.id)
                                        .order_by(WorkflowStatus.position).limit(1))
    linked = project_team_ids(db, project.id)
    if values.get("team_id") is None and role != "manager":
        # Por defecto, el equipo del creador dentro del proyecto (si sólo pertenece a uno).
        mine = [t for t in linked if is_team_member(db, t, ctx.user.id)]
        values["team_id"] = mine[0] if len(mine) == 1 else None
    _validate_refs(db, ctx, project, values)
    # Integrantes: sólo pueden asignarse la tarea a sí mismos al crearla. Gerentes y líderes del equipo, a cualquiera elegible.
    assignee = values.get("assignee_id")
    is_lead = values.get("team_id") in led_team_ids(db, ctx.org_id, ctx.user.id)
    if assignee and assignee != ctx.user.id and role != "manager" and not is_lead:
        raise forbidden("Sólo el líder del equipo o un gerente pueden asignar tareas a otras personas")
    values["description"] = clean_html(values["description"])
    project.task_seq += 1
    max_pos = db.scalar(select(func.max(Task.position)).where(Task.project_id == project.id, Task.status_id == values["status_id"])) or 0
    task = Task(organization_id=ctx.org_id, project_id=project.id, number=project.task_seq, reporter_id=ctx.user.id,
                position=max_pos + 1024, **values)
    if assignee:
        eligible_assignee(db, ctx, task, project, assignee)
        if _category(db, task.status_id) == "in_progress":
            check_capacity(db, ctx.org_id, assignee)
    db.add(task)
    db.flush()
    _apply_completion(db, task)
    if data.label_ids:
        _set_labels(db, ctx, project, task, data.label_ids)
    for uid in {ctx.user.id, task.assignee_id, *data.watcher_ids}:
        if uid and _can_view_project(db, ctx.org_id, project, uid):
            _add_watcher(db, ctx.org_id, task.id, uid)
    if assignee:
        db.add(TaskAssignmentHistory(organization_id=ctx.org_id, task_id=task.id, team_id=task.team_id, from_user_id=None,
                                     to_user_id=assignee, changed_by_id=ctx.user.id, reason="Asignación inicial"))
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="created", entity_type="task", entity_id=task.id,
                 project_id=project.id, task_id=task.id, changes={"title": [None, task.title]})
    if task.assignee_id:
        notify(db, org_id=ctx.org_id, user_ids=[task.assignee_id], actor_id=ctx.user.id, type_="assigned",
               title=f"{ctx.user.full_name} te asignó {project.key}-{task.number}", body=task.title,
               task_id=task.id, project_id=project.id)
    emit_org(db, ctx.org_id, "task.created", project_id=project.id, task_id=task.id)
    db.commit()
    return task_detail(db, ctx, task, project, role)


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def get_task(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, role = load_task(db, ctx, task_id, include_deleted=True)
    return task_detail(db, ctx, task, project, role)


@router.patch("/tasks/{task_id}", response_model=TaskDetail)
def update_task(task_id: int, data: TaskUpdate, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, role = load_task(db, ctx, task_id)
    caps = task_capabilities(db, ctx, task, role)
    values = data.model_dump(exclude_unset=True)
    label_ids = values.pop("label_ids", None)
    if "assignee_id" in values:
        new_assignee = values.pop("assignee_id")
        if new_assignee != task.assignee_id:
            if "assign" not in caps:
                raise forbidden("Sólo el líder del equipo responsable o un gerente pueden cambiar el responsable")
            reassign(db, ctx, task, project, new_assignee, "")
    if "status_id" in values and values["status_id"] != task.status_id and "status" not in caps:
        raise forbidden("No puedes cambiar el estado de esta tarea")
    field_changes = {k for k in values if k != "status_id"} | ({"labels"} if label_ids is not None else set())
    if field_changes and "edit" not in caps:
        raise forbidden("Sólo el creador, el líder del equipo o un gerente pueden editar esta tarea")
    _validate_refs(db, ctx, project, values, task)
    if "description" in values:
        values["description"] = clean_html(values["description"])
    changes = diff(task, values)
    if "description" in changes:
        changes["description"] = ["…", "…"]  # no duplicar textos largos en la auditoría
    old_status = task.status_id
    for k, v in values.items():
        setattr(task, k, v)
    if "due_date" in changes:
        task.due_reminder_sent_at = None
    if label_ids is not None:
        before = set(db.scalars(select(TaskLabel.label_id).where(TaskLabel.task_id == task.id)))
        _set_labels(db, ctx, project, task, label_ids)
        if before != set(label_ids):
            changes["labels"] = [sorted(before), sorted(label_ids)]
    key = f"{project.key}-{task.number}"
    if "status_id" in changes:
        _on_status_change(db, ctx, task, project, old_status)
        new_status = db.get(WorkflowStatus, task.status_id)
        old = db.get(WorkflowStatus, old_status)
        changes["status_id"] = [old.name if old else old_status, new_status.name]
        notify(db, org_id=ctx.org_id, user_ids=_watcher_ids(db, task.id), actor_id=ctx.user.id, type_="status_changed",
               title=f"{key} pasó a {new_status.name}", body=task.title, task_id=task.id, project_id=project.id)
    if changes:
        task.updated_at = utcnow()
        log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="updated", entity_type="task", entity_id=task.id,
                     project_id=project.id, task_id=task.id, changes=changes)
    emit_org(db, ctx.org_id, "task.updated", project_id=project.id, task_id=task.id)
    db.commit()
    return task_detail(db, ctx, task, project, role)


@router.post("/tasks/{task_id}/move", response_model=TaskOut)
def move_task(task_id: int, data: TaskMove, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    """Mover en el Kanban: cambia estado y posición en una sola operación."""
    task, project, _ = load_task(db, ctx, task_id, "status")
    _validate_refs(db, ctx, project, {"status_id": data.status_id}, task)
    old_status = task.status_id
    task.position = data.position
    if old_status != data.status_id:
        task.status_id = data.status_id
        _on_status_change(db, ctx, task, project, old_status)
        old = db.get(WorkflowStatus, old_status)
        new = db.get(WorkflowStatus, data.status_id)
        log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="updated", entity_type="task", entity_id=task.id,
                     project_id=project.id, task_id=task.id, changes={"status_id": [old.name, new.name]})
        notify(db, org_id=ctx.org_id, user_ids=_watcher_ids(db, task.id), actor_id=ctx.user.id, type_="status_changed",
               title=f"{project.key}-{task.number} pasó a {new.name}", body=task.title, task_id=task.id, project_id=project.id)
    task.updated_at = utcnow()
    emit_org(db, ctx.org_id, "task.updated", project_id=project.id, task_id=task.id)
    db.commit()
    return serialize_tasks(db, [task])[0]


@router.delete("/tasks/{task_id}", response_model=Message)
def delete_task(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "delete")
    # Borrado lógico: desaparece para todos menos para quien la borró, que la ve tachada y puede restaurarla.
    task.deleted_at = utcnow()
    task.deleted_by_id = ctx.user.id
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="deleted", entity_type="task", entity_id=task.id,
                 project_id=project.id, task_id=task.id)
    emit_org(db, ctx.org_id, "task.deleted", project_id=project.id, task_id=task.id)
    db.commit()
    return Message(detail="Tarea eliminada")


@router.post("/tasks/{task_id}/restore", response_model=TaskOut)
def restore_task(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, include_deleted=True)
    if task.deleted_at is None:
        raise HTTPException(400, "La tarea no está eliminada")
    task.deleted_at = None
    task.deleted_by_id = None
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="restored", entity_type="task", entity_id=task.id,
                 project_id=project.id, task_id=task.id)
    emit_org(db, ctx.org_id, "task.updated", project_id=project.id, task_id=task.id)
    db.commit()
    return serialize_tasks(db, [task])[0]


@router.get("/tasks/{task_id}/activity", response_model=list[ActivityOut])
def task_activity(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, include_deleted=True)
    rows = db.scalars(select(ActivityLog).where(ActivityLog.organization_id == ctx.org_id, ActivityLog.task_id == task.id)
                      .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(100)).all()
    return activity_out(db, rows, project.key)


# ---- Asignación y transferencias ------------------------------------------------------


@router.post("/tasks/{task_id}/assign", response_model=TaskDetail)
def assign_task(task_id: int, data: AssignIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, role = load_task(db, ctx, task_id, "assign")
    # Bloqueo de la tarea: dos reasignaciones simultáneas se serializan.
    task = db.scalar(select(Task).where(Task.id == task.id).with_for_update())
    reassign(db, ctx, task, project, data.assignee_id, data.reason)
    task.updated_at = utcnow()
    emit_org(db, ctx.org_id, "task.assigned", project_id=project.id, task_id=task.id)
    db.commit()
    return task_detail(db, ctx, task, project, role)


@router.post("/tasks/{task_id}/transfer", response_model=TaskDetail)
def transfer_task(task_id: int, data: TransferIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, role = load_task(db, ctx, task_id, "transfer")
    task = db.scalar(select(Task).where(Task.id == task.id).with_for_update())
    if data.team_id == task.team_id:
        raise HTTPException(400, "La tarea ya pertenece a ese equipo")
    if data.team_id not in project_team_ids(db, project.id):
        raise HTTPException(400, "El equipo destino no tiene acceso a este proyecto")
    origin = task.team_id
    task.team_id = data.team_id
    db.add(TaskTeamTransfer(organization_id=ctx.org_id, task_id=task.id, from_team_id=origin, to_team_id=data.team_id,
                            transferred_by_id=ctx.user.id, reason=data.reason))
    if task.assignee_id and not is_team_member(db, data.team_id, task.assignee_id):
        reassign(db, ctx, task, project, None, f"Transferida a otro equipo: {data.reason}")
    leads = [tm.lead_id for tm in db.scalars(select(Team).where(Team.id.in_([x for x in (origin, data.team_id) if x])))]
    dest = db.get(Team, data.team_id)
    notify(db, org_id=ctx.org_id, user_ids=leads, actor_id=ctx.user.id, type_="transferred",
           title=f"{project.key}-{task.number} se transfirió a {dest.name}", body=data.reason, task_id=task.id, project_id=project.id)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="transferred", entity_type="task", entity_id=task.id,
                 project_id=project.id, task_id=task.id, changes={"team_id": [origin, data.team_id], "reason": data.reason})
    task.updated_at = utcnow()
    emit_org(db, ctx.org_id, "task.transferred", project_id=project.id, task_id=task.id)
    db.commit()
    return task_detail(db, ctx, task, project, role)


def _load_counts(db: Session, org_id: int, user_ids: list[int]) -> tuple[dict[int, int], dict[int, int]]:
    pending: dict[int, int] = defaultdict(int)
    active: dict[int, int] = defaultdict(int)
    if not user_ids:
        return pending, active
    for uid, cat in db.execute(
        select(Task.assignee_id, WorkflowStatus.category).join(WorkflowStatus, WorkflowStatus.id == Task.status_id)
        .where(Task.organization_id == org_id, Task.assignee_id.in_(user_ids), Task.deleted_at.is_(None),
               WorkflowStatus.category != "done")
    ):
        pending[uid] += 1
        active[uid] += cat == "in_progress"
    return pending, active


@router.get("/tasks/{task_id}/eligible-assignees", response_model=list[EligibleAssignee])
def eligible_assignees(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    """Personas que pueden recibir la tarea, con su carga pendiente y su capacidad en progreso."""
    task, project, _ = load_task(db, ctx, task_id)
    limit = db.scalar(select(Organization.wip_limit).where(Organization.id == ctx.org_id)) or 4
    if task.team_id:
        team = db.get(Team, task.team_id)
        ids = set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id == team.id))) | ({team.lead_id} if team.lead_id else set())
        lead = team.lead_id
    else:
        ids = {u for (u,) in db.execute(select(Membership.user_id).where(Membership.organization_id == ctx.org_id))}
        lead = None
    users = [u for u in db.scalars(select(User).where(User.id.in_(ids or {0})).order_by(User.full_name))
             if _can_view_project(db, ctx.org_id, project, u.id)]
    pending, active = _load_counts(db, ctx.org_id, [u.id for u in users])
    return [EligibleAssignee(user=UserBrief.model_validate(u), pending=pending[u.id], in_progress=active[u.id], capacity=limit,
                             at_capacity=active[u.id] >= limit, is_lead=u.id == lead) for u in users]


def _team_brief(db: Session, team_id: int | None) -> TeamBrief | None:
    t = db.get(Team, team_id) if team_id else None
    return TeamBrief.model_validate(t) if t else None


def _user_brief(db: Session, user_id: int | None) -> UserBrief | None:
    u = db.get(User, user_id) if user_id else None
    return UserBrief.model_validate(u) if u else None


@router.get("/tasks/{task_id}/assignment-history", response_model=list[AssignmentHistoryOut])
def assignment_history(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, _, _ = load_task(db, ctx, task_id, include_deleted=True)
    rows = db.scalars(select(TaskAssignmentHistory).where(TaskAssignmentHistory.task_id == task.id,
                                                          TaskAssignmentHistory.organization_id == ctx.org_id)
                      .order_by(TaskAssignmentHistory.id.desc()))
    return [AssignmentHistoryOut(id=r.id, from_user=_user_brief(db, r.from_user_id), to_user=_user_brief(db, r.to_user_id),
                                 changed_by=_user_brief(db, r.changed_by_id), team=_team_brief(db, r.team_id), reason=r.reason,
                                 created_at=r.created_at) for r in rows]


@router.get("/tasks/{task_id}/transfers", response_model=list[TransferOut])
def task_transfers(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, _, _ = load_task(db, ctx, task_id, include_deleted=True)
    rows = db.scalars(select(TaskTeamTransfer).where(TaskTeamTransfer.task_id == task.id,
                                                     TaskTeamTransfer.organization_id == ctx.org_id).order_by(TaskTeamTransfer.id.desc()))
    return [TransferOut(id=r.id, from_team=_team_brief(db, r.from_team_id), to_team=_team_brief(db, r.to_team_id),
                        transferred_by=_user_brief(db, r.transferred_by_id), reason=r.reason, created_at=r.created_at) for r in rows]


# ---- Flujo QA (ciclos de resolución) -------------------------------------------------


def _status_of(db: Session, project_id: int, category: str) -> WorkflowStatus | None:
    return db.scalar(select(WorkflowStatus).where(WorkflowStatus.project_id == project_id, WorkflowStatus.category == category)
                     .order_by(WorkflowStatus.position).limit(1))


@router.post("/tasks/{task_id}/submit-qa", response_model=TaskDetail)
def submit_qa(task_id: int, data: SubmitQAIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    """El responsable entrega a QA. Abre un ciclo de resolución; no otorga logros por sí mismo."""
    task, project, role = load_task(db, ctx, task_id)
    task = db.scalar(select(Task).where(Task.id == task.id).with_for_update())
    if task.assignee_id != ctx.user.id:
        raise forbidden("Sólo el responsable actual puede enviar la tarea a QA")
    if db.scalar(select(TaskResolutionCycle.id).where(TaskResolutionCycle.task_id == task.id, TaskResolutionCycle.status == "in_qa")):
        raise HTTPException(409, "La tarea ya está en revisión de QA")
    review = _status_of(db, project.id, "review")
    if not review:
        raise HTTPException(400, "El proyecto no tiene un estado de revisión (categoría «En revisión»)")
    number = (db.scalar(select(func.max(TaskResolutionCycle.number)).where(TaskResolutionCycle.task_id == task.id)) or 0) + 1
    cycle = TaskResolutionCycle(organization_id=ctx.org_id, project_id=project.id, task_id=task.id, team_id=task.team_id,
                                number=number, submitted_by_id=ctx.user.id, submission_note=data.note)
    db.add(cycle)
    db.flush()
    old = task.status_id
    task.status_id = review.id
    _on_status_change(db, ctx, task, project, old)
    record_contribution(db, task=task, user_id=ctx.user.id, kind="qa_submission", source_type="cycle", source_id=cycle.id,
                        cycle_id=cycle.id)
    qa_users = set()
    for t in db.scalars(select(Team).where(Team.organization_id == ctx.org_id, Team.is_qa.is_(True),
                                          Team.id.in_(project_team_ids(db, project.id) or {0}))):
        qa_users |= set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id == t.id))) | ({t.lead_id} if t.lead_id else set())
    notify(db, org_id=ctx.org_id, user_ids=qa_users, actor_id=ctx.user.id, type_="qa_requested",
           title=f"{project.key}-{task.number} lista para QA (ciclo {number})", body=data.note, task_id=task.id, project_id=project.id)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="qa_submitted", entity_type="task", entity_id=task.id,
                 project_id=project.id, task_id=task.id, changes={"cycle": [None, number]})
    task.updated_at = utcnow()
    emit_org(db, ctx.org_id, "task.updated", project_id=project.id, task_id=task.id)
    db.commit()
    return task_detail(db, ctx, task, project, role)


@router.post("/tasks/{task_id}/qa-review", response_model=TaskDetail)
def qa_review(task_id: int, data: QAReviewIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    """QA valida o rechaza el ciclo abierto. Sólo una validación con evidencia otorga reconocimientos."""
    task, project, role = load_task(db, ctx, task_id, "qa")
    task = db.scalar(select(Task).where(Task.id == task.id).with_for_update())
    cycle = db.scalar(select(TaskResolutionCycle).where(TaskResolutionCycle.task_id == task.id, TaskResolutionCycle.status == "in_qa")
                      .with_for_update())
    if not cycle:
        raise HTTPException(409, "No hay una entrega pendiente de QA")
    if cycle.submitted_by_id == ctx.user.id:
        raise forbidden("No puedes validar tu propia entrega")
    cycle.reviewed_by_id = ctx.user.id
    cycle.reviewed_at = utcnow()
    cycle.review_note = data.evidence
    old = task.status_id
    key = f"{project.key}-{task.number}"
    if data.approve:
        cycle.status = "accepted"
        task.status_id = _status_of(db, project.id, "done").id
        _on_status_change(db, ctx, task, project, old)
        record_contribution(db, task=task, user_id=ctx.user.id, kind="qa_review", source_type="cycle_review", source_id=cycle.id,
                            cycle_id=cycle.id)
        award(db, org_id=ctx.org_id, user_id=cycle.submitted_by_id, code="resolution", dedupe_key=f"resolution:{cycle.id}",
              task=task, cycle=cycle, evidence={"cycle": cycle.number, "qa_note": data.evidence, "validated_by": ctx.user.id})
        award(db, org_id=ctx.org_id, user_id=ctx.user.id, code="qa_validation", dedupe_key=f"validation:{cycle.id}",
              task=task, cycle=cycle, evidence={"cycle": cycle.number, "evidence": data.evidence})
        title = f"QA validó {key}"
    else:
        cycle.status = "rejected"
        back = _status_of(db, project.id, "in_progress") or _status_of(db, project.id, "todo")
        task.status_id = back.id
        try:
            _on_status_change(db, ctx, task, project, old)
        except HTTPException:
            task.status_id = (_status_of(db, project.id, "todo") or back).id  # sin cupo: vuelve a «Por hacer»
            _apply_completion(db, task)
        record_contribution(db, task=task, user_id=ctx.user.id, kind="qa_review", source_type="cycle_review", source_id=cycle.id,
                            cycle_id=cycle.id)
        title = f"QA rechazó {key}"
    leads = [t.lead_id for t in db.scalars(select(Team).where(Team.id == task.team_id))] if task.team_id else []
    notify(db, org_id=ctx.org_id, user_ids=[cycle.submitted_by_id, *leads], actor_id=ctx.user.id, type_="qa_reviewed",
           title=title, body=data.evidence, task_id=task.id, project_id=project.id)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="qa_approved" if data.approve else "qa_rejected",
                 entity_type="task", entity_id=task.id, project_id=project.id, task_id=task.id,
                 changes={"cycle": [None, cycle.number]})
    task.updated_at = utcnow()
    emit_org(db, ctx.org_id, "task.updated", project_id=project.id, task_id=task.id)
    db.commit()
    return task_detail(db, ctx, task, project, role)


@router.get("/tasks/{task_id}/cycles", response_model=list[CycleOut])
def task_cycles(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, _, _ = load_task(db, ctx, task_id, include_deleted=True)
    return [CycleOut(id=c.id, number=c.number, status=c.status, submitted_by=_user_brief(db, c.submitted_by_id),
                     submitted_at=c.submitted_at, submission_note=c.submission_note, reviewed_by=_user_brief(db, c.reviewed_by_id),
                     reviewed_at=c.reviewed_at, review_note=c.review_note)
            for c in db.scalars(select(TaskResolutionCycle).where(TaskResolutionCycle.task_id == task.id)
                                .order_by(TaskResolutionCycle.number.desc()))]


# ---- Checklist ------------------------------------------------------------------------


def _touch(db: Session, ctx: OrgCtx, task: Task, project: Project) -> None:
    task.updated_at = utcnow()
    emit_org(db, ctx.org_id, "task.updated", project_id=project.id, task_id=task.id)


@router.post("/tasks/{task_id}/checklist", response_model=ChecklistItemOut, status_code=201)
def add_checklist(task_id: int, data: ChecklistIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "edit")
    count = db.scalar(select(func.count()).select_from(ChecklistItem).where(ChecklistItem.task_id == task.id))
    if count >= 100:
        raise HTTPException(400, "Máximo 100 elementos por checklist")
    item = ChecklistItem(organization_id=ctx.org_id, task_id=task.id, text=data.text, position=count)
    db.add(item)
    _touch(db, ctx, task, project)
    db.commit()
    return item


def _get_item(db: Session, ctx: OrgCtx, task: Task, item_id: int) -> ChecklistItem:
    item = db.scalar(select(ChecklistItem).where(ChecklistItem.id == item_id, ChecklistItem.task_id == task.id,
                                                 ChecklistItem.organization_id == ctx.org_id))
    if not item:
        raise not_found("Elemento")
    return item


@router.patch("/tasks/{task_id}/checklist/{item_id}", response_model=ChecklistItemOut)
def update_checklist(task_id: int, item_id: int, data: ChecklistUpdate, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "edit")
    item = _get_item(db, ctx, task, item_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    _touch(db, ctx, task, project)
    db.commit()
    return item


@router.delete("/tasks/{task_id}/checklist/{item_id}", response_model=Message)
def delete_checklist(task_id: int, item_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "edit")
    db.delete(_get_item(db, ctx, task, item_id))
    _touch(db, ctx, task, project)
    db.commit()
    return Message(detail="Elemento eliminado")


# ---- Relaciones -----------------------------------------------------------------------


@router.post("/tasks/{task_id}/relations", response_model=RelationOut, status_code=201)
def add_relation(task_id: int, data: RelationIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "edit")
    target, _, _ = load_task(db, ctx, data.target_task_id, "view")
    if target.id == task.id:
        raise HTTPException(400, "Una tarea no puede relacionarse consigo misma")
    exists = db.scalar(select(TaskRelation.id).where(
        or_(
            (TaskRelation.source_task_id == task.id) & (TaskRelation.target_task_id == target.id),
            (TaskRelation.source_task_id == target.id) & (TaskRelation.target_task_id == task.id),
        ),
        TaskRelation.type == data.type,
    ))
    if exists:
        raise HTTPException(409, "La relación ya existe")
    rel = TaskRelation(organization_id=ctx.org_id, source_task_id=task.id, target_task_id=target.id, type=data.type,
                       created_by_id=ctx.user.id)
    db.add(rel)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="relation_added", entity_type="task", entity_id=task.id,
                 project_id=project.id, task_id=task.id, changes={"relation": [None, f"{data.type}:{target.id}"]})
    _touch(db, ctx, task, project)
    emit_org(db, ctx.org_id, "task.updated", project_id=target.project_id, task_id=target.id)
    db.commit()
    return RelationOut(id=rel.id, type=rel.type, direction="outgoing", label=RELATION_LABELS[(rel.type, "outgoing")],
                       task=_related(db, target))


@router.delete("/tasks/{task_id}/relations/{relation_id}", response_model=Message)
def delete_relation(task_id: int, relation_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "edit")
    rel = db.scalar(select(TaskRelation).where(
        TaskRelation.id == relation_id, TaskRelation.organization_id == ctx.org_id,
        or_(TaskRelation.source_task_id == task.id, TaskRelation.target_task_id == task.id)))
    if not rel:
        raise not_found("Relación")
    db.delete(rel)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="relation_removed", entity_type="task",
                 entity_id=task.id, project_id=project.id, task_id=task.id)
    _touch(db, ctx, task, project)
    db.commit()
    return Message(detail="Relación eliminada")


class RelationEdge(BaseModel):
    id: int
    source_task_id: int
    target_task_id: int
    type: str


@router.get("/relations", response_model=list[RelationEdge])
def project_relations(project_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    """Aristas de dependencias entre tareas de un proyecto (para el cronograma)."""
    p, _ = load_project(db, ctx, project_id)
    in_project = select(Task.id).where(Task.project_id == p.id, Task.deleted_at.is_(None))
    rows = db.scalars(select(TaskRelation).where(
        TaskRelation.organization_id == ctx.org_id,
        TaskRelation.source_task_id.in_(in_project), TaskRelation.target_task_id.in_(in_project),
        TaskRelation.type.in_(["blocks", "depends_on"])))
    return [RelationEdge.model_validate(r, from_attributes=True) for r in rows]


# ---- Registro de tiempo ---------------------------------------------------------------


def _time_out(db: Session, e: TimeEntry) -> TimeEntryOut:
    u = db.get(User, e.user_id) if e.user_id else None
    return TimeEntryOut(id=e.id, minutes=e.minutes, note=e.note, spent_on=e.spent_on, created_at=e.created_at,
                        user=UserBrief.model_validate(u) if u else None)


@router.get("/tasks/{task_id}/time-entries", response_model=list[TimeEntryOut])
def list_time(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, _, _ = load_task(db, ctx, task_id)
    rows = db.scalars(select(TimeEntry).where(TimeEntry.task_id == task.id, TimeEntry.organization_id == ctx.org_id)
                      .order_by(TimeEntry.spent_on.desc(), TimeEntry.id.desc()))
    return [_time_out(db, e) for e in rows]


@router.post("/tasks/{task_id}/time-entries", response_model=TimeEntryOut, status_code=201)
def add_time(task_id: int, data: TimeEntryIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "status")
    e = TimeEntry(organization_id=ctx.org_id, task_id=task.id, user_id=ctx.user.id, minutes=data.minutes, note=data.note,
                  spent_on=data.spent_on or date.today())
    db.add(e)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="time_logged", entity_type="task", entity_id=task.id,
                 project_id=project.id, task_id=task.id, changes={"minutes": [None, data.minutes]})
    db.flush()
    if data.minutes >= 15:
        record_contribution(db, task=task, user_id=ctx.user.id, kind="time_log", source_type="time_entry", source_id=e.id)
    _touch(db, ctx, task, project)
    db.commit()
    return _time_out(db, e)


@router.delete("/tasks/{task_id}/time-entries/{entry_id}", response_model=Message)
def delete_time(task_id: int, entry_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, role = load_task(db, ctx, task_id, "status")
    e = db.scalar(select(TimeEntry).where(TimeEntry.id == entry_id, TimeEntry.task_id == task.id, TimeEntry.organization_id == ctx.org_id))
    if not e:
        raise not_found("Registro")
    if e.user_id != ctx.user.id and role != "manager":
        raise forbidden()
    db.delete(e)
    _touch(db, ctx, task, project)
    db.commit()
    return Message(detail="Registro eliminado")


# ---- Observadores ---------------------------------------------------------------------


@router.post("/tasks/{task_id}/watchers", response_model=list[UserBrief])
def add_watcher(task_id: int, data: WatcherIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, role = load_task(db, ctx, task_id, "view")
    if data.user_id != ctx.user.id and "edit" not in task_capabilities(db, ctx, task, role):
        raise forbidden()
    if not _can_view_project(db, ctx.org_id, project, data.user_id):
        raise HTTPException(400, "El usuario no tiene acceso al proyecto")
    _add_watcher(db, ctx.org_id, task.id, data.user_id)
    _touch(db, ctx, task, project)
    db.commit()
    return [UserBrief.model_validate(u) for u in db.scalars(
        select(User).join(TaskWatcher, TaskWatcher.user_id == User.id).where(TaskWatcher.task_id == task.id))]


@router.delete("/tasks/{task_id}/watchers/{user_id}", response_model=list[UserBrief])
def remove_watcher(task_id: int, user_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, role = load_task(db, ctx, task_id, "view")
    if user_id != ctx.user.id and "edit" not in task_capabilities(db, ctx, task, role):
        raise forbidden()
    db.execute(delete(TaskWatcher).where(TaskWatcher.task_id == task.id, TaskWatcher.user_id == user_id))
    _touch(db, ctx, task, project)
    db.commit()
    return [UserBrief.model_validate(u) for u in db.scalars(
        select(User).join(TaskWatcher, TaskWatcher.user_id == User.id).where(TaskWatcher.task_id == task.id))]
