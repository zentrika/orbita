"""Administración de plataforma: sólo metadatos, nunca contenido de negocio de las empresas."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import require_platform_admin
from app.core.db import get_db, utcnow
from app.models import Membership, Organization, Project, Task, User, UserSession

router = APIRouter(prefix="/admin", tags=["platform-admin"])


class AdminOrg(BaseModel):
    id: int
    name: str
    slug: str
    plan: str
    members: int
    projects: int
    tasks: int


class AdminUser(BaseModel):
    id: int
    email: str
    full_name: str
    is_active: bool
    is_platform_admin: bool
    email_verified: bool
    organizations: int


class AdminUserUpdate(BaseModel):
    is_active: bool | None = None
    is_platform_admin: bool | None = None


@router.get("/organizations", response_model=list[AdminOrg])
def orgs(_: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    def counts(model):
        return dict(db.execute(select(model.organization_id, func.count()).group_by(model.organization_id)).all())

    members, projects, tasks = counts(Membership), counts(Project), counts(Task)
    return [AdminOrg(id=o.id, name=o.name, slug=o.slug, plan=o.plan, members=members.get(o.id, 0),
                     projects=projects.get(o.id, 0), tasks=tasks.get(o.id, 0))
            for o in db.scalars(select(Organization).order_by(Organization.created_at.desc()))]


@router.get("/users", response_model=list[AdminUser])
def users(q: str | None = Query(None, max_length=100), _: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    stmt = select(User).order_by(User.created_at.desc()).limit(200)
    if q:
        stmt = stmt.where(User.email.like(f"%{q}%") | User.full_name.like(f"%{q}%"))
    return [AdminUser(id=u.id, email=u.email, full_name=u.full_name, is_active=u.is_active,
                      is_platform_admin=u.is_platform_admin, email_verified=u.email_verified_at is not None,
                      organizations=len(u.memberships)) for u in db.scalars(stmt)]


@router.patch("/users/{user_id}", response_model=AdminUser)
def update_user(user_id: int, data: AdminUserUpdate, admin: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "Usuario no encontrado")
    if u.id == admin.id and (data.is_active is False or data.is_platform_admin is False):
        raise HTTPException(400, "No puedes desactivarte ni quitarte el rol a ti mismo")
    if data.is_active is not None:
        u.is_active = data.is_active
        if not data.is_active:
            db.execute(update(UserSession).where(UserSession.user_id == u.id, UserSession.revoked_at.is_(None))
                       .values(revoked_at=utcnow()))
    if data.is_platform_admin is not None:
        u.is_platform_admin = data.is_platform_admin
    db.commit()
    return AdminUser(id=u.id, email=u.email, full_name=u.full_name, is_active=u.is_active,
                     is_platform_admin=u.is_platform_admin, email_verified=u.email_verified_at is not None,
                     organizations=len(u.memberships))
