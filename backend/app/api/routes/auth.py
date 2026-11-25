from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_session, get_current_user
from app.core.config import settings
from app.core.db import get_db, utcnow
from app.core.redis import rate_limit
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_token,
    password_is_strong,
    verify_password,
)
from app.models import EmailToken, Invitation, Membership, User, UserSession
from app.schemas.auth import (
    EmailIn,
    InvitationPreview,
    LoginIn,
    MeOut,
    MeUpdate,
    OrgMembershipOut,
    RegisterIn,
    ResetPasswordIn,
    SessionOut,
    TokenIn,
    TokenOut,
)
from app.schemas.common import Message
from app.services.mailer import link, queue_email
from app.services.orgs import create_organization, pick_avatar_color

router = APIRouter(prefix="/auth", tags=["auth"])
inv_router = APIRouter(prefix="/invitations", tags=["invitations"])

REFRESH_COOKIE = "orbita_refresh"
COOKIE_PATH = "/api/v1/auth"


def _too_many(request: Request, name: str, limit: int = 10, window: int = 300) -> None:
    if not rate_limit(f"{name}:{client_ip(request)}", limit, window):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiados intentos. Inténtalo más tarde.")


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.REFRESH_TOKEN_DAYS * 86400,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        path=COOKIE_PATH,
    )


def _start_session(db: Session, user: User, request: Request, response: Response) -> TokenOut:
    refresh = new_token(48)
    sess = UserSession(
        user_id=user.id,
        refresh_token_hash=hash_token(refresh),
        user_agent=(request.headers.get("user-agent") or "")[:255],
        ip_address=client_ip(request),
        expires_at=utcnow() + timedelta(days=settings.REFRESH_TOKEN_DAYS),
    )
    db.add(sess)
    user.last_login_at = utcnow()
    db.commit()
    _set_refresh_cookie(response, refresh)
    return TokenOut(access_token=create_access_token(user.id, sess.id), expires_in=settings.ACCESS_TOKEN_MINUTES * 60)


def _issue_email_token(db: Session, user: User, purpose: str, hours: int) -> str:
    token = new_token()
    db.execute(
        update(EmailToken)
        .where(EmailToken.user_id == user.id, EmailToken.purpose == purpose, EmailToken.used_at.is_(None))
        .values(used_at=utcnow())
    )
    db.add(
        EmailToken(
            user_id=user.id, purpose=purpose, token_hash=hash_token(token), expires_at=utcnow() + timedelta(hours=hours)
        )
    )
    return token


def _consume_email_token(db: Session, token: str, purpose: str) -> EmailToken:
    et = db.scalar(select(EmailToken).where(EmailToken.token_hash == hash_token(token), EmailToken.purpose == purpose))
    if not et or et.used_at is not None or et.expires_at < utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El enlace no es válido o ha caducado")
    et.used_at = utcnow()
    return et


def send_verification(db: Session, user: User) -> None:
    token = _issue_email_token(db, user, "verify", hours=48)
    queue_email(
        user.email,
        "Confirma tu correo en Órbita",
        f"Hola {user.full_name},\n\nConfirma tu dirección de correo:\n{link('/verify-email?token=' + token)}\n",
    )


def _accept_invitation(db: Session, user: User, token: str) -> Invitation:
    inv = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    if not inv or inv.revoked_at or inv.accepted_at or inv.expires_at < utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La invitación no es válida o ha caducado")
    if inv.email.lower() != user.email.lower():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta invitación pertenece a otro correo")
    exists = db.scalar(
        select(Membership).where(Membership.organization_id == inv.organization_id, Membership.user_id == user.id)
    )
    if not exists:
        db.add(Membership(organization_id=inv.organization_id, user_id=user.id, role=inv.role))
    inv.accepted_at = utcnow()
    # Aceptar la invitación demuestra la propiedad del correo.
    if not user.email_verified_at:
        user.email_verified_at = utcnow()
    return inv


def me_out(user: User) -> MeOut:
    orgs = [
        OrgMembershipOut(
            organization_id=m.organization_id, name=m.organization.name, slug=m.organization.slug, role=m.role
        )
        for m in sorted(user.memberships, key=lambda m: m.organization.name.lower())
    ]
    return MeOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        avatar_color=user.avatar_color,
        is_platform_admin=user.is_platform_admin,
        email_verified=user.email_verified_at is not None,
        created_at=user.created_at,
        organizations=orgs,
    )


