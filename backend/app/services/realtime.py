"""Publicación de eventos en tiempo real vía Redis pub/sub.

Los eventos sólo llevan identificadores: el cliente vuelve a consultar la API, donde se
aplican los permisos. Así un evento nunca filtra contenido a quien no tiene acceso.
"""

import json
import logging

import redis

from app.core.redis import get_redis

log = logging.getLogger(__name__)


def org_channel(org_id: int) -> str:
    return f"orbita:org:{org_id}"


def user_channel(user_id: int) -> str:
    return f"orbita:user:{user_id}"


def _publish(channel: str, event: dict) -> None:
    r = get_redis()
    if r is None:
        return
    try:
        r.publish(channel, json.dumps(event, default=str))
    except redis.RedisError:
        log.warning("No se pudo publicar evento en %s", channel)


def publish_org(org_id: int, type_: str, **ids) -> None:
    _publish(org_channel(org_id), {"type": type_, "org_id": org_id, **ids})


def publish_user(user_id: int, type_: str, **ids) -> None:
    _publish(user_channel(user_id), {"type": type_, **ids})


# --- Eventos diferidos hasta el commit -------------------------------------------------
# Las rutas encolan eventos en la sesión; se publican sólo si la transacción se confirma,
# de modo que el cliente nunca recibe un aviso de un cambio que aún no es visible.

from sqlalchemy import event  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402


def emit_org(db: Session, org_id: int, type_: str, **ids) -> None:
    db.info.setdefault("rt_events", []).append(("org", org_id, type_, ids))


def emit_user(db: Session, user_id: int, type_: str, **ids) -> None:
    db.info.setdefault("rt_events", []).append(("user", user_id, type_, ids))


@event.listens_for(Session, "after_commit")
def _flush_events(session: Session) -> None:
    events = session.info.pop("rt_events", [])
    for scope, target, type_, ids in events:
        if scope == "org":
            publish_org(target, type_, **ids)
        else:
            publish_user(target, type_, **ids)


@event.listens_for(Session, "after_rollback")
def _drop_events(session: Session) -> None:
    session.info.pop("rt_events", None)
