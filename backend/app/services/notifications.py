from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.models import Notification
from app.services.realtime import emit_user


def notify(
    db: Session,
    *,
    org_id: int,
    user_ids: Iterable[int | None],
    actor_id: int | None,
    type_: str,
    title: str,
    body: str = "",
    task_id: int | None = None,
    project_id: int | None = None,
) -> None:
    for uid in {u for u in user_ids if u}:
        if uid == actor_id:
            continue
        db.add(
            Notification(
                organization_id=org_id,
                user_id=uid,
                actor_id=actor_id,
                type=type_,
                title=title[:255],
                body=body[:500],
                task_id=task_id,
                project_id=project_id,
            )
        )
        emit_user(db, uid, "notification", org_id=org_id, task_id=task_id)
