"""Contribuciones verificables, ciclos de resolución QA, logros y rachas.

Principios:
  * Nunca se otorgan logros por estar asignado, recibir o reasignar una tarea.
  * Resolución: al desarrollador cuya entrega (ciclo) fue validada por QA.
  * Validación: al integrante QA que registró la validación final con evidencia.
  * Idempotencia: cada logro tiene una dedupe_key única; cada contribución, (source_type, source_id, user_id) único.
  * Los eventos en tiempo real se emiten tras el commit (emit_* difiere el envío).
"""

import hashlib
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.models import (
    AchievementDefinition,
    AchievementEvent,
    Comment,
    Organization,
    OrgHoliday,
    Task,
    TaskContribution,
    TaskResolutionCycle,
    UserAbsence,
    UserAchievement,
    UserStreak,
)
from app.services.realtime import emit_user

MIN_COMMENT_CHARS = 30
STREAK_MILESTONES = (5, 10, 20)


def org_today(org: Organization, when: datetime | None = None) -> date:
    when = (when or utcnow()).replace(tzinfo=timezone.utc)
    try:
        return when.astimezone(ZoneInfo(org.timezone)).date()
    except Exception:  # noqa: BLE001 — zona horaria inválida
        return when.date()


def _plain(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip().lower()


def comment_is_substantive(db: Session, comment: Comment, has_attachment: bool = False) -> bool:
    """Un comentario cuenta como contribución si aporta contenido y no repite uno reciente del mismo autor."""
    text = _plain(comment.body)
    text_wo_mentions = re.sub(r"@[\w.-]+", "", text).strip()
    if has_attachment:
        return True
    if len(text_wo_mentions) < MIN_COMMENT_CHARS or len(set(text_wo_mentions.split())) < 5:
        return False
    digest = hashlib.sha256(text_wo_mentions.encode()).hexdigest()
    recent = db.scalars(
        select(Comment).where(Comment.author_id == comment.author_id, Comment.id != comment.id,
                              Comment.organization_id == comment.organization_id)
        .order_by(Comment.id.desc()).limit(30)
    )
    return all(hashlib.sha256(re.sub(r"@[\w.-]+", "", _plain(c.body)).strip().encode()).hexdigest() != digest for c in recent)


def record_contribution(db: Session, *, task: Task, user_id: int, kind: str, source_type: str, source_id: int,
                        cycle_id: int | None = None) -> TaskContribution | None:
    exists = db.scalar(select(TaskContribution).where(
        TaskContribution.source_type == source_type, TaskContribution.source_id == source_id, TaskContribution.user_id == user_id))
    if exists:
        return None
    org = db.get(Organization, task.organization_id)
    c = TaskContribution(organization_id=task.organization_id, project_id=task.project_id, team_id=task.team_id,
                         task_id=task.id, user_id=user_id, cycle_id=cycle_id, kind=kind, source_type=source_type,
                         source_id=source_id, local_date=org_today(org))
    try:
        with db.begin_nested():
            db.add(c)
    except IntegrityError:
        return None  # otra transacción la registró a la vez
    update_streak(db, org, user_id)
    emit_user(db, user_id, "achievements.updated", org_id=task.organization_id)
    return c


# ---- Rachas ----------------------------------------------------------------------------


def _non_working(db: Session, org: Organization, user_id: int, start: date, end: date) -> set[date]:
    workdays = {int(x) for x in (org.workdays or "1,2,3,4,5").split(",") if x.strip().isdigit()}
    out = set()
    d = start
    while d <= end:
        if d.isoweekday() not in workdays:
            out.add(d)
        d += timedelta(days=1)
    out |= set(db.scalars(select(OrgHoliday.date).where(OrgHoliday.organization_id == org.id,
                                                        OrgHoliday.date >= start, OrgHoliday.date <= end)))
    for a in db.scalars(select(UserAbsence).where(UserAbsence.organization_id == org.id, UserAbsence.user_id == user_id,
                                                  UserAbsence.end_date >= start, UserAbsence.start_date <= end)):
        d = max(a.start_date, start)
        while d <= min(a.end_date, end):
            out.add(d)
            d += timedelta(days=1)
    return out


def compute_streak(db: Session, org: Organization, user_id: int, today: date | None = None
                   ) -> tuple[int, int, date | None, date | None]:
    """(actual, mejor, último día, inicio de la racha actual) contando días laborales consecutivos con contribuciones.

    Fines de semana, festivos y ausencias autorizadas se saltan: no suman ni rompen la racha.
    La racha actual sigue viva si el último día con contribución es hoy o el día laboral anterior.
    """
    today = today or org_today(org)
    days = sorted(set(db.scalars(select(TaskContribution.local_date).where(
        TaskContribution.organization_id == org.id, TaskContribution.user_id == user_id))))
    if not days:
        return 0, 0, None, None
    skip = _non_working(db, org, user_id, days[0] - timedelta(days=1), today)
    active = set(days)

    def prev_working(d: date) -> date:
        d -= timedelta(days=1)
        while d in skip and d >= days[0] - timedelta(days=60):
            d -= timedelta(days=1)
        return d

    best = run = 0
    prev: date | None = None
    run_start: date | None = None
    for d in days:
        if prev is not None and prev_working(d) == prev:
            run += 1
        else:
            run, run_start = 1, d
        best = max(best, run)
        prev = d
    last = days[-1]
    # ¿Sigue viva? Entre el último día activo y hoy no debe haber días laborales sin contribución (hoy no cuenta aún).
    alive = last == today or prev_working(today) == last or (today in skip and prev_working(today) == last)
    current = run if alive and last in active else 0
    return current, best, last, run_start if current else None


def update_streak(db: Session, org: Organization, user_id: int) -> UserStreak:
    current, best, last, start = compute_streak(db, org, user_id)
    s = db.scalar(select(UserStreak).where(UserStreak.organization_id == org.id, UserStreak.user_id == user_id))
    if not s:
        s = UserStreak(organization_id=org.id, user_id=user_id, current=0, best=0)
        db.add(s)
    s.current, s.best, s.last_day = current, max(best, s.best or 0), last
    for n in STREAK_MILESTONES:
        if current >= n:
            # Clave por hito y fecha de inicio de la racha: la misma racha no se premia dos veces.
            award(db, org_id=org.id, user_id=user_id, code=f"streak_{n}", dedupe_key=f"streak:{org.id}:{user_id}:{n}:{start}",
                  evidence={"streak": current, "last_day": str(last)})
    return s


# ---- Logros ----------------------------------------------------------------------------


def award(db: Session, *, org_id: int, user_id: int, code: str, dedupe_key: str, task: Task | None = None,
          cycle: TaskResolutionCycle | None = None, evidence: dict | None = None) -> UserAchievement | None:
    if db.scalar(select(UserAchievement.id).where(UserAchievement.dedupe_key == dedupe_key)):
        return None
    definition = db.scalar(select(AchievementDefinition).where(AchievementDefinition.code == code))
    if not definition:
        return None
    ua = UserAchievement(organization_id=org_id, user_id=user_id, definition_id=definition.id,
                         project_id=task.project_id if task else None, team_id=(cycle.team_id if cycle else task.team_id if task else None),
                         task_id=task.id if task else None, cycle_id=cycle.id if cycle else None, evidence=evidence,
                         dedupe_key=dedupe_key)
    try:
        with db.begin_nested():
            db.add(ua)
            db.flush()
    except IntegrityError:
        return None  # reintento o evento concurrente: ya otorgado
    db.add(AchievementEvent(organization_id=org_id, user_id=user_id, achievement_id=ua.id, type="awarded",
                            payload={"code": code, "dedupe_key": dedupe_key}))
    emit_user(db, user_id, "achievements.updated", org_id=org_id)
    return ua


def revoke_cycle_achievements(db: Session, cycle: TaskResolutionCycle, reason: str) -> int:
    n = 0
    for ua in db.scalars(select(UserAchievement).where(UserAchievement.cycle_id == cycle.id, UserAchievement.status == "active")):
        ua.status = "revoked"
        ua.revoked_at = utcnow()
        ua.revoke_reason = reason[:255]
        db.add(AchievementEvent(organization_id=ua.organization_id, user_id=ua.user_id, achievement_id=ua.id, type="revoked",
                                payload={"reason": reason}))
        emit_user(db, ua.user_id, "achievements.updated", org_id=ua.organization_id)
        n += 1
    cycle.status = "revoked"
    return n


DEFINITIONS = [
    ("resolution", "Resolución aceptada", "resolution", None, "Su entrega fue la versión validada por QA."),
    ("qa_validation", "Validación QA", "validation", None, "Registró la validación final satisfactoria con evidencia."),
    ("streak_5", "Racha de 5 días", "streak", 5, "5 días laborales seguidos con contribuciones verificadas."),
    ("streak_10", "Racha de 10 días", "streak", 10, "10 días laborales seguidos con contribuciones verificadas."),
    ("streak_20", "Racha de 20 días", "streak", 20, "20 días laborales seguidos con contribuciones verificadas."),
]


def ensure_definitions(db: Session) -> None:
    """Idempotente. La migración ya las inserta; se usa en pruebas y como red de seguridad."""
    existing = set(db.scalars(select(AchievementDefinition.code)))
    for code, name, kind, threshold, desc in DEFINITIONS:
        if code not in existing:
            db.add(AchievementDefinition(code=code, name=name, kind=kind, threshold=threshold, description=desc))
    db.flush()
