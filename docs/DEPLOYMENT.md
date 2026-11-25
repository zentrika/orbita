# Guía de despliegue

## 1. Requisitos

* Un servidor Linux con Docker Engine 24+ y Docker Compose v2 (2 vCPU / 4 GB RAM como mínimo).
* Un dominio, por ejemplo `app.tudominio.com`, apuntando al servidor.
* Un proveedor SMTP (Postmark, SES, Mailgun…).
* Una imagen S3 compatible o un S3 gestionado (ver §4).

## 2. Variables de entorno

```bash
cp .env.example .env.production
```

Valores obligatorios en producción:

| Variable | Valor |
|---|---|
| `APP_ENV` | `production` (el backend se niega a arrancar si `SECRET_KEY` mide menos de 32 caracteres) |
| `SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `FRONTEND_URL`, `CORS_ORIGINS` | `https://app.tudominio.com` |
| `COOKIE_SECURE` | `true` (ya forzado en `docker-compose.prod.yml`) |
| `MYSQL_*` | contraseñas largas y únicas |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | credenciales largas y únicas |
| `SMTP_*` | credenciales de tu proveedor |
| `NEXT_PUBLIC_WS_URL` | `wss://app.tudominio.com/api/v1/ws` |
| `MINIO_IMAGE` | ver §4 |

Los secretos sólo se leen de variables de entorno; nunca se suben al repositorio (`.env*` está en `.gitignore`).

## 3. Arranque

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend \
  python -m app.cli create-admin --email tu@empresa.com --name "Tu Nombre" --org "Tu Empresa"
```

`create-admin` pide la contraseña de forma interactiva (no queda en el historial del shell).

## 4. Almacenamiento S3 / MinIO

En 2025 MinIO dejó de publicar imágenes comunitarias en Docker Hub, así que `minio/minio` ya no se puede descargar.
Opciones, de más a menos recomendada para producción:

1. **S3 gestionado** (AWS S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2): elimina el servicio `minio`,
   define `S3_ENDPOINT_URL` (déjalo vacío para AWS), `S3_REGION`, `S3_BUCKET` y las credenciales.
2. **Compilar MinIO** desde el código fuente oficial (`github.com/minio/minio`) y publicar la imagen en tu registro.
3. **Imagen de terceros** compatible, fijada por digest. Por ejemplo, el fork comunitario
   `pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372` o `cgr.dev/chainguard/minio`.
   Revísala antes de usarla.

El bucket se crea automáticamente en la primera subida y nunca es público: las descargas pasan por el backend,
que valida los permisos.

## 5. Proxy inverso con TLS (Caddy)

```caddy
app.tudominio.com {
    encode gzip
    @ws path /api/v1/ws
    reverse_proxy @ws 127.0.0.1:8000
    reverse_proxy 127.0.0.1:3000
    request_body { max_size 30MB }
}
```

El frontend reenvía `/api/*` al backend por la red interna; sólo el WebSocket va directo al backend.

## 6. Migraciones

* Al arrancar, el backend ejecuta **únicamente** `alembic upgrade head`: aplica las migraciones pendientes y nunca borra,
  recrea ni vacía tablas. No hay `drop_all` en el código de la aplicación (sólo en las pruebas, sobre una SQLite temporal).
* Crear una migración nueva en desarrollo:

  ```bash
  docker compose exec backend alembic revision --autogenerate -m "descripcion"
  ```

  Revisa siempre el archivo generado y escribe un `downgrade()` reversible.
* **Cambios incompatibles** (renombrar o eliminar columnas, cambiar tipos con pérdida): hazlos en varias versiones
  (añadir la columna nueva → copiar los datos → desplegar el código que la usa → eliminar la antigua en una versión posterior).
  Documenta el motivo en el docstring de la migración y haz una copia de seguridad antes de aplicarla.
* Revertir la última migración: `docker compose exec backend alembic downgrade -1`.

## 7. Copias de seguridad

```bash
# MySQL (diaria, por ejemplo con cron)
docker compose -f docker-compose.prod.yml exec -T mysql \
  sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines orbita' | gzip > orbita-$(date +%F).sql.gz

# Adjuntos: replica el bucket con `mc mirror` o la herramienta de tu proveedor S3.
```

Los volúmenes `mysql_data` y `minio_data` son persistentes. **Nunca** uses `docker compose down -v` en producción:
`-v` elimina los volúmenes y sus datos.

## 8. phpMyAdmin

Sólo existe en `docker-compose.yml` (desarrollo) y está ligado a `127.0.0.1`. Si necesitas inspeccionar la base de
datos en producción, usa un túnel SSH (`ssh -L 3306:127.0.0.1:3306`, después de publicar temporalmente el puerto) en lugar de exponer phpMyAdmin.

## 9. Lista de verificación

- [ ] `APP_ENV=production` y un `SECRET_KEY` único
- [ ] HTTPS activo y `COOKIE_SECURE=true`
- [ ] Contraseñas fuertes en MySQL y S3
- [ ] SMTP verificado (prueba "olvidé mi contraseña")
- [ ] Copias de seguridad programadas y probadas (restaurar al menos una vez)
- [ ] phpMyAdmin y Mailpit ausentes
- [ ] Monitorización de `/api/health`
