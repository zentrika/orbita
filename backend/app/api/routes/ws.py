"""WebSocket de eventos en tiempo real.

Protocolo:
  1. El cliente abre /api/v1/ws y envía {"type": "auth", "token": "<access>", "org_id": 1}
  2. El servidor valida sesión y pertenencia a la organización y responde {"type": "ready"}
  3. El servidor reenvía eventos del canal de la organización y del canal personal del usuario.
  4. El cliente envía "ping" cada ~25 s: renueva su presencia (clave con caducidad en Redis).

Autorización: los eventos de proyecto sólo se reenvían si el usuario tiene acceso a ese proyecto.
La lista de proyectos accesibles se recalcula al cambiar un proyecto y cada 60 s.
"""

import asyncio
import json
import logging
import time

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.api.deps import OrgCtx, authenticate_token
from app.api.permissions import accessible_project_ids
from app.core.config import settings
from app.core.db import SessionLocal
from app.models import Membership
from app.services.presence import heartbeat
from app.services.realtime import org_channel, publish_org, user_channel

router = APIRouter()
log = logging.getLogger(__name__)


def _accessible(org_id: int, user_id: int) -> set[int]:
    with SessionLocal() as db:
        from app.models import User

        m = db.scalar(select(Membership).where(Membership.organization_id == org_id, Membership.user_id == user_id))
        if not m:
            return set()
        return set(accessible_project_ids(db, OrgCtx(org_id=org_id, user=db.get(User, user_id), role=m.role)))


def _authorize(token: str, org_id: int) -> int | None:
    with SessionLocal() as db:
        res = authenticate_token(db, token)
        if not res:
            return None
        user, _ = res
        ok = db.scalar(select(Membership.id).where(Membership.organization_id == org_id, Membership.user_id == user.id))
        return user.id if ok else None


@router.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=10)
        org_id = int(first.get("org_id"))
        user_id = await asyncio.to_thread(_authorize, str(first.get("token", "")), org_id)
    except (asyncio.TimeoutError, ValueError, TypeError, WebSocketDisconnect, json.JSONDecodeError):
        await ws.close(code=4401)
        return
    if not user_id:
        await ws.close(code=4401)
        return

    client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    pubsub = client.pubsub()
    await pubsub.subscribe(org_channel(org_id), user_channel(user_id))
    allowed = {"ids": await asyncio.to_thread(_accessible, org_id, user_id), "at": time.monotonic()}
    await asyncio.to_thread(heartbeat, org_id, user_id)
    await asyncio.to_thread(publish_org, org_id, "presence", user_id=user_id, online=True)
    await ws.send_json({"type": "ready"})

    async def pump():
        async for msg in pubsub.listen():
            if msg.get("type") != "message":
                continue
            data = json.loads(msg["data"])
            # Eventos personales de otra organización se filtran aquí.
            if data.get("org_id") not in (None, org_id):
                continue
            stale = time.monotonic() - allowed["at"] > 60
            if stale or str(data.get("type", "")).startswith("project."):
                allowed["ids"] = await asyncio.to_thread(_accessible, org_id, user_id)
                allowed["at"] = time.monotonic()
            pid = data.get("project_id")
            if pid is not None and pid not in allowed["ids"]:
                continue  # nunca se envían eventos de proyectos a los que no se tiene acceso
            await ws.send_text(json.dumps(data))

    async def keepalive():
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await asyncio.to_thread(heartbeat, org_id, user_id)
                await ws.send_text('{"type":"pong"}')

    tasks = [asyncio.create_task(pump()), asyncio.create_task(keepalive())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except Exception:  # noqa: BLE001
        log.debug("WebSocket cerrado")
    finally:
        for t in tasks:
            t.cancel()
        await pubsub.unsubscribe()
        await pubsub.aclose()
        await client.aclose()
