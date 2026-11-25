"""Correo saliente. El backend encola; el worker envía por SMTP."""

import json
import logging
import smtplib
from email.message import EmailMessage

import redis

from app.core.config import settings
from app.core.redis import get_redis

log = logging.getLogger("orbita.mail")
QUEUE = "orbita:emails"


def queue_email(to: str, subject: str, body: str) -> None:
    job = {"to": to, "subject": subject, "body": body}
    if not settings.is_production:
        # En desarrollo los enlaces quedan visibles en el log para facilitar las pruebas.
        log.info("Correo para %s — %s\n%s", to, subject, body)
    r = get_redis()
    if r is None:
        return
    try:
        r.rpush(QUEUE, json.dumps(job))
    except redis.RedisError:
        log.exception("No se pudo encolar el correo; se intenta envío directo")
        send_email(job)


def send_email(job: dict) -> None:
    if not settings.SMTP_HOST:
        log.info("SMTP no configurado; correo omitido para %s", job["to"])
        return
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = job["to"]
    msg["Subject"] = job["subject"]
    msg.set_content(job["body"])
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as s:
        if settings.SMTP_TLS:
            s.starttls()
        if settings.SMTP_USER:
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        s.send_message(msg)


def link(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"
