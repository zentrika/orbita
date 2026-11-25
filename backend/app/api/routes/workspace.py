"""Panel principal, Mi trabajo, búsqueda y notificaciones."""

from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from app.api.deps import OrgCtx, get_org_ctx
from app.api.permissions import accessible_project_ids, not_found, task_visibility_clause
from app.api.routes.projects import activity_out
from app.api.routes.tasks import serialize_tasks
from app.core.db import get_db, utcnow
from app.models import ActivityLog, Notification, Project, Task, User, WorkflowStatus
from app.schemas.common import Message, UserBrief
from app.schemas.project import ActivityOut
from app.schemas.task import NotificationOut, TaskOut

router = APIRouter(prefix="/orgs/{org_id}", tags=["workspace"])


class WorkloadRow(BaseModel):
    user: UserBrief | None
    open: int
    overdue: int
    estimate_minutes: int


class ProjectProgress(BaseModel):
    id: int
    key: str
    name: str
    color: str
    status: str
    total: int
    done: int
    overdue: int
    progress: int


class Dashboard(BaseModel):
    open_tasks: int
    overdue_tasks: int
    due_this_week: int
    completed_last_7_days: int
    in_review: int
    blocked: int
    by_status: dict[str, int]
    by_priority: dict[str, int]
    workload: list[WorkloadRow]
    projects: list[ProjectProgress]
    my_open: list[TaskOut]
    recent_activity: list[ActivityOut]


@router.get("/dashboard", response_model=Dashboard)
def dashboard(project_id: int | None = None, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    ids = accessible_project_ids(db, ctx)
    if project_id is not None:
        if project_id not in ids:
            raise not_found("Proyecto")
        ids = [project_id]
    today = date.today()
    base = (
        select(Task, WorkflowStatus.category)
        .join(WorkflowStatus, WorkflowStatus.id == Task.status_id)
        .where(Task.organization_id == ctx.org_id, Task.project_id.in_(ids or [0]), Task.deleted_at.is_(None))
    )
    vis = task_visibility_clause(db, ctx)
    if vis is not None:
        base = base.where(vis)
    rows = db.execute(base).all()

    by_status: dict[str, int] = defaultdict(int)
    by_priority: dict[str, int] = defaultdict(int)
    load: dict[int | None, list[int]] = defaultdict(lambda: [0, 0, 0])
    proj: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])
    open_n = overdue = week = done7 = review = blocked = 0
    for t, cat in rows:
        by_status[cat] += 1
        p = proj[t.project_id]
        p[0] += 1
        if cat == "done":
            p[1] += 1
            if t.completed_at and t.completed_at.date() >= today - timedelta(days=7):
                done7 += 1
            continue
        open_n += 1
        by_priority[t.priority] += 1
        review += cat == "review"
        blocked += cat == "blocked"
        late = t.due_date is not None and t.due_date < today
        overdue += late
        p[2] += late
        if t.due_date and today <= t.due_date <= today + timedelta(days=7):
            week += 1
        w = load[t.assignee_id]
        w[0] += 1
        w[1] += late
        w[2] += t.estimate_minutes or 0

    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_([k for k in load if k])))} if load else {}
    workload = sorted(
        (WorkloadRow(user=UserBrief.model_validate(users[uid]) if uid in users else None, open=v[0], overdue=v[1], estimate_minutes=v[2])
         for uid, v in load.items()),
        key=lambda r: -r.open,
    )
    projects = db.scalars(select(Project).where(Project.id.in_(ids or [0])).order_by(Project.name)).all()
    progress = [
        ProjectProgress(id=p.id, key=p.key, name=p.name, color=p.color, status=p.status, total=proj[p.id][0], done=proj[p.id][1],
                        overdue=proj[p.id][2], progress=round(proj[p.id][1] * 100 / proj[p.id][0]) if proj[p.id][0] else 0)
        for p in projects
    ]
    mine = [t for t, cat in rows if t.assignee_id == ctx.user.id and cat != "done"]
    mine.sort(key=lambda t: (t.due_date is None, t.due_date or today))
    activity = db.scalars(
        select(ActivityLog).where(ActivityLog.organization_id == ctx.org_id, ActivityLog.project_id.in_(ids or [0]))
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(15)
    ).all()
    return Dashboard(
        open_tasks=open_n, overdue_tasks=overdue, due_this_week=week, completed_last_7_days=done7, in_review=review,
        blocked=blocked, by_status=dict(by_status), by_priority=dict(by_priority), workload=workload, projects=progress,
        my_open=serialize_tasks(db, mine[:8]), recent_activity=activity_out(db, activity),
    )


