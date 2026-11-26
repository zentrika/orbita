from datetime import timedelta

from cryptography.fernet import Fernet
from sqlalchemy import select

from app.core.db import SessionLocal, utcnow
from app.models import OutgoingMail
from app.services import mailer


def test_outbox_commit_retry_and_delivery(monkeypatch):
    monkeypatch.setattr(mailer.settings, "SMTP_HOST", "smtp.example.invalid")
    monkeypatch.setattr(mailer.settings, "MAIL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    sent = []

    def send(job):
        sent.append(job)
        if len(sent) == 1:
            raise TimeoutError

    monkeypatch.setattr(mailer, "send_email", send)
    with SessionLocal() as db:
        mailer.queue_email(db, "demo@example.com", "Prueba", "Token ficticio",
                           expires_at=utcnow() + timedelta(hours=1))
        with SessionLocal() as reader:
            assert reader.scalar(select(OutgoingMail)) is None
        db.commit()
        mail = db.scalar(select(OutgoingMail))
        assert b"Token ficticio" not in mail.payload
        assert mailer.deliver_next(db)
        assert mail.attempts == 1
        assert not mailer.deliver_next(db)
        mail.next_attempt_at = utcnow() - timedelta(seconds=1)
        db.commit()
        assert mailer.deliver_next(db)
        assert sent[0]["message_id"] == sent[1]["message_id"]
        assert db.scalar(select(OutgoingMail)) is None


def test_expired_email_is_never_sent(monkeypatch):
    monkeypatch.setattr(mailer.settings, "SMTP_HOST", "smtp.example.invalid")
    monkeypatch.setattr(mailer.settings, "MAIL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    sent = []
    monkeypatch.setattr(mailer, "send_email", sent.append)
    with SessionLocal.begin() as db:
        mailer.queue_email(db, "demo@example.com", "Prueba", "Token ficticio",
                           expires_at=utcnow() - timedelta(seconds=1))
    with SessionLocal() as db:
        assert not mailer.deliver_next(db)
        assert not sent
        assert db.scalar(select(OutgoingMail)).payload is None
