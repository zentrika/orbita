"""Presencia real: el WebSocket renueva una clave con caducidad en cada latido (heartbeat).

Una persona está «en línea» mientras su clave exista: si cierra la pestaña o pierde la conexión,
la clave caduca a los PRESENCE_TTL segundos aunque su sesión siga iniciada.
"""

import time

import redis

from app.core.redis import get_redis

PRESENCE_TTL = 70


def _key(org_id: int, user_id: int) -> str:
    return f"presence:{org_id}:{user_id}"


def heartbeat(org_id: int, user_id: int) -> None:
    r = get_redis()
    if r is None:
        return
    try:
        r.set(_key(org_id, user_id), int(time.time()), ex=PRESENCE_TTL)
    except redis.RedisError:
        pass


def online_users(org_id: int) -> dict[int, int]:
    """{user_id: último latido (epoch)}"""
    r = get_redis()
    if r is None:
        return {}
    try:
        keys = list(r.scan_iter(match=f"presence:{org_id}:*", count=500))
        values = r.mget(keys) if keys else []
    except redis.RedisError:
        return {}
    return {int(k.rsplit(":", 1)[1]): int(v) for k, v in zip(keys, values) if v}
