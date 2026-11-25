"""Contribuciones verificables, ciclos de resolución QA, logros y rachas."""

from datetime import date, datetime

from sqlalchemy import JSON, Date, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class TaskResolutionCycle(Base):
    """Un envío a QA y su resultado. Vincula al desarrollador que entregó con la validación final."""

    __tablename__ = "task_resolution_cycles"
    __table_args__ = (UniqueConstraint("task_id", "number", name="uq_cycle_task_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    number: Mapped[int] = mapped_column(Integer)
    submitted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(default=utcnow)
    submission_note: Mapped[str] = mapped_column(String(1000), default="")
    status: Mapped[str] = mapped_column(String(20), default="in_qa")  # in_qa | accepted | rejected | revoked
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    review_note: Mapped[str] = mapped_column(String(1000), default="")


class TaskContribution(Base):
    __tablename__ = "task_contributions"
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", "user_id", name="uq_contribution_source"),
        Index("ix_contrib_org_user_day", "organization_id", "user_id", "local_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    cycle_id: Mapped[int | None] = mapped_column(ForeignKey("task_resolution_cycles.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(30))  # comment | evidence | time_log | qa_submission | qa_review
    source_type: Mapped[str] = mapped_column(String(30))
    source_id: Mapped[int] = mapped_column(Integer)
    local_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AchievementDefinition(Base):
    __tablename__ = "achievement_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(20))  # resolution | validation | streak
    threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)


class UserAchievement(Base):
    __tablename__ = "user_achievements"
    __table_args__ = (Index("ix_ua_org_user", "organization_id", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    definition_id: Mapped[int] = mapped_column(ForeignKey("achievement_definitions.id", ondelete="RESTRICT"))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True)
    cycle_id: Mapped[int | None] = mapped_column(ForeignKey("task_resolution_cycles.id", ondelete="SET NULL"), nullable=True)
    evidence: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | revoked
    dedupe_key: Mapped[str] = mapped_column(String(120), unique=True)  # evita logros duplicados por reintentos
    awarded_at: Mapped[datetime] = mapped_column(default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    revoke_reason: Mapped[str] = mapped_column(String(255), default="")


class AchievementEvent(Base):
    __tablename__ = "achievement_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    achievement_id: Mapped[int | None] = mapped_column(ForeignKey("user_achievements.id", ondelete="CASCADE"), nullable=True)
    type: Mapped[str] = mapped_column(String(20))  # awarded | revoked
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class UserStreak(Base):
    __tablename__ = "user_streaks"
    __table_args__ = (UniqueConstraint("organization_id", "user_id", name="uq_streak_org_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    current: Mapped[int] = mapped_column(Integer, default=0)
    best: Mapped[int] = mapped_column(Integer, default=0)
    last_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
