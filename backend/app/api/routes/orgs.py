from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import OrgCtx, get_current_user, get_org_ctx, require_org_admin, require_org_manager
from app.core.config import settings
from app.core.db import get_db, utcnow
from app.core.security import hash_token, new_token
from app.models import Invitation, Membership, Organization, OrgHoliday, ProjectMember, Team, TeamMember, User, UserAbsence
from app.schemas.common import Message, UserBrief
from app.schemas.org import (
    InvitationCreate,
    InvitationCreated,
    InvitationOut,
    MemberOut,
    MemberUpdate,
    OrgCreate,
    OrgOut,
    OrgUpdate,
    AbsenceIn,
    AbsenceOut,
    HolidayIn,
    HolidayOut,
    TeamIn,
    TeamOut,
    TeamUpdate,
)
from app.services.audit import log_activity
from app.services.mailer import link, queue_email
from app.services.notifications import notify
from app.services.orgs import create_organization

router = APIRouter(prefix="/orgs", tags=["organizations"])


@router.get("", response_model=list[OrgOut])
def list_orgs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Organization, Membership.role)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.name)
    ).all()
    return [OrgOut.model_validate(o).model_copy(update={"my_role": r}) for o, r in rows]


@router.post("", response_model=OrgOut, status_code=201)
def create_org(data: OrgCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    owned = db.scalar(select(func.count()).select_from(Membership).where(Membership.user_id == user.id, Membership.role == "owner"))
    if owned >= 20:
        raise HTTPException(400, "Has alcanzado el límite de organizaciones")
    org = create_organization(db, user, data.name)
    db.commit()
    return OrgOut.model_validate(org).model_copy(update={"my_role": "owner"})


@router.get("/{org_id}", response_model=OrgOut)
def get_org(ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    org = db.get(Organization, ctx.org_id)
    return OrgOut.model_validate(org).model_copy(update={"my_role": ctx.role})


@router.patch("/{org_id}", response_model=OrgOut)
def update_org(data: OrgUpdate, ctx: OrgCtx = Depends(require_org_admin), db: Session = Depends(get_db)):
    org = db.get(Organization, ctx.org_id)
    if data.name:
        org.name = data.name
    if data.timezone:
        from zoneinfo import ZoneInfo

        try:
            ZoneInfo(data.timezone)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(422, "Zona horaria no válida") from exc
        org.timezone = data.timezone
    if data.workdays:
        org.workdays = data.workdays
    if data.wip_limit:
        org.wip_limit = data.wip_limit
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="updated", entity_type="organization", entity_id=org.id)
    db.commit()
    return OrgOut.model_validate(org).model_copy(update={"my_role": ctx.role})


# ---- Miembros -------------------------------------------------------------------------


def _member_out(m: Membership) -> MemberOut:
    return MemberOut(user=UserBrief.model_validate(m.user), role=m.role, title=m.title, joined_at=m.created_at)


@router.get("/{org_id}/members", response_model=list[MemberOut])
def list_members(ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    rows = db.scalars(select(Membership).where(Membership.organization_id == ctx.org_id))
    return sorted((_member_out(m) for m in rows), key=lambda x: x.user.full_name.lower())


def _get_membership(db: Session, ctx: OrgCtx, user_id: int) -> Membership:
    m = db.scalar(select(Membership).where(Membership.organization_id == ctx.org_id, Membership.user_id == user_id))
    if not m:
        raise HTTPException(404, "Miembro no encontrado")
    return m


def _owner_count(db: Session, org_id: int) -> int:
    return db.scalar(
        select(func.count()).select_from(Membership).where(Membership.organization_id == org_id, Membership.role == "owner")
    )


@router.patch("/{org_id}/members/{user_id}", response_model=MemberOut)
def update_member(user_id: int, data: MemberUpdate, ctx: OrgCtx = Depends(require_org_admin), db: Session = Depends(get_db)):
    m = _get_membership(db, ctx, user_id)
    if data.role and data.role != m.role:
        touches_owner = "owner" in (data.role, m.role)
        if touches_owner and ctx.role != "owner":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Sólo el propietario puede gestionar propietarios")
        if m.role == "owner" and _owner_count(db, ctx.org_id) <= 1:
            raise HTTPException(400, "La organización debe tener al menos un propietario")
        log_activity(
            db, org_id=ctx.org_id, actor_id=ctx.user.id, action="role_changed", entity_type="membership",
            entity_id=user_id, changes={"role": [m.role, data.role]},
        )
        m.role = data.role
    if data.title is not None:
        m.title = data.title
    db.commit()
    return _member_out(m)


@router.delete("/{org_id}/members/{user_id}", response_model=Message)
def remove_member(user_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    m = _get_membership(db, ctx, user_id)
    leaving_self = user_id == ctx.user.id
    if not leaving_self and not ctx.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere administrador de la organización")
    if m.role == "owner":
        if not leaving_self and ctx.role != "owner":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Sólo el propietario puede quitar a otro propietario")
        if _owner_count(db, ctx.org_id) <= 1:
            raise HTTPException(400, "Transfiere la propiedad antes de salir")
    db.execute(delete(ProjectMember).where(ProjectMember.organization_id == ctx.org_id, ProjectMember.user_id == user_id))
    db.execute(delete(TeamMember).where(TeamMember.organization_id == ctx.org_id, TeamMember.user_id == user_id))
    db.delete(m)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="removed", entity_type="membership", entity_id=user_id)
    db.commit()
    return Message(detail="Miembro eliminado")


# ---- Invitaciones ---------------------------------------------------------------------


@router.get("/{org_id}/invitations", response_model=list[InvitationOut])
def list_invitations(ctx: OrgCtx = Depends(require_org_admin), db: Session = Depends(get_db)):
    return db.scalars(
        select(Invitation)
        .where(Invitation.organization_id == ctx.org_id, Invitation.accepted_at.is_(None), Invitation.revoked_at.is_(None))
        .order_by(Invitation.created_at.desc())
    ).all()


@router.post("/{org_id}/invitations", response_model=InvitationCreated, status_code=201)
def create_invitation(data: InvitationCreate, ctx: OrgCtx = Depends(require_org_admin), db: Session = Depends(get_db)):
    email = data.email.lower()
    if data.role == "owner" and ctx.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sólo el propietario puede invitar propietarios")
    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user and db.scalar(
        select(Membership.id).where(Membership.organization_id == ctx.org_id, Membership.user_id == existing_user.id)
    ):
        raise HTTPException(409, "Esta persona ya es miembro de la organización")
    pending = db.scalar(
        select(func.count()).select_from(Invitation).where(
            Invitation.organization_id == ctx.org_id, Invitation.accepted_at.is_(None), Invitation.revoked_at.is_(None)
        )
    )
    if pending >= 200:
        raise HTTPException(400, "Demasiadas invitaciones pendientes")
    # Revoca invitaciones previas al mismo correo.
    for old in db.scalars(
        select(Invitation).where(
            Invitation.organization_id == ctx.org_id, Invitation.email == email,
            Invitation.accepted_at.is_(None), Invitation.revoked_at.is_(None),
        )
    ):
        old.revoked_at = utcnow()
    token = new_token()
    inv = Invitation(
        organization_id=ctx.org_id, email=email, role=data.role, token_hash=hash_token(token),
        invited_by_id=ctx.user.id, expires_at=utcnow() + timedelta(days=7),
    )
    db.add(inv)
    org = db.get(Organization, ctx.org_id)
    url = link(f"/invite/{token}")
    queue_email(
        email,
        f"{ctx.user.full_name} te invitó a {org.name} en Órbita",
        f"Hola,\n\n{ctx.user.full_name} te invitó a unirte a {org.name} en Órbita.\n\nAcepta la invitación:\n{url}\n\n"
        "La invitación caduca en 7 días.",
    )
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="invited", entity_type="invitation", changes={"email": email, "role": data.role})
    if existing_user:
        notify(db, org_id=ctx.org_id, user_ids=[existing_user.id], actor_id=ctx.user.id, type_="invited",
               title=f"Te invitaron a {org.name}")
    db.commit()
    out = InvitationCreated.model_validate(inv)
    if not settings.is_production:
        out.invite_url = url
    return out


@router.delete("/{org_id}/invitations/{inv_id}", response_model=Message)
def revoke_invitation(inv_id: int, ctx: OrgCtx = Depends(require_org_admin), db: Session = Depends(get_db)):
    inv = db.scalar(select(Invitation).where(Invitation.id == inv_id, Invitation.organization_id == ctx.org_id))
    if not inv:
        raise HTTPException(404, "Invitación no encontrada")
    inv.revoked_at = utcnow()
    db.commit()
    return Message(detail="Invitación revocada")


# ---- Equipos --------------------------------------------------------------------------


def _team_out(db: Session, team: Team) -> TeamOut:
    ids = [tm.user_id for tm in team.members]
    users = db.scalars(select(User).where(User.id.in_(ids)).order_by(User.full_name)).all() if ids else []
    lead = db.get(User, team.lead_id) if team.lead_id else None
    return TeamOut(id=team.id, name=team.name, description=team.description, color=team.color, is_qa=team.is_qa,
                   lead=UserBrief.model_validate(lead) if lead else None,
                   members=[UserBrief.model_validate(u) for u in users])


def _apply_lead(db: Session, ctx: OrgCtx, team: Team, lead_id: int | None) -> None:
    """El líder debe ser miembro de la organización y queda incluido en el equipo."""
    if lead_id is None:
        team.lead_id = None
        return
    _valid_member_ids(db, ctx.org_id, [lead_id])
    team.lead_id = lead_id
    if lead_id not in {tm.user_id for tm in team.members}:
        team.members.append(TeamMember(organization_id=ctx.org_id, user_id=lead_id))


def _valid_member_ids(db: Session, org_id: int, ids: list[int]) -> list[int]:
    if not ids:
        return []
    valid = set(db.scalars(select(Membership.user_id).where(Membership.organization_id == org_id, Membership.user_id.in_(ids))))
    if valid != set(ids):
        raise HTTPException(400, "Algunos usuarios no pertenecen a la organización")
    return list(valid)


@router.get("/{org_id}/teams", response_model=list[TeamOut])
def list_teams(ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    teams = db.scalars(select(Team).where(Team.organization_id == ctx.org_id).order_by(Team.name))
    return [_team_out(db, t) for t in teams]


@router.post("/{org_id}/teams", response_model=TeamOut, status_code=201)
def create_team(data: TeamIn, ctx: OrgCtx = Depends(require_org_admin), db: Session = Depends(get_db)):
    if db.scalar(select(Team.id).where(Team.organization_id == ctx.org_id, Team.name == data.name)):
        raise HTTPException(409, "Ya existe un equipo con ese nombre")
    team = Team(organization_id=ctx.org_id, name=data.name, description=data.description, color=data.color, is_qa=data.is_qa)
    for uid in _valid_member_ids(db, ctx.org_id, data.member_ids):
        team.members.append(TeamMember(organization_id=ctx.org_id, user_id=uid))
    _apply_lead(db, ctx, team, data.lead_id)
    db.add(team)
    db.commit()
    return _team_out(db, team)


def _get_team(db: Session, ctx: OrgCtx, team_id: int) -> Team:
    team = db.scalar(select(Team).where(Team.id == team_id, Team.organization_id == ctx.org_id))
    if not team:
        raise HTTPException(404, "Equipo no encontrado")
    return team


@router.patch("/{org_id}/teams/{team_id}", response_model=TeamOut)
def update_team(team_id: int, data: TeamUpdate, ctx: OrgCtx = Depends(require_org_admin), db: Session = Depends(get_db)):
    team = _get_team(db, ctx, team_id)
    if data.name:
        team.name = data.name
    if data.description is not None:
        team.description = data.description
    if data.color:
        team.color = data.color
    if data.is_qa is not None:
        team.is_qa = data.is_qa
    if data.member_ids is not None:
        team.members.clear()
        db.flush()
        for uid in _valid_member_ids(db, ctx.org_id, data.member_ids):
            team.members.append(TeamMember(organization_id=ctx.org_id, user_id=uid))
    if "lead_id" in data.model_fields_set:
        _apply_lead(db, ctx, team, data.lead_id)
    elif team.lead_id and data.member_ids is not None and team.lead_id not in data.member_ids:
        team.members.append(TeamMember(organization_id=ctx.org_id, user_id=team.lead_id))
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="updated", entity_type="team", entity_id=team.id)
    db.commit()
    return _team_out(db, team)


@router.delete("/{org_id}/teams/{team_id}", response_model=Message)
def delete_team(team_id: int, ctx: OrgCtx = Depends(require_org_admin), db: Session = Depends(get_db)):
    db.delete(_get_team(db, ctx, team_id))
    db.commit()
    return Message(detail="Equipo eliminado")


# ---- Calendario laboral (festivos y ausencias: no rompen rachas) ------------------------


@router.get("/{org_id}/holidays", response_model=list[HolidayOut])
def list_holidays(ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    return [HolidayOut(id=h.id, date=h.date, name=h.name)
            for h in db.scalars(select(OrgHoliday).where(OrgHoliday.organization_id == ctx.org_id).order_by(OrgHoliday.date))]


@router.post("/{org_id}/holidays", response_model=HolidayOut, status_code=201)
def add_holiday(data: HolidayIn, ctx: OrgCtx = Depends(require_org_manager), db: Session = Depends(get_db)):
    if db.scalar(select(OrgHoliday.id).where(OrgHoliday.organization_id == ctx.org_id, OrgHoliday.date == data.date)):
        raise HTTPException(409, "Ese día ya es festivo")
    h = OrgHoliday(organization_id=ctx.org_id, date=data.date, name=data.name)
    db.add(h)
    db.commit()
    return HolidayOut(id=h.id, date=h.date, name=h.name)


@router.delete("/{org_id}/holidays/{holiday_id}", response_model=Message)
def delete_holiday(holiday_id: int, ctx: OrgCtx = Depends(require_org_manager), db: Session = Depends(get_db)):
    h = db.scalar(select(OrgHoliday).where(OrgHoliday.id == holiday_id, OrgHoliday.organization_id == ctx.org_id))
    if not h:
        raise HTTPException(404, "Festivo no encontrado")
    db.delete(h)
    db.commit()
    return Message(detail="Festivo eliminado")


@router.get("/{org_id}/absences", response_model=list[AbsenceOut])
def list_absences(ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    q = select(UserAbsence).where(UserAbsence.organization_id == ctx.org_id)
    if not ctx.is_manager:
        q = q.where(UserAbsence.user_id == ctx.user.id)
    out = []
    for a in db.scalars(q.order_by(UserAbsence.start_date.desc())):
        out.append(AbsenceOut(id=a.id, user=UserBrief.model_validate(db.get(User, a.user_id)), start_date=a.start_date,
                              end_date=a.end_date, reason=a.reason))
    return out


@router.post("/{org_id}/absences", response_model=AbsenceOut, status_code=201)
def add_absence(data: AbsenceIn, ctx: OrgCtx = Depends(require_org_manager), db: Session = Depends(get_db)):
    """Ausencia autorizada (vacaciones, incapacidad). La registra un gerente."""
    if data.end_date < data.start_date:
        raise HTTPException(422, "La fecha final es anterior a la inicial")
    _get_membership(db, ctx, data.user_id)
    a = UserAbsence(organization_id=ctx.org_id, user_id=data.user_id, start_date=data.start_date, end_date=data.end_date,
                    reason=data.reason, approved_by_id=ctx.user.id)
    db.add(a)
    db.commit()
    return AbsenceOut(id=a.id, user=UserBrief.model_validate(db.get(User, a.user_id)), start_date=a.start_date,
                      end_date=a.end_date, reason=a.reason)


@router.delete("/{org_id}/absences/{absence_id}", response_model=Message)
def delete_absence(absence_id: int, ctx: OrgCtx = Depends(require_org_manager), db: Session = Depends(get_db)):
    a = db.scalar(select(UserAbsence).where(UserAbsence.id == absence_id, UserAbsence.organization_id == ctx.org_id))
    if not a:
        raise HTTPException(404, "Ausencia no encontrada")
    db.delete(a)
    db.commit()
    return Message(detail="Ausencia eliminada")