@router.post("/register", response_model=TokenOut, status_code=201)
def register(data: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    _too_many(request, "register", 10, 3600)
    email = data.email.lower()
    if not password_is_strong(data.password):
        raise HTTPException(422, "La contraseña debe tener al menos 8 caracteres, letras y números")
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una cuenta con este correo")
    user = User(
        email=email,
        full_name=data.full_name,
        password_hash=hash_password(data.password),
        avatar_color=pick_avatar_color(email),
    )
    db.add(user)
    db.flush()
    if data.invitation_token:
        _accept_invitation(db, user, data.invitation_token)
    elif data.organization_name:
        create_organization(db, user, data.organization_name)
    if not user.email_verified_at:
        send_verification(db, user)
    return _start_session(db, user, request, response)


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    _too_many(request, "login", 20, 300)
    if not rate_limit(f"login-email:{data.email.lower()}", 10, 300):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiados intentos. Inténtalo más tarde.")
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Correo o contraseña incorrectos")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "La cuenta está desactivada")
    return _start_session(db, user, request, response)


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sin sesión")
    sess = db.scalar(select(UserSession).where(UserSession.refresh_token_hash == hash_token(token)))
    if not sess or sess.revoked_at or sess.expires_at < utcnow():
        response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión expirada")
    user = db.get(User, sess.user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Cuenta no disponible")
    # Rotación: cada refresh invalida el token anterior.
    new_refresh = new_token(48)
    sess.refresh_token_hash = hash_token(new_refresh)
    sess.last_used_at = utcnow()
    db.commit()
    _set_refresh_cookie(response, new_refresh)
    return TokenOut(access_token=create_access_token(user.id, sess.id), expires_in=settings.ACCESS_TOKEN_MINUTES * 60)


@router.post("/logout", response_model=Message)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        sess = db.scalar(select(UserSession).where(UserSession.refresh_token_hash == hash_token(token)))
        if sess and not sess.revoked_at:
            sess.revoked_at = utcnow()
            db.commit()
    response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH)
    return Message(detail="Sesión cerrada")


@router.post("/verify-email", response_model=Message)
def verify_email(data: TokenIn, db: Session = Depends(get_db)):
    et = _consume_email_token(db, data.token, "verify")
    user = db.get(User, et.user_id)
    user.email_verified_at = user.email_verified_at or utcnow()
    db.commit()
    return Message(detail="Correo verificado")


@router.post("/resend-verification", response_model=Message)
def resend_verification(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _too_many(request, "resend", 5, 3600)
    if user.email_verified_at:
        return Message(detail="El correo ya está verificado")
    send_verification(db, user)
    db.commit()
    return Message(detail="Te enviamos un nuevo enlace")


@router.post("/forgot-password", response_model=Message)
def forgot_password(data: EmailIn, request: Request, db: Session = Depends(get_db)):
    _too_many(request, "forgot", 5, 900)
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if user and user.is_active:
        token = _issue_email_token(db, user, "reset", hours=1)
        queue_email(
            user.email,
            "Restablece tu contraseña de Órbita",
            f"Hola {user.full_name},\n\nPara crear una nueva contraseña abre:\n"
            f"{link('/reset-password?token=' + token)}\n\nEl enlace caduca en 1 hora.",
        )
        db.commit()
    # Respuesta idéntica exista o no la cuenta (evita enumeración de usuarios).
    return Message(detail="Si el correo existe, recibirás un enlace para restablecer la contraseña")


@router.post("/reset-password", response_model=Message)
def reset_password(data: ResetPasswordIn, db: Session = Depends(get_db)):
    if not password_is_strong(data.password):
        raise HTTPException(422, "La contraseña debe tener al menos 8 caracteres, letras y números")
    et = _consume_email_token(db, data.token, "reset")
    user = db.get(User, et.user_id)
    user.password_hash = hash_password(data.password)
    # Cerrar todas las sesiones abiertas tras el cambio de contraseña.
    db.execute(
        update(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None)).values(revoked_at=utcnow())
    )
    db.commit()
    return Message(detail="Contraseña actualizada. Ya puedes iniciar sesión.")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.refresh(user)
    return me_out(user)


@router.patch("/me", response_model=MeOut)
def update_me(data: MeUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.full_name:
        user.full_name = data.full_name
    if data.avatar_color:
        user.avatar_color = data.avatar_color
    if data.new_password:
        if not data.current_password or not verify_password(data.current_password, user.password_hash):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contraseña actual no es correcta")
        if not password_is_strong(data.new_password):
            raise HTTPException(422, "La contraseña debe tener al menos 8 caracteres, letras y números")
        user.password_hash = hash_password(data.new_password)
    db.commit()
    db.refresh(user)
    return me_out(user)


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(cs=Depends(get_current_session), db: Session = Depends(get_db)):
    user, current = cs
    rows = db.scalars(
        select(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None), UserSession.expires_at > utcnow())
        .order_by(UserSession.last_used_at.desc())
    )
    return [SessionOut.model_validate(s).model_copy(update={"current": s.id == current.id}) for s in rows]


@router.delete("/sessions/{session_id}", response_model=Message)
def revoke_session(session_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sess = db.scalar(select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user.id))
    if not sess:
        raise HTTPException(404, "Sesión no encontrada")
    sess.revoked_at = utcnow()
    db.commit()
    return Message(detail="Sesión revocada")


# ---- Invitaciones (lado del invitado) -------------------------------------------------


@inv_router.get("/{token}", response_model=InvitationPreview)
def preview_invitation(token: str, db: Session = Depends(get_db)):
    inv = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    if not inv or inv.revoked_at:
        raise HTTPException(404, "Invitación no encontrada")
    return InvitationPreview(
        organization_name=inv.organization.name,
        email=inv.email,
        role=inv.role,
        expired=inv.expires_at < utcnow(),
        accepted=inv.accepted_at is not None,
        user_exists=db.scalar(select(User.id).where(User.email == inv.email.lower())) is not None,
    )


@inv_router.post("/{token}/accept", response_model=MeOut)
def accept_invitation(token: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _accept_invitation(db, user, token)
    db.commit()
    db.refresh(user)
    return me_out(user)
