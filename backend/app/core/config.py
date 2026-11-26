import base64
import hashlib
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from sqlalchemy.engine import URL

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_ENV: str = "development"  # development | production | test
    APP_NAME: str = "Órbita"
    FRONTEND_URL: str = "http://localhost:3000"
    CORS_ORIGINS: str = "http://localhost:3000"

    SECRET_KEY: str = "change-me"
    ACCESS_TOKEN_MINUTES: int = 15
    REFRESH_TOKEN_DAYS: int = 30
    COOKIE_SECURE: bool = False

    DATABASE_URL: str = "mysql+pymysql://orbita:orbita@mysql:3306/orbita?charset=utf8mb4"
    MYSQL_PASSWORD: str = ""
    REDIS_URL: str = "redis://redis:6379/0"

    S3_ENDPOINT_URL: str = "http://seaweedfs:8333"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET: str = "orbita-attachments"
    S3_REGION: str = "us-east-1"

    MAX_UPLOAD_MB: int = 25
    ALLOWED_UPLOAD_TYPES: str = (
        "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,text/plain,text/csv,"
        "text/markdown,application/zip,application/json,"
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document,"
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,"
        "application/vnd.openxmlformats-officedocument.presentationml.presentation,"
        "application/msword,application/vnd.ms-excel,application/octet-stream"
    )

    MAIL_ENCRYPTION_KEY: str = ""
    SMTP_HOST: str = ""
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "Órbita <no-reply@orbita.local>"
    SMTP_TLS: bool = False

    SEED_DEMO: bool = False
    REMINDER_HOURS_BEFORE: int = 24

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_upload_types(self) -> set[str]:
        return {t.strip() for t in self.ALLOWED_UPLOAD_TYPES.split(",") if t.strip()}


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_production:
        if s.SECRET_KEY in ("", "change-me") or len(s.SECRET_KEY) < 32:
            raise RuntimeError("SECRET_KEY debe definirse (>= 32 caracteres) en producción")
        if not s.MYSQL_PASSWORD and s.DATABASE_URL == Settings.model_fields["DATABASE_URL"].default:
            raise RuntimeError("Configura la conexión MySQL de producción")
        if s.MYSQL_PASSWORD:
            s.DATABASE_URL = URL.create(
                "mysql+pymysql", username="orbita_user", password=s.MYSQL_PASSWORD,
                host="mysql", port=3306, database="orbita", query={"charset": "utf8mb4"},
            ).render_as_string(hide_password=False)
        if not s.COOKIE_SECURE or not s.cors_origins or any(
            urlsplit(origin).scheme != "https" or not urlsplit(origin).hostname
            or urlsplit(origin).path or urlsplit(origin).query or urlsplit(origin).fragment
            for origin in [s.FRONTEND_URL, *s.cors_origins]
        ):
            raise RuntimeError("Configura cookies seguras y orígenes HTTPS en producción")
        if not s.SMTP_TLS or not all((s.SMTP_HOST, s.SMTP_USER, s.SMTP_PASSWORD)):
            raise RuntimeError("Configura SMTP autenticado con TLS en producción")
        if s.S3_ACCESS_KEY == "minioadmin" or len(s.S3_SECRET_KEY) < 32:
            raise RuntimeError("Configura credenciales S3 de producción")
    elif not s.MAIL_ENCRYPTION_KEY:
        s.MAIL_ENCRYPTION_KEY = base64.urlsafe_b64encode(hashlib.sha256(s.SECRET_KEY.encode()).digest()).decode()
    try:
        Fernet(s.MAIL_ENCRYPTION_KEY)
    except (ValueError, TypeError):
        raise RuntimeError("MAIL_ENCRYPTION_KEY no es una clave Fernet válida") from None
    return s


settings = get_settings()
