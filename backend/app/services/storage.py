"""Almacenamiento compatible con S3 (MinIO en local)."""

import logging
from collections.abc import Iterator
from typing import BinaryIO, Protocol

from app.core.config import settings

log = logging.getLogger(__name__)


class Storage(Protocol):
    def put(self, key: str, fileobj: BinaryIO, content_type: str) -> None: ...
    def stream(self, key: str) -> Iterator[bytes]: ...


class S3Storage:
    def __init__(self) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = settings.S3_BUCKET
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL or None,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        self._bucket_ready = False

    def _ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        from botocore.exceptions import ClientError

        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError:
            log.info("Creando bucket %s", self.bucket)
            self.client.create_bucket(Bucket=self.bucket)
        self._bucket_ready = True

    def put(self, key: str, fileobj: BinaryIO, content_type: str) -> None:
        self._ensure_bucket()
        self.client.upload_fileobj(fileobj, self.bucket, key, ExtraArgs={"ContentType": content_type})

    def stream(self, key: str) -> Iterator[bytes]:
        obj = self.client.get_object(Bucket=self.bucket, Key=key)
        yield from obj["Body"].iter_chunks(64 * 1024)


class MemoryStorage:
    """Usado en pruebas."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, fileobj: BinaryIO, content_type: str) -> None:
        self.objects[key] = fileobj.read()

    def stream(self, key: str) -> Iterator[bytes]:
        yield self.objects[key]


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = MemoryStorage() if settings.APP_ENV == "test" else S3Storage()
    return _storage
