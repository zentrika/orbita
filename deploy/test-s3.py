"""Comprueba SeaweedFS con la configuración S3 del backend."""
from io import BytesIO
from uuid import uuid4

import boto3
from botocore import UNSIGNED
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings
from app.services.storage import S3Storage


def expect_status(operation, expected, **kwargs):
    try:
        operation(**kwargs)
    except ClientError as exc:
        status = exc.response["ResponseMetadata"]["HTTPStatusCode"]
        if status == expected:
            return
        raise
    raise AssertionError(f"{operation.__name__}: se esperaba HTTP {expected}")


def main():
    storage = S3Storage()
    client = storage.client
    client.head_bucket(Bucket=storage.bucket)
    anonymous = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        region_name=settings.S3_REGION,
        config=Config(signature_version=UNSIGNED, s3={"addressing_style": "path"},
                      connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 1}),
    )
    suffix = uuid4().hex
    bucket = f"orbita-smoke-{suffix}"
    key = "_smoke/adjunto.bin"
    storage.bucket = bucket
    client.create_bucket(Bucket=bucket)
    try:
        for payload in (b"orbita-s3", b"0123456789abcdef" * 655360):
            storage.put(key, BytesIO(payload), "application/octet-stream")
            assert b"".join(storage.stream(key)) == payload
            expect_status(anonymous.get_object, 403, Bucket=bucket, Key=key)
            expect_status(anonymous.put_object, 403, Bucket=bucket, Key=key, Body=b"test")
            client.delete_object(Bucket=bucket, Key=key)
            expect_status(client.head_object, 404, Bucket=bucket, Key=key)
    finally:
        client.delete_object(Bucket=bucket, Key=key)
        client.delete_bucket(Bucket=bucket)

    print("S3: bucket de adjuntos accesible, creación, subida simple y multiparte, descarga íntegra, acceso anónimo rechazado y borrado verificado.")


if __name__ == "__main__":
    main()
