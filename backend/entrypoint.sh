#!/bin/sh
# Arranque del backend: SOLO migraciones incrementales pendientes. Nunca borra ni recrea tablas.
set -e

echo "Esperando a MySQL..."
python - <<'PY'
import time, sys
from sqlalchemy import create_engine, text
from app.core.config import settings
for i in range(60):
    try:
        with create_engine(settings.DATABASE_URL).connect() as c:
            c.execute(text("SELECT 1"))
        sys.exit(0)
    except Exception as e:
        time.sleep(2)
sys.exit("MySQL no respondió a tiempo")
PY

echo "Aplicando migraciones pendientes (alembic upgrade head)..."
alembic upgrade head

if [ "$APP_ENV" = "development" ] && [ "$SEED_DEMO" = "true" ]; then
  echo "Cargando datos de demostración (idempotente)..."
  python -m app.cli seed-demo
fi

exec "$@"
