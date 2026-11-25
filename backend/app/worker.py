"""Worker de tareas en segundo plano.

* Consume la cola de correos (Redis list `orbita:emails`) y los envía por SMTP.
* Cada minuto genera recordatorios para tareas que vencen en las próximas N horas.
"""

import json
import logging
import signal
import time
from datetime import date, timedelta

import redis
from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal, utcnow
from app.models import Project, Task, TaskWatcher, WorkflowStatus
from app.services.mailer import QUEUE, send_email
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


def main() -> None:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    log.info("Worker iniciado")
    last_reminder = 0.0
    while _running:
        try:
            if time.time() - last_reminder > 60:
                last_reminder = time.time()
                due_reminders()
            item = r.blpop([QUEUE], timeout=5)
            if item:
                job = json.loads(item[1])
                try:
                    send_email(job)
                    log.info("Correo enviado a %s", job["to"])
                except Exception:  # noqa: BLE001
                    log.exception("Fallo al enviar correo; se reintentará")
                    job["attempts"] = job.get("attempts", 0) + 1
                    if job["attempts"] < 5:
                        r.rpush(QUEUE, json.dumps(job))
                    time.sleep(2)
        except redis.RedisError:
            log.warning("Redis no disponible; reintento en 5 s")
            time.sleep(5)
        except Exception:  # noqa: BLE001
            log.exception("Error en el worker")
            time.sleep(5)
    log.info("Worker detenido")


if __name__ == "__main__":
    main()
