"""Correo SMTP y bandeja transaccional con aviso de trabajo por Redis."""

import json
import logging
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import make_msgid

import redis
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import utcnow
from app.core.redis import get_redis
from app.models import OutgoingMail

log = logging.getLogger("orbita.mail")
QUEUE = "orbita:emails"
WAKE_QUEUE = "orbita:mail:wake"
RETRY_DELAYS = (15, 60, 300, 900, 1800)


def queue_email(db: Session, to: str, subject: str, body: str, *, expires_at: datetime) -> None:
    if not settings.SMTP_HOST and not settings.is_production:
        if settings.APP_ENV == "development":
            log.info("Correo de desarrollo para %s — %s\n%s", to, subject, body)
        return
    job = {"to": to, "subject": subject, "body": body, "message_id": make_msgid(domain="zentrika.tech")}
    payload = Fernet(settings.MAIL_ENCRYPTION_KEY).encrypt(json.dumps(job).encode())
    db.add(OutgoingMail(payload=payload, next_attempt_at=utcnow(), expires_at=expires_at))
    from app.services.realtime import emit_mail_wakeup

    emit_mail_wakeup(db)


def wake_worker() -> None:
    try:
        r = get_redis()
        if r is not None:
            with r.pipeline() as pipe:
                pipe.lpush(WAKE_QUEUE, "1").ltrim(WAKE_QUEUE, 0, 0).execute()
    except redis.RedisError:
        log.warning("Redis no pudo avisar al worker de correo")


def send_email(job: dict) -> None:
    if not settings.SMTP_HOST:
        raise RuntimeError("SMTP sin configurar")
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = job["to"]
    msg["Subject"] = job["subject"]
    if job.get("message_id"):
        msg["Message-ID"] = job["message_id"]
    msg.set_content(job["body"])
    smtp = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10)
    try:
        if settings.SMTP_TLS:
            smtp.starttls(context=ssl.create_default_context())
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(msg)
    finally:
        smtp.close()


def deliver_next(db: Session) -> bool:
    now = utcnow()
    db.execute(
        update(OutgoingMail)
        .where(OutgoingMail.payload.is_not(None), OutgoingMail.expires_at <= now)
        .values(payload=None)
    )
    mail = db.scalar(
        select(OutgoingMail)
        .where(OutgoingMail.payload.is_not(None), OutgoingMail.failed_at.is_(None), OutgoingMail.next_attempt_at <= now)
        .order_by(OutgoingMail.next_attempt_at, OutgoingMail.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if mail is None:
        db.commit()
        return False
    try:
        job = json.loads(Fernet(settings.MAIL_ENCRYPTION_KEY).decrypt(mail.payload))
        send_email(job)
    except (OSError, smtplib.SMTPException, ValueError, InvalidToken, RuntimeError) as exc:
        mail.attempts += 1
        if mail.attempts > len(RETRY_DELAYS) or isinstance(exc, (ValueError, InvalidToken)):
            mail.failed_at = utcnow()
            log.error("Correo fallido id=%s tipo=%s", mail.id, type(exc).__name__)
        else:
            mail.next_attempt_at = utcnow() + timedelta(seconds=RETRY_DELAYS[mail.attempts - 1])
            log.warning("Correo pendiente id=%s intento=%s tipo=%s", mail.id, mail.attempts, type(exc).__name__)
    else:
        db.delete(mail)
    db.commit()
    return True


def link(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"