@router.get("/my-work", response_model=list[TaskOut])
def my_work(include_done: bool = False, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    ids = accessible_project_ids(db, ctx)
    stmt = select(Task).where(Task.organization_id == ctx.org_id, Task.project_id.in_(ids or [0]),
                              Task.assignee_id == ctx.user.id, Task.deleted_at.is_(None))
    if not include_done:
        stmt = stmt.where(Task.status_id.in_(select(WorkflowStatus.id).where(WorkflowStatus.category != "done")))
    tasks = db.scalars(stmt.order_by(case((Task.due_date.is_(None), 1), else_=0), Task.due_date, Task.id)).all()
    return serialize_tasks(db, list(tasks))


class SearchResult(BaseModel):
    tasks: list[TaskOut]
    projects: list[dict]


@router.get("/search", response_model=SearchResult)
def search(q: str = Query(min_length=1, max_length=100), ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    ids = accessible_project_ids(db, ctx)
    like = f"%{q.strip()}%"
    projects = db.scalars(select(Project).where(Project.id.in_(ids or [0]),
                                                (Project.name.like(like)) | (Project.key.like(like))).limit(5)).all()
    num = q.strip().split("-")[-1]
    cond = Task.title.like(like)
    if num.isdigit():
        cond = cond | (Task.number == int(num))
    stmt = select(Task).where(Task.organization_id == ctx.org_id, Task.project_id.in_(ids or [0]), Task.deleted_at.is_(None), cond)
    vis = task_visibility_clause(db, ctx)
    if vis is not None:
        stmt = stmt.where(vis)
    tasks = db.scalars(stmt.order_by(Task.updated_at.desc()).limit(10)).all()
    return SearchResult(tasks=serialize_tasks(db, list(tasks)),
                        projects=[{"id": p.id, "key": p.key, "name": p.name, "color": p.color} for p in projects])


# ---- Notificaciones -------------------------------------------------------------------


class NotificationList(BaseModel):
    items: list[NotificationOut]
    unread: int


@router.get("/notifications", response_model=NotificationList)
def list_notifications(unread_only: bool = False, limit: int = Query(50, le=200), ctx: OrgCtx = Depends(get_org_ctx),
                       db: Session = Depends(get_db)):
    base = select(Notification).where(Notification.organization_id == ctx.org_id, Notification.user_id == ctx.user.id)
    if unread_only:
        base = base.where(Notification.read_at.is_(None))
    rows = db.scalars(base.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)).all()
    actors = {u.id: u for u in db.scalars(select(User).where(User.id.in_({n.actor_id for n in rows if n.actor_id} or {0})))}
    unread = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.organization_id == ctx.org_id, Notification.user_id == ctx.user.id, Notification.read_at.is_(None)))
    items = [NotificationOut.model_validate(n).model_copy(update={
        "actor": UserBrief.model_validate(actors[n.actor_id]) if n.actor_id in actors else None}) for n in rows]
    return NotificationList(items=items, unread=unread)


@router.post("/notifications/{notification_id}/read", response_model=Message)
def mark_read(notification_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    n = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.organization_id == ctx.org_id,
                                             Notification.user_id == ctx.user.id))
    if not n:
        raise not_found("Notificación")
    n.read_at = n.read_at or utcnow()
    db.commit()
    return Message(detail="ok")


@router.post("/notifications/read-all", response_model=Message)
def mark_all_read(ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.organization_id == ctx.org_id, Notification.user_id == ctx.user.id,
                                          Notification.read_at.is_(None)).values(read_at=utcnow()))
    db.commit()
    return Message(detail="ok")
