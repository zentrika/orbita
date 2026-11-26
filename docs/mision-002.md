# Misión 002 — Órbita Backend en el VPS

Fecha 2026-11-26 UTC. Usuario `codex`. Rama local `mision-002-vps`. Se actualizaron los tres Compose para usar el mismo almacén S3.

## Estado

**Cambios y verificación local completados. Arranque y aceptación en el VPS pendientes.** Operaciones confirmó que el registro A de `api.orbita.zentrika.tech` apunta a `179.236.84.201`. El daemon de Docker requiere un administrador. Queda por establecer `FORWARDED_ALLOW_IPS` con el gateway IPv4 verificado. La configuración del VPS conserva las credenciales S3 de `.env.production` y arranca SeaweedFS en un volumen propio. [Procedimiento de despliegue y reversión](despliegue-vps.md).

## Revisión de seguridad

- **Dependencias.** `pip-audit --local` señaló inicialmente 62 avisos, con identificadores repetidos, en cinco paquetes. Tras los parches de FastAPI/Starlette, criptografía, JWT, multipart y pytest, la misma auditoría indicó cero vulnerabilidades conocidas en el entorno instalado. Uvicorn se actualizó junto con el stack ASGI. La auditoría inicial de Vercel señaló 29 entradas, incluida una crítica. El parche de Next.js 15.5.29 eliminó la categoría crítica del resultado inmediato de npm. PostCSS 8.5.23 y Sharp 0.35.5 corrigen los avisos pendientes, incluidas las copias transitivas. El último `npm audit` dejó 26 entradas moderadas relacionadas con Tiptap y cero altas o críticas. La compilación de producción de Next.js 15.5.29 pasó.
- **Autenticación y aislamiento.** JWT exige algoritmo fijo, claims de tiempo y sesión válida sin revocación. La rotación de refresh y el consumo del token de correo bloquean la fila en MySQL. Refresh y logout validan el origen en producción. WebSocket valida sesión, membresía, origen, proyecto y tarea, incluidos cambios de autorización durante la conexión. Los límites de autenticación dependen de Redis en producción y se cierran ante indisponibilidad.
- **Red.** El Compose contiene backend, worker, Redis y SeaweedFS. Los dos primeros comparten `zentrika_network`. Redis y SeaweedFS tienen una red privada y almacenamiento persistente. Nginx reemplaza cabeceras reenviadas, y Uvicorn sólo debe confiar en el gateway individual verificado. El puerto publicado es loopback.
- **Correo.** Se usa STARTTLS con verificación de certificados. La bandeja cifrada se confirma en la misma transacción que el token. Redis avisa al worker y un sondeo recupera trabajos pendientes si se pierde el aviso. Hay cinco reintentos escalonados tras el intento inicial, metadatos de fallo y borrado del payload al expirar. La aceptación SMTP seguida de un corte antes del commit puede producir un duplicado con el mismo Message-ID. La importación de una cola Redis existente también puede repetir un trabajo si hay un corte entre el commit y su retirada de Redis.
- **SeaweedFS.** Imagen oficial 4.55 en modo de nodo único, autenticación S3 con las credenciales existentes, comprobación SigV4, persistencia en `/data`, 768 MiB de RAM, 0,5 vCPU y red interna sin publicaciones. El volumen anterior de MinIO se conserva para copia S3 o reversión. [Versión oficial](https://github.com/seaweedfs/seaweedfs/releases/tag/4.55).
- **Errores y datos.** Se añadieron límites de conexión en clientes, manejo de dependencias no disponibles y ocultamiento de parámetros SQL. Nginx y Uvicorn desactivan el registro de accesos de la API. La restauración coordinada de base y adjuntos sigue pendiente.

## Pruebas

| Prueba | Resultado |
| --- | --- |
| Suite backend | 40 casos aprobados con SQLite y datos sintéticos. Incluye registro, login, rotación, revocación, verificación, restablecimiento, aislamiento, flujos, adjuntos en memoria y dos pruebas de bandeja SMTP. |
| Compilación de Python y sintaxis del entrypoint | Correctas. |
| Compose | Configuración aceptada con valores ficticios. Servicios enumerados como backend, worker, Redis y SeaweedFS. |
| Imagen backend | La compilación se intentó. El daemon rechazó el acceso de `codex` al socket Docker. |
| MySQL 8.4 | Se verificó el alias de red en su Compose. La autenticación de `orbita_user`, permisos y restauración previa no se pudieron verificar. |
| Alembic | Generó SQL MySQL offline para las tres revisiones hasta `72bb2e960ba9`. Sigue pendiente ejecución contra un esquema MySQL y verificación de la migración real. |
| Redis y WebSockets | Prueba con Redis 7.0.15 real en socket Unix temporal, SQLite y dos organizaciones ficticias. Aprobó PING, health, autenticación, ready, ping/pong, pub/sub, aislamiento y cierre por revocación. Sigue pendiente Redis 8 y WebSocket público por Nginx. |
| Adjuntos | Permisos HTTP de descarga y borrado lógico comprobados con SQLite y SeaweedFS real. El binario oficial SeaweedFS 4.55 aprobó creación de bucket, subida simple y multiparte, descarga íntegra, rechazo anónimo, borrado S3 y healthcheck SigV4. Pendiente repetir en Docker del VPS. |
| SMTP | Hostinger respondió en 587 con STARTTLS, TLS 1.3 y certificado válido. Autenticación, aceptación del alias y recepción real pendientes. |
| Nginx | `nginx -t` aprobado con ambas plantillas, puertos altos y certificado de prueba. Integración, Let's Encrypt y renovación pendientes. |
| DNS y HTTPS público | A confirmado por operaciones. HTTPS público pendiente. |
| Cliente Vercel | `npm run build` aprobado. La validación en navegador desde el dominio Vercel sigue pendiente. |
| Contenedores y consumo real | Pendientes estado de salud, CPU y memoria en reposo y carga. |
