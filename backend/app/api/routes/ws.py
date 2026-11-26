"""WebSocket de eventos en tiempo real.

Protocolo:
  1. El cliente abre /api/v1/ws y envía {"type": "auth", "token": "<access>", "org_id": 1}
  2. El servidor valida sesión y pertenencia a la organización y responde {"type": "ready"}
  3. El servidor reenvía eventos del canal de la organización y del canal personal del usuario.
  4. El cliente envía "ping" cada ~25 s: renueva su presencia (clave con caducidad en Redis).

Autorización: los eventos de proyecto sólo se reenvían si el usuario tiene acceso a ese proyecto.
Se comprueban los permisos vigentes de sesión, organización, proyecto y tarea en cada evento.
"""

import asyncio
import json
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.api.deps import OrgCtx, authenticate_token
from app.api.permissions import can, can_view_task, load_project, load_task, project_role
from app.core.config import settings
from app.core.db import SessionLocal, utcnow
from app.models import Membership, Project, Task, User, UserSession
from app.services.presence import heartbeat
from app.services.realtime import org_channel, publish_org, user_channel

router = APIRouter()
log = logging.getLogger(__name__)


def _authorize(token: str, org_id: int) -> tuple[int, int] | None:
    with SessionLocal() as db:
        res = authenticate_token(db, token)
        if not res:
            return None
        user, session = res
        member = db.scalar(select(Membership.id).where(Membership.organization_id == org_id, Membership.user_id == user.id))
        return (user.id, session.id) if member else None


class AuthorizationRevoked(Exception):
    pass


def _can_receive(org_id: int, user_id: int, session_id: int, data: dict) -> bool:
    with SessionLocal() as db:
        session = db.get(UserSession, session_id)
        user = db.get(User, user_id)
        member = db.scalar(select(Membership).where(Membership.organization_id == org_id, Membership.user_id == user_id))
        if not member or not user or not user.is_active or not session or session.revoked_at or session.expires_at <= utcnow():
            raise AuthorizationRevoked
        ctx = OrgCtx(org_id=org_id, user=user, role=member.role)
        try:
            if data.get("type") == "project.deleted":
                project = db.get(Project, data.get("project_id"))
                return bool(project and project.organization_id == org_id and can(project_role(db, ctx, project), "view"))
            if data.get("type") == "task.deleted":
                task = db.get(Task, data.get("task_id"))
                if task is None or task.organization_id != org_id:
                    return False
                _, role = load_project(db, ctx, task.project_id)
                return can_view_task(db, ctx, task, role)
            if data.get("task_id") is not None:
                load_task(db, ctx, data["task_id"], include_deleted=True)
            elif data.get("project_id") is not None:
                load_project(db, ctx, data["project_id"])
        except HTTPException:
            return False
        return True


@router.websocket("/ws")
async def websocket(ws: WebSocket):
    origin = ws.headers.get("origin")
    if (settings.is_production or origin is not None) and origin not in settings.cors_origins:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=10)
        if not isinstance(first, dict) or first.get("type") != "auth":
            raise ValueError
        org_id = int(first.get("org_id"))
        identity = await asyncio.to_thread(_authorize, str(first.get("token", "")), org_id)
    except WebSocketDisconnect:
        return
    except (asyncio.TimeoutError, ValueError, TypeError):
        identity = None
    if not identity:
        await ws.close(code=4401)
        return
    user_id, session_id = identity

    async def pump(pubsub):
        async for msg in pubsub.listen():
            if msg.get("type") != "message":
                continue
            data = json.loads(msg["data"])
            if data.get("org_id") not in (None, org_id):
                continue
            if await asyncio.to_thread(_can_receive, org_id, user_id, session_id, data):
                await ws.send_json(data)

    async def keepalive():
        while True:
            msg = await asyncio.wait_for(ws.receive_text(), timeout=75)
            await asyncio.to_thread(_can_receive, org_id, user_id, session_id, {})
            if msg == "ping":
                await asyncio.to_thread(heartbeat, org_id, user_id)
                await ws.send_json({"type": "pong"})

    try:
        async with aioredis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=3) as client:
            async with client.pubsub() as pubsub:
                await pubsub.subscribe(org_channel(org_id), user_channel(user_id))
                await asyncio.to_thread(heartbeat, org_id, user_id)
                await asyncio.to_thread(publish_org, org_id, "presence", user_id=user_id, online=True)
                await ws.send_json({"type": "ready"})
                tasks = [asyncio.create_task(pump(pubsub)), asyncio.create_task(keepalive())]
                try:
                    done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        task.result()
                finally:
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
    except WebSocketDisconnect:
        return
    except AuthorizationRevoked:
        await ws.close(code=4401)
    except asyncio.TimeoutError:
        await ws.close(code=1001)
    except Exception as exc:
        log.warning("WebSocket interrumpido: %s", type(exc).__name__)
        await ws.close(code=1011)
