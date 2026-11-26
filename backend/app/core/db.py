from collections.abc import Iterator
from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


def utcnow() -> datetime:
    # MySQL DATETIME no guarda zona horaria: almacenamos siempre UTC "naive".
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    type_annotation_map = {datetime: DateTime()}


_engine_kwargs: dict = {"pool_pre_ping": True, "future": True, "hide_parameters": True}
if settings.DATABASE_URL.startswith("mysql"):
    _engine_kwargs.update(pool_size=5, max_overflow=5, pool_recycle=1800,
                          connect_args={"connect_timeout": 5, "read_timeout": 20, "write_timeout": 20})

engine = create_engine(settings.DATABASE_URL, **_engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
