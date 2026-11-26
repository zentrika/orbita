import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import settings

_ph = PasswordHasher()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: int, session_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "sid": session_id,
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_MINUTES),
        "typ": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        data = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM], options={"require": ["exp", "iat", "sub", "sid"]})
    except jwt.PyJWTError:
        return None
    if data.get("typ") != "access" or type(data["sid"]) is not int:
        return None
    return data


def password_is_strong(password: str) -> bool:
    return (
        len(password) >= 8
        and any(c.isalpha() for c in password)
        and any(c.isdigit() for c in password)
    )
