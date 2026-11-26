import logging

import redis
from botocore.exceptions import BotoCoreError, ClientError
from boto3.exceptions import S3UploadFailedError

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.api.routes import admin, auth, collab, insights, orgs, projects, tasks, workspace, ws
from app.core.config import settings
from app.core.db import engine
from app.core.redis import get_redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="Órbita API",
    version="1.0.0",
    description="API de Órbita: gestión de trabajo multiempresa.",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    first = errors[0] if errors else {"field": "", "message": "Datos no válidos"}
    return JSONResponse(status_code=422, content={"detail": f"{first['field']}: {first['message']}".strip(": "), "errors": errors})

@app.exception_handler(S3UploadFailedError)
@app.exception_handler(ClientError)
@app.exception_handler(BotoCoreError)
async def storage_unavailable(_: Request, exc: Exception):
    logging.getLogger(__name__).warning("Almacenamiento no disponible: %s", type(exc).__name__)
    return JSONResponse(status_code=503, content={"detail": "Almacenamiento temporalmente no disponible"})


@app.exception_handler(OperationalError)
@app.exception_handler(redis.RedisError)
async def service_unavailable(_: Request, exc: Exception):
    logging.getLogger(__name__).warning("Dependencia no disponible: %s", type(exc).__name__)
    return JSONResponse(status_code=503, content={"detail": "Servicio temporalmente no disponible"})


API = "/api/v1"
for r in (auth.router, auth.inv_router, orgs.router, projects.router, tasks.router, collab.router, collab.requests_router,
          workspace.router, insights.router, admin.router, ws.router):
    app.include_router(r, prefix=API)


@app.get("/api/health", tags=["system"])
def health():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    r = get_redis()
    if r is not None:
        r.ping()
    return {"status": "ok"}
