import logging
import time

import redis

from app.core.config import settings

log = logging.getLogger(__name__)
_client: redis.Redis | None = None


def get_redis() -> redis.Redis | None:
    """Cliente Redis síncrono. Devuelve None en pruebas o si no está configurado."""
    global _client
    if settings.APP_ENV == "test" or not settings.REDIS_URL:
        return None
    if _client is None:
        _client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True, socket_timeout=3)
    return _client


def rate_limit(key: str, limit: int, window_seconds: int) -> bool:
    """Ventana fija. Devuelve True si la petición está permitida."""
    r = get_redis()
    if r is None:
        return True
    bucket = f"rl:{key}:{int(time.time() // window_seconds)}"
    try:
        n = r.incr(bucket)
        if n == 1:
            r.expire(bucket, window_seconds)
        return n <= limit
    except redis.RedisError:
        log.warning("Redis no disponible para rate limit")
        return True
