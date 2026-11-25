from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import ActivityLog


def _plain(v: Any) -> Any:
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def diff(obj: Any, data: dict) -> dict:
    """Devuelve {campo: [antes, después]} sólo para los campos que cambian."""
    out = {}
    for k, new in data.items():
        old = getattr(obj, k, None)
        if old != new:
            out[k] = [_plain(old), _plain(new)]
    return out


def log_activity(
    db: Session,
    *,
    org_id: int,
    actor_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    project_id: int | None = None,
    task_id: int | None = None,
    changes: dict | None = None,
) -> None:
    db.add(
        ActivityLog(
            organization_id=org_id,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            project_id=project_id,
            task_id=task_id,
            changes=changes or None,
        )
    )
