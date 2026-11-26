from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.security import decode_access_token
from app.models import Membership, User, UserSession

bearer = HTTPBearer(auto_error=False)


def authenticate_token(db: Session, token: str) -> tuple[User, UserSession] | None:
    data = decode_access_token(token)
    if not data:
        return None
    sess = db.get(UserSession, data.get("sid"))
    if not sess or sess.revoked_at is not None or sess.expires_at <= utcnow() or str(sess.user_id) != data.get("sub"):
        return None
    user = db.get(User, sess.user_id)
    if not user or not user.is_active:
        return None
    return user, sess


def get_current_session(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> tuple[User, UserSession]:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No autenticado")
    result = authenticate_token(db, creds.credentials)
    if not result:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión inválida o expirada")
    return result


def get_current_user(cs: tuple[User, UserSession] = Depends(get_current_session)) -> User:
    return cs[0]


def require_platform_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_platform_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere administrador de plataforma")
    return user


@dataclass
class OrgCtx:
    org_id: int
    user: User
    role: str  # owner | admin | pmo | member | guest

    @property
    def is_admin(self) -> bool:
        """Administra la organización (miembros, equipos, invitaciones)."""
        return self.role in ("owner", "admin")

    @property
    def is_pmo(self) -> bool:
        return self.role == "pmo"

    @property
    def is_manager(self) -> bool:
        """Gestiona todos los proyectos y tareas: propietario (CEO), administrador o PMO."""
        return self.role in ("owner", "admin", "pmo")


def get_org_ctx(org_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> OrgCtx:
    """Punto único de entrada a datos de una organización.

    Si el usuario no es miembro respondemos 404 para no revelar si la organización existe.
    """
    m = db.scalar(select(Membership).where(Membership.organization_id == org_id, Membership.user_id == user.id))
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organización no encontrada")
    return OrgCtx(org_id=org_id, user=user, role=m.role)


def require_org_manager(ctx: OrgCtx = Depends(get_org_ctx)) -> OrgCtx:
    if not ctx.is_manager:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere propietario, administrador o PMO")
    return ctx


def require_org_admin(ctx: OrgCtx = Depends(get_org_ctx)) -> OrgCtx:
    if not ctx.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere administrador de la organización")
    return ctx


def client_ip(request: Request) -> str:
    return (request.client.host if request.client else "")[:64]
