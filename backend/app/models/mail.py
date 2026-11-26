from datetime import datetime

from sqlalchemy import LargeBinary
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class OutgoingMail(Base):
    __tablename__ = "outgoing_mail"

    id: Mapped[int] = mapped_column(primary_key=True)
    payload: Mapped[bytes | None] = mapped_column(LargeBinary)
    attempts: Mapped[int] = mapped_column(default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(index=True)
    expires_at: Mapped[datetime | None] = mapped_column(index=True)
    failed_at: Mapped[datetime | None]
