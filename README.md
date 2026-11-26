# Órbita

Órbita es una plataforma SaaS multiempresa para gestionar proyectos, tareas, incidencias y tickets. Su dirección visual se llama «precisión tranquila»: clara, sobria y enfocada.

* **Frontend:** Next.js 15, TypeScript, Tailwind CSS, Radix UI, TanStack Query, dnd-kit y Tiptap.
* **Backend:** FastAPI, SQLAlchemy 2, Pydantic 2 y Alembic.
* **Infraestructura:** MySQL 8.4, Redis (pub/sub y colas), SeaweedFS (S3), WebSockets y un worker.

Arquitectura, modelo de datos, API y decisiones: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Despliegue: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Funciones del MVP

* **Cuentas:** registro, inicio de sesión, recuperación de contraseña, verificación de correo, invitaciones, varias empresas por usuario y sesiones revocables.
* **Aislamiento:** cada consulta se filtra por `organization_id`. Un recurso de otra empresa responde `404`, para no revelar que existe.
* **Roles:** administrador de plataforma; propietario, administrador, miembro e invitado de organización; gerente, miembro e invitado de proyecto. Siempre se validan en el backend.
* **Tareas:** cinco tipos (tarea, bug, historia, incidencia, ticket). Descripción rica, estados personalizables, prioridad, etiquetas, responsable, observadores, fechas, estimación, registro de tiempo, subtareas, checklist y relaciones (bloquea, depende de, duplica, relacionada con).
* **Colaboración:** comentarios con `@menciones`, adjuntos validados (tipo y tamaño), auditoría completa, notificaciones en tiempo real y recordatorios de vencimiento.
* **Vistas:** tablero Kanban con arrastrar y soltar, lista con filtros y orden, calendario arrastrable y cronograma con barras que se mueven o redimensionan y flechas de dependencia.
* **Gestión:** hitos, sprints, metas, alcance y un panel de métricas (pendientes, vencidas, carga por persona, progreso).
* **Interfaz:** modo oscuro, diseño adaptable a móvil y búsqueda global (⌘K).
* **Jerarquía y equipos:** CEO, PMO, líderes e integrantes; equipos con líder y QA; proyectos privados con acceso por equipo; tareas visibles por equipo; reasignación solo por líderes; transferencias entre equipos; capacidad de 4 tareas en progreso.
* **Comentarios:** respuestas, imágenes y documentos adjuntos, borrado solo por el autor y edición mediante solicitud aprobada por el líder (48 h, con versiones).
* **Oficina virtual, Centro de Operaciones y reconocimientos:** presencia real, notas adhesivas para CEO y PMO, ciclos QA, logros verificables y rachas por días laborales.

Las reglas detalladas están en [docs/ARCHITECTURE.md §9](docs/ARCHITECTURE.md).

## Puesta en marcha (desarrollo)

Necesitas Docker Desktop (o Docker Engine con Compose v2) y unos 6 GB libres en disco.

**1. Prepara las variables de entorno**

```bash
cp .env.example .env
```

**2. Almacenamiento.** Compose inicia SeaweedFS en nodo único y crea el bucket configurado en `S3_BUCKET`.

**3. Levanta el entorno**

```bash
docker compose up -d --build
```

Al arrancar, el backend espera a MySQL y ejecuta solo `alembic upgrade head`. Después carga los datos de demostración, de forma idempotente, porque `SEED_DEMO=true` y `APP_ENV=development`.

**4. Crea el primer administrador de plataforma**

```bash
docker compose exec backend python -m app.cli create-admin --email admin@tuempresa.com --name "Tu Nombre" --org "Tu Empresa"
```

El comando pide la contraseña de forma interactiva. Si el correo ya existe, promueve esa cuenta. `--org` también crea una organización de la que serás propietario.

### Servicios

| Servicio | URL |
|---|---|
| Aplicación | http://127.0.0.1:3000 |
| API y OpenAPI (Swagger) | http://127.0.0.1:8000/api/docs |
| phpMyAdmin (solo desarrollo) | http://127.0.0.1:8080 · usuario `orbita`, contraseña la de `MYSQL_PASSWORD` |
| Mailpit (correos de desarrollo) | http://127.0.0.1:8025 |

Todos los puertos se ligan a `127.0.0.1`, así que nada queda expuesto a la red local.

> Si otro proceso ocupa `localhost:3000` (por ejemplo un `next dev` que dejaste abierto), usa `http://127.0.0.1:3000`.

### Usuarios de demostración

Se crean con `SEED_DEMO=true` y solo en desarrollo. Todos usan la contraseña `Orbita2026!`.

| Correo | Rol en Acme Corp |
|---|---|
| marina@orbita.dev | Propietaria (también es miembro de Globex) |
| pedro@orbita.dev | Administrador |
| ana@orbita.dev, lucas@orbita.dev, sofia@orbita.dev | Miembros |
| cliente@orbita.dev | Invitada (solo ve el proyecto WEB) |
| pmo@orbita.dev | PMO |
| juan@orbita.dev, jesus@orbita.dev | Integrantes del Team 404 (líder: Pedro) |
| valentina@orbita.dev, tomas@orbita.dev | Team Bug Hunter (QA; líder: Valentina) |
| camilo@orbita.dev, diana@orbita.dev, andres@orbita.dev | Líderes de Brikers y 24/7, e integrante de soporte |
| otra@globex.dev | Propietaria de Globex, otra empresa, para comprobar el aislamiento |

El proyecto `SEC` es privado: los miembros que no se añadieron a él no lo ven.

## Pruebas

```bash
docker compose exec backend python -m pytest
```

Hay 37 pruebas sobre autenticación, permisos por rol y aislamiento entre organizaciones; y también sobre jerarquía, visibilidad por equipo, solicitudes de edición, reasignación, transferencias, capacidad, el caso VAT-1 de logros y las rachas. Usan una SQLite temporal y no tocan MySQL.

Para comprobar los tipos del frontend:

```bash
cd frontend && npm install && npx tsc --noEmit
```

## Protección de datos

* **Migraciones:** solo incrementales (`alembic upgrade head`). La aplicación no contiene `drop_all`, reinicios destructivos ni seeds que borren datos.
* **Volúmenes:** `mysql_data`, `seaweedfs_data` y `redis_data` son persistentes. No uses `docker compose down -v` salvo que quieras borrar todo.
* **Borrado lógico:** proyectos, tareas, comentarios y adjuntos se marcan como borrados y conservan su historial.

## Estructura

```
backend/   FastAPI (app/core, models, schemas, api/routes, services, worker.py, cli.py, seed.py), alembic/, tests/
frontend/  Next.js (src/app rutas, src/components ui|layout|tasks|views, src/lib api|auth|queries|realtime)
docs/      ARCHITECTURE.md, DEPLOYMENT.md
docker-compose.yml        desarrollo (incluye phpMyAdmin y Mailpit)
docker-compose.prod.yml   producción
```
