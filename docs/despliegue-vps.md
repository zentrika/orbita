# Despliegue de Órbita en ZENTRIKA

Ejecutar desde `/opt/zentrika/projects/corporate/orbita`. Los comandos Docker y de configuración del sistema corresponden al administrador en una terminal del VPS. Coordinar una ventana de mantenimiento con los responsables de Órbita. Revisar el informe de misión y resolver los bloqueos antes de abrir el servicio.

## Preparación

1. El registro A de `api.orbita.zentrika.tech` apunta a `179.236.84.201` según la confirmación de operaciones. Comprobar desde el VPS que coincida y que 80/443 sean accesibles. Publicar AAAA sólo si el VPS atiende en esa IPv6.
2. Inventariar los contenedores y volúmenes de Órbita antes de levantar el proyecto `orbita-vps`. Si MinIO contiene datos, suspender las escrituras y copiar los objetos mediante la API S3 a SeaweedFS antes de arrancar backend y worker. Conservar el bucket, las claves de objeto y los metadatos, y comparar cantidad y hashes. El volumen anterior se conserva para reversión. SeaweedFS crea su propio volumen `orbita-vps_seaweedfs_data` y su bucket al arrancar. [SeaweedFS 4.55](https://github.com/seaweedfs/seaweedfs/releases/tag/4.55).

```bash
dig +noall +comments +answer api.orbita.zentrika.tech A
dig +noall +comments +answer api.orbita.zentrika.tech AAAA
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
docker network inspect zentrika_network --format '{{json .IPAM.Config}}'
docker volume ls
```

El administrador debe editar `.env.production` directamente con un editor sin archivos de respaldo ni historial de recuperación. Conservar las contraseñas existentes de `orbita_user` y del buzón corporativo en `MYSQL_PASSWORD` y `SMTP_PASSWORD`. Poner los valores entre comillas simples para que Compose no expanda signos de dólar y escapar las comillas simples internas con barra invertida. Conservar `S3_ACCESS_KEY` y `S3_SECRET_KEY` existentes. Completar `FORWARDED_ALLOW_IPS` con la IP individual del gateway IPv4 por el que Docker entrega el tráfico publicado. Verificar ese origen con las pruebas de cabeceras. Nunca usar comodines o subredes completas. Guardar las claves generadas en el gestor de secretos para restauraciones y mantener el modo 600. Evitar `docker compose config` sin `--quiet` y volcados del entorno.

```bash
stat -c '%a %n' .env.production
git check-ignore .env.production
python3 deploy/test-smtp.py
```

Para SMTP, usar un buzón de pruebas autorizado y comprobar la recepción real. Registrar el resultado y el código del servidor si rechaza la prueba. Mantener el alias tanto como remitente del sobre SMTP como en la cabecera From.

## Construcción, copia y migración

Usar una etiqueta nueva para cada compilación y conservar la etiqueta anterior. Ejecutar estos pasos en orden y detenerse ante cualquier fallo. Si existe una versión activa de Órbita, detener sus escritores y su worker durante la copia y la migración. Identificar los contenedores por nombre y proyecto antes de detenerlos.

```bash
set -e
export ORBITA_IMAGE_TAG=m002-20261126-seaweedfs
dc() { docker compose --parallel 1 --env-file .env.production -f docker-compose.vps.yml "$@"; }
dc config --quiet
dc pull redis seaweedfs
dc run --rm --no-deps --entrypoint curl seaweedfs --version
dc build --pull backend
dc run --rm --no-deps backend alembic current
dc run --rm --no-deps backend python -c 'from app.core.db import engine; from sqlalchemy import text; c=engine.connect(); print(c.execute(text("SELECT VERSION(), DATABASE()")).one()); c.close()'
```

Verificar que la base sea `orbita` en MySQL 8.4. Si Alembic no presenta una revisión y ya hay tablas de Órbita, revisar esquema e historial antes de continuar. Si una revisión falla, inspeccionar también los cambios de DDL que MySQL pudo haber confirmado.

```bash
umask 077
install -d -m 0700 /var/backups/orbita
backup="/var/backups/orbita/orbita-$(date -u +%Y%m%dT%H%M%SZ).sql"
docker exec Mysql sh -ceu 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF --routines --triggers --events orbita' > "$backup.part"
test -s "$backup.part"
tail -n 5 "$backup.part" | grep -F -- '-- Dump completed'
mv "$backup.part" "$backup"
sha256sum "$backup" > "$backup.sha256"
sha256sum -c "$backup.sha256"
```

Validar la restauración en un esquema aislado bajo control del DBA antes de aplicar migraciones. El respaldo de MySQL no incluye los objetos S3 ni la persistencia de Redis. Si ya existen, copiar esos datos por separado y validar su restauración coordinada. Tras confirmar la copia y la revisión inicial, ejecutar:

```bash
dc run --rm --no-deps backend alembic upgrade head
dc run --rm --no-deps backend alembic current
dc up -d --wait --wait-timeout 180 redis seaweedfs
dc run --rm --no-deps -T backend python - < deploy/test-s3.py
# Si había objetos en MinIO, completa y verifica la copia S3 antes de este paso.
dc up -d --no-build --wait --wait-timeout 180
dc ps
dc exec -T redis redis-cli ping
curl -fsS http://127.0.0.1:8000/api/health
docker stats --no-stream $(dc ps -q)
```

En `alembic current` se espera `72bb2e960ba9 (head)`. Revisar memoria y CPU en reposo y repetir con concurrencia representativa, incluido el worker y transferencias. Verificar que Redis y SeaweedFS carezcan de puertos publicados con `docker inspect --format '{{json .HostConfig.PortBindings}}' "$(dc ps -q seaweedfs)" "$(dc ps -q redis)"`. SeaweedFS usa una red interna, un límite de 768 MiB y 0,5 vCPU. Su comprobación de salud firma un `HeadBucket` con SigV4. La prueba S3 usa un bucket temporal con nombre aleatorio y borra únicamente sus propios objetos y bucket.

## HTTPS

Instalar Nginx y Certbot desde repositorios aprobados si faltan. Revisar primero sitios existentes y listeners. Las rutas siguientes corresponden al esquema de configuración de Debian/Ubuntu. Usar una dirección de operaciones autorizada para Let's Encrypt.

```bash
apt-get install nginx certbot
install -d -m 0755 /var/lib/letsencrypt
install -m 0644 deploy/nginx/orbita-api.http.conf /etc/nginx/sites-available/orbita-api-http
ln -s /etc/nginx/sites-available/orbita-api-http /etc/nginx/sites-enabled/orbita-api-http
nginx -t
systemctl reload nginx
certbot certonly --webroot -w /var/lib/letsencrypt --domain api.orbita.zentrika.tech
install -m 0644 deploy/nginx/orbita-api.https.conf /etc/nginx/sites-available/orbita-api-https
ln -s /etc/nginx/sites-available/orbita-api-https /etc/nginx/sites-enabled/orbita-api-https
nginx -t
systemctl reload nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/orbita-reload-nginx
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/orbita-reload-nginx
systemctl enable --now certbot.timer
certbot renew --dry-run
curl -fsS https://api.orbita.zentrika.tech/api/health
```

Verificar desde una red externa la cadena de confianza, el host y las cabeceras HTTPS. Comparar la IP guardada en una sesión sintética con la IP real del cliente aunque se envíe un `X-Forwarded-For` de prueba diferente. Si se guarda el gateway, revisar qué IP llega realmente a Uvicorn desde Nginx y el valor de `FORWARDED_ALLOW_IPS`.

## Vercel y aceptación

Configurar el entorno Production del proyecto Next.js, con raíz `frontend` y dominio `orbita.zentrika.tech`, y reconstruir tras fijar estas variables:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_API_ORIGIN` | `https://api.orbita.zentrika.tech` |
| `NEXT_PUBLIC_WS_URL` | `wss://api.orbita.zentrika.tech/api/v1/ws` |
| `BACKEND_INTERNAL_URL` | `https://api.orbita.zentrika.tech`, para el proxy Next.js existente |

Las solicitudes del navegador incluyen credenciales y la cookie de refresco queda en el host API. Ambos dominios deben usar HTTPS. El navegador debe iniciar una sesión nueva al pasar de una cookie del frontend a la del host API. Probar desde el dominio de producción con cuentas y datos de ensayo:

- Registrar dos usuarios en organizaciones distintas. Iniciar sesión, refrescar la sesión, cerrar sesión y confirmar revocación. Probar verificación de correo y recuperación completa. Comprobar permisos de la cookie y respuesta CORS con orígenes autorizado y ajeno.
- Crear proyecto y tarea. Subir y descargar un archivo sintético pequeño y otro que supere el límite de Vercel Functions sin exceder 25 MiB. Comparar SHA-256, y comprobar rechazo de un archivo mayor de 25 MiB.
- Intentar descargar y eliminar el adjunto desde la segunda organización y comprobar HTTP 404. Comprobar HTTP 401 al descargar sin sesión. Eliminarlo con la cuenta que lo subió y verificar que deja de aparecer y descargar. La API aplica borrado lógico y conserva el objeto S3.
- Intentar leer y editar datos de la primera organización con la segunda. Comprobar el rechazo por HTTP y que ese usuario no pueda suscribirse al WebSocket de la primera.
- Abrir dos sesiones autorizadas en navegadores diferentes. Comprobar `ready`, `ping/pong`, invalidación tras cambio de tarea y cierre del canal al revocar una sesión. Revisar el estado y recursos de contenedores durante la prueba.
- Confirmar la recepción en el buzón de pruebas, comprobar el estado de los reintentos y revisar errores sin copiar payloads ni secretos. El worker reintenta hasta cinco veces tras el intento inicial y guarda fallos terminales. Un corte tras la aceptación de SMTP y antes del commit puede ocasionar reentrega con el mismo Message-ID. Los payloads cifrados se borran al expirar y las filas fallidas conservan metadatos. Una clave nueva requiere drenar los trabajos cifrados con la clave anterior.

## Reversión

Cerrar el acceso público si la aceptación falla. Detener sólo los escritores de este proyecto mediante `dc stop backend worker`. Conservar configuración, volúmenes, imágenes y registro del incidente. Si existe una imagen anterior compatible con el esquema actualizado, restablecer su etiqueta en `ORBITA_IMAGE_TAG` y ejecutar `dc up -d --no-build --wait backend worker` con su Compose correspondiente. Revertir también a la versión compatible de Vercel si es necesario.

Si el cambio de esquema impide el retorno, conservar una copia adicional del estado actual y delegar al DBA la restauración verificada de la copia previa en un destino aislado. Comparar datos y reconciliar escrituras realizadas desde la copia antes de cambiar el destino de la aplicación. Evitar el downgrade automático, en particular si la bandeja de correo conserva trabajos pendientes. Volver a ejecutar las pruebas de aceptación antes de reabrir el tráfico.
