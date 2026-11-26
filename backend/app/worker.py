"""Worker de tareas en segundo plano.

* Procesa la bandeja SMTP; Redis despierta al worker tras confirmar la transacción.
* Cada minuto genera recordatorios para tareas que vencen en las próximas N horas.
"""

import hashlib
import json
from pathlib import Path
import logging
import signal
import time
from datetime import date, timedelta

import redis
from sqlalchemy import select
from cryptography.fernet import Fernet

from app.core.config import settings
from app.core.db import SessionLocal, utcnow
from app.models import OutgoingMail, Project, Task, TaskWatcher, WorkflowStatus
from app.services.mailer import QUEUE, WAKE_QUEUE, deliver_next
from app.services.notifications import notify

log = logging.getLogger("orbita.worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
_running = True


def _stop(*_):
    global _running
    _running = False


def due_reminders() -> int:
    horizon = (utcnow() + timedelta(hours=settings.REMINDER_HOURS_BEFORE)).date()
    sent = 0
    with SessionLocal() as db:
        rows = db.execute(
            select(Task, Project.key)
            .join(Project, Project.id == Task.project_id)
            .join(WorkflowStatus, WorkflowStatus.id == Task.status_id)
            .where(
                Task.deleted_at.is_(None),
                Project.deleted_at.is_(None),
                Task.due_date.is_not(None),
                Task.due_date <= horizon,
                Task.due_date >= date.today() - timedelta(days=1),
                Task.due_reminder_sent_at.is_(None),
                WorkflowStatus.category != "done",
            )
            .limit(500)
        ).all()
        for task, key in rows:
            watchers = set(db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == task.id)))
            recipients = watchers | ({task.assignee_id} if task.assignee_id else set())
            overdue = task.due_date < date.today()
            notify(
                db, org_id=task.organization_id, user_ids=recipients, actor_id=None, type_="due_soon",
                title=f"{key}-{task.number} {'está vencida' if overdue else 'vence pronto'}",
                body=f"{task.title} — fecha límite {task.due_date.isoformat()}", task_id=task.id, project_id=task.project_id,
            )
            task.due_reminder_sent_at = utcnow()
            sent += 1
        db.commit()
    if sent:
        log.info("Recordatorios generados: %s", sent)
    return sent


def import_legacy_email(client: redis.Redis) -> None:
    """Migra los mensajes de la versión anterior conservando el original hasta el commit."""
    if not settings.SMTP_HOST:
        return
    item = client.lindex(QUEUE, 0)
    if item is None:
        return
    try:
        job = json.loads(item)
        if not isinstance(job, dict) or not all(isinstance(job.get(k), str) for k in ("to", "subject", "body")):
            raise ValueError
    except ValueError:
        client.lmove(QUEUE, f"{QUEUE}:invalid", "LEFT", "RIGHT")
        log.error("Trabajo de correo antiguo inválido en Redis")
        return
    job["message_id"] = f"<legacy-{hashlib.sha256(item.encode()).hexdigest()}@zentrika.tech>"
    payload = Fernet(settings.MAIL_ENCRYPTION_KEY).encrypt(json.dumps(job).encode())
    with SessionLocal.begin() as db:
        db.add(OutgoingMail(payload=payload, next_attempt_at=utcnow(), expires_at=utcnow() + timedelta(hours=1)))
    client.lpop(QUEUE)


def main() -> None:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=3, socket_timeout=8)
    heartbeat_file = Path("/tmp/orbita-worker-heartbeat")
    log.info("Worker iniciado")
    last_reminder = 0.0
    while _running:
        try:
            if time.monotonic() - last_reminder > 60 or last_reminder == 0:
                last_reminder = time.monotonic()
                due_reminders()
            with SessionLocal() as db:
                delivered = deliver_next(db) if settings.SMTP_HOST else False
            heartbeat_file.touch()
        except Exception as exc:
            log.error("Error en el worker: %s", type(exc).__name__)
            time.sleep(5)
            continue
        try:
            import_legacy_email(r)
            if not delivered:
                r.blpop([WAKE_QUEUE], timeout=5)
        except redis.RedisError:
            log.warning("Redis no disponible; la bandeja se consultará de nuevo en 5 s")
            time.sleep(5)
    log.info("Worker detenido")


if __name__ == "__main__":
    main()
