# Órbita — Arquitectura

Órbita es un SaaS multiempresa de gestión de trabajo (proyectos, tareas, incidencias y tickets).
Este documento resume el alcance, la arquitectura, el modelo de datos, la API y las decisiones tomadas.

## 1. Vista general

```
             ┌──────────────┐  HTTPS   ┌───────────────────────┐
  Navegador ─┤  Next.js 15  ├─────────►│  /api/* (proxy Node)  │
             │  (frontend)  │          └──────────┬────────────┘
             └──────┬───────┘                     │ HTTP interno
                    │ WebSocket                   ▼
                    │                   ┌──────────────────┐     ┌─────────┐
                    └──────────────────►│ FastAPI (backend)├────►│ MySQL 8 │
                                        └──┬─────────┬─────┘     └─────────┘
                                 pub/sub   │         │ S3 API
                                ┌──────────▼┐     ┌──▼─────┐
                                │   Redis   │     │ MinIO  │
                                └──────▲────┘     └────────┘
                                       │ cola de correos / eventos
                                ┌──────┴──────┐
                                │   Worker    │  recordatorios de vencimiento, envío de correo
                                └─────────────┘
```

* **Frontend** (`frontend/`): Next.js (App Router) + TypeScript + Tailwind. El navegador sólo habla con el
  mismo origen: un *route handler* (`app/api/[...path]/route.ts`) reenvía `/api/*` al backend en tiempo de
  ejecución, de modo que la cookie de refresco (`httpOnly`, `SameSite=Strict`) nunca cruza orígenes.
  El WebSocket se conecta directo al backend (`NEXT_PUBLIC_WS_URL`) y se autentica con el primer mensaje
  (el token nunca viaja en la URL ni queda en logs).
* **Backend** (`backend/`): FastAPI + SQLAlchemy 2 (síncrono, PyMySQL) + Pydantic 2 + Alembic. Las rutas
  HTTP son síncronas (pool de hilos); el WebSocket es asíncrono y escucha Redis pub/sub.
* **Worker** (`app/worker.py`): proceso independiente que consume la cola de correos en Redis y genera
  recordatorios de tareas próximas a vencer.
* **Almacenamiento**: adjuntos en un bucket S3 (MinIO en local). Las descargas pasan por el backend, que
  valida permisos antes de transmitir el archivo; el bucket nunca es público.

## 2. Multiempresa y aislamiento

* Toda entidad de negocio tiene `organization_id` (proyectos, tareas, comentarios, adjuntos, etiquetas,
  estados, hitos, sprints, metas, actividad, notificaciones, registros de tiempo…).
* Todas las rutas de negocio viven bajo `/api/v1/orgs/{org_id}/…`. La dependencia `get_org_ctx`
  verifica que el usuario autenticado sea miembro activo de esa organización **antes** de ejecutar
  cualquier consulta, y devuelve el contexto (`org_id`, rol).
* Los helpers de carga (`load_project`, `load_task`, …) filtran **siempre** por `organization_id`
  del contexto, además de por id. Un id válido de otra empresa responde `404` (no `403`) para no
  revelar existencia.
* Los eventos en tiempo real sólo transportan identificadores (`type`, `project_id`, `task_id`); el
  cliente vuelve a pedir los datos por HTTP, donde se aplican los permisos completos.
* Pruebas automáticas (`backend/tests/test_isolation.py`) intentan leer, modificar y comentar recursos de
  otra organización y verifican el rechazo.

## 3. Roles y permisos

| Ámbito | Rol | Descripción |
|---|---|---|
| Plataforma | `is_platform_admin` | Gestiona la plataforma (empresas, usuarios, suspensión). **No** ve contenido de negocio de las empresas. |
| Organización | `owner` | Propietario. Todo, incluido transferir la propiedad y eliminar la empresa. |
| Organización | `admin` | Administra miembros, equipos, invitaciones y todos los proyectos. |
| Organización | `member` | Crea proyectos, trabaja en proyectos abiertos a la organización o donde es miembro. |
| Organización | `guest` | Invitado/cliente: sólo ve los proyectos a los que se le añade explícitamente. |
| Proyecto | `manager` | Gerente de proyecto: todo dentro del proyecto. |
| Proyecto | `member` | Ver, crear, editar, comentar, adjuntar. Elimina sólo lo que creó. |
| Proyecto | `guest` | Ver, comentar y adjuntar. |

Rol efectivo en un proyecto (`app/api/permissions.py`):

1. `owner`/`admin` de la organización → `manager`.
2. Si existe fila en `project_members` → ese rol (para invitados de organización se limita a `guest`).
3. `member` de la organización y proyecto con visibilidad `organization` → `member`.
4. En otro caso → sin acceso (`404`).

Acciones: `view`, `create`, `edit`, `comment`, `attach`, `manage`, `delete`. Se validan siempre en el
backend; la interfaz sólo oculta controles usando el campo `my_role`/`permissions` que devuelve la API.

## 4. Modelo de datos (MySQL 8, `utf8mb4`)

Identidad y sesión
* `users` — email único, `password_hash` (Argon2id), `email_verified_at`, `is_platform_admin`, `is_active`.
* `user_sessions` — una fila por sesión; hash SHA-256 del refresh token (rotación en cada uso), IP, agente, expiración, revocación.
* `email_tokens` — tokens de verificación y recuperación (sólo se guarda el hash; un uso; caducan).

Organización
* `organizations` — nombre, `slug` único, plan.
* `memberships` — (`organization_id`, `user_id`) único, rol.
* `invitations` — email, rol, hash del token, caducidad, aceptación.
* `teams`, `team_members`.

Proyectos
* `projects` — `key` (p. ej. `WEB`) único por organización, visibilidad, contador `task_seq`, alcance, fechas, borrado lógico.
* `project_members` — rol por proyecto.
* `workflow_statuses` — estados personalizables por proyecto con `category` (`todo`, `in_progress`, `review`, `done`, `blocked`), color y posición.
* `labels`, `milestones`, `sprints`, `goals`.

Trabajo
* `tasks` — `number` por proyecto (clave visible `WEB-42`), `type` (`task`, `bug`, `story`, `incident`, `ticket`), título, descripción rica (HTML saneado con `nh3`), estado, prioridad, responsable, informador, `parent_id`, hito, sprint, `start_date`, `due_date`, `estimate_minutes`, `position` (orden en Kanban), `completed_at`, `deleted_at`, `due_reminder_sent_at`.
* `task_labels`, `task_watchers`, `checklist_items`, `task_relations` (`blocks`, `depends_on`, `duplicates`, `relates_to`), `time_entries`.

Colaboración
* `comments` (con menciones `@usuario` → notificaciones), `attachments` (clave en S3, tipo y tamaño validados), `activity_logs` (quién, qué, cuándo, diff JSON), `notifications`.

Índices: todas las tablas de negocio indexan `organization_id`; `tasks` tiene índices compuestos
`(organization_id, project_id, status_id)` y `(organization_id, assignee_id)` y `(organization_id, due_date)`.

## 5. API (resumen — documentación completa en `/api/docs`)

```
POST   /api/v1/auth/register | login | refresh | logout
POST   /api/v1/auth/verify-email | resend-verification | forgot-password | reset-password
GET    /api/v1/auth/me                     PATCH /api/v1/auth/me
GET    /api/v1/auth/sessions               DELETE /api/v1/auth/sessions/{id}
GET    /api/v1/invitations/{token}         POST /api/v1/invitations/{token}/accept

GET|POST        /api/v1/orgs
GET|PATCH       /api/v1/orgs/{org}
GET             /api/v1/orgs/{org}/members         PATCH|DELETE …/members/{user}
GET|POST        /api/v1/orgs/{org}/invitations     DELETE …/invitations/{id}
GET|POST        /api/v1/orgs/{org}/teams           PATCH|DELETE …/teams/{id}
GET             /api/v1/orgs/{org}/dashboard
GET             /api/v1/orgs/{org}/my-work
GET|POST        /api/v1/orgs/{org}/notifications   POST …/notifications/read-all
GET             /api/v1/orgs/{org}/search?q=

GET|POST        /api/v1/orgs/{org}/projects
GET|PATCH|DEL   /api/v1/orgs/{org}/projects/{p}
GET|POST|DEL    /api/v1/orgs/{org}/projects/{p}/members
GET|POST|PATCH|DEL …/projects/{p}/statuses | labels | milestones | sprints | goals
GET             /api/v1/orgs/{org}/projects/{p}/activity

GET|POST        /api/v1/orgs/{org}/tasks            (filtros: project_id, status_id, assignee_id, type, priority, label_id, sprint_id, q, due_from, due_to, sort)
GET|PATCH|DEL   /api/v1/orgs/{org}/tasks/{t}
POST            /api/v1/orgs/{org}/tasks/{t}/move   (estado + posición, Kanban)
…/tasks/{t}/checklist | relations | time-entries | watchers | comments | attachments | activity

GET  /api/v1/admin/organizations | users       PATCH /api/v1/admin/users/{id}   (sólo administrador de plataforma)
WS   /api/v1/ws
```

## 6. Estructura de carpetas

```
backend/
  app/
    core/       config, base de datos, seguridad (JWT, Argon2), límites de peticiones
    models/     modelos SQLAlchemy por dominio
    schemas/    esquemas Pydantic (entrada/salida)
    api/        deps (auth, contexto de organización), permissions, routes/*
    services/   auditoría, notificaciones, tiempo real, almacenamiento S3, correo, saneado HTML
    worker.py   proceso de cola y recordatorios
    cli.py      create-admin, seed-demo
  alembic/      migraciones incrementales
  tests/        auth, permisos, aislamiento
frontend/
  src/app/      rutas (auth, onboarding, /o/[orgId]/…)
  src/components/  UI base, tablero, lista, calendario, cronograma, panel de detalle
  src/lib/      cliente API, auth, tiempo real, tipos, utilidades
```

## 7. Fases

**Fase 1 — MVP funcional (implementada en este repositorio)**
Autenticación completa (registro, login, refresco con rotación, sesiones, verificación, recuperación,
invitaciones), multiempresa con aislamiento, roles de organización y proyecto, equipos, proyectos con
estados/etiquetas/hitos/sprints/metas, tareas con todos los campos pedidos, subtareas, checklist,
relaciones, registro de tiempo, observadores, comentarios con menciones, adjuntos en MinIO, auditoría,
notificaciones en tiempo real, recordatorios, Kanban, lista, calendario, cronograma arrastrable,
panel de métricas, modo oscuro, diseño responsive, pruebas, Docker Compose.

**Fase 2 — Funciones avanzadas**
Automatizaciones (reglas "cuando X entonces Y"), campos personalizados, vistas guardadas, plantillas de
proyecto, informes de burndown/velocidad por sprint, importación CSV/Jira, búsqueda de texto completo
(MySQL FULLTEXT o OpenSearch), edición colaborativa de descripciones, integraciones (Slack, GitHub),
portal de clientes para tickets, SLA de incidencias, 2FA/TOTP y SSO (SAML/OIDC).

**Fase 3 — Preparación comercial**
Planes y facturación (Stripe) con límites por plan (usuarios, almacenamiento), panel de administración de
plataforma ampliado, exportación de datos y borrado por empresa (RGPD), retención y copias de seguridad
automatizadas, observabilidad (OpenTelemetry, Sentry), límites de peticiones por organización, dominios
y marca propia, página de estado, términos y DPA.

## 8. Decisiones (ambigüedades resueltas)

1. **Administrador de plataforma sin acceso a contenido**: para garantizar el aislamiento, sólo ve
   metadatos agregados (empresas, número de usuarios/proyectos) y puede suspender usuarios.
2. **Verificación de correo no bloqueante**: un usuario sin verificar puede usar la app (banner de aviso);
   aceptar una invitación exige que el correo de la cuenta coincida con el invitado.
3. **Invitado/cliente** puede ver, comentar y adjuntar en proyectos donde se le añadió; no crea tareas.
4. **Descripción rica** se guarda como HTML saneado en el servidor (lista blanca de etiquetas).
5. **Descargas a través del backend** en lugar de URLs prefirmadas, para no exponer MinIO y validar permisos en cada descarga.
6. **Borrado lógico** en proyectos, tareas, comentarios y adjuntos (`deleted_at`). No existe borrado físico desde la API.
7. **Migraciones**: el contenedor del backend ejecuta sólo `alembic upgrade head` al arrancar. Nunca `drop_all`.
   Los datos de demostración son idempotentes (buscar-o-crear) y sólo se cargan con `APP_ENV=development` y `SEED_DEMO=true`.
8. **Correo**: el worker envía por SMTP. En desarrollo se usa Mailpit (`http://localhost:8025`) y los enlaces también se imprimen en el log del backend.
9. **Imagen de MinIO configurable** (`MINIO_IMAGE`): MinIO dejó de publicar imágenes comunitarias en Docker Hub en 2025.
   El código usa la API S3 estándar (boto3), así que funciona igual con MinIO, AWS S3, R2 u otros compatibles.
10. **Estados como texto validado** (`String` + `Literal` en Pydantic) en lugar de `ENUM` de MySQL: añadir un valor nuevo
    no requiere una migración que altere la tabla.

## 9. Jerarquía, equipos y flujo de trabajo (fase 1.1)

### Jerarquía

| Rol | Dónde | Puede |
|---|---|---|
| CEO | `memberships.role = owner` | Todo. |
| Administrador | `admin` | Gestiona miembros, equipos y todos los proyectos. |
| PMO | `pmo` | Gerente de todos los proyectos: crea, asigna, transfiere y borra tareas. Recibe avisos de las solicitudes de edición y consulta su historial, pero **no** las aprueba. |
| Líder de equipo | `teams.lead_id` | Edita, reasigna y transfiere las tareas de su equipo. Aprueba las ediciones de comentarios de sus integrantes. |
| Integrante | `team_members` | Ve los proyectos a los que su equipo tiene acceso y las tareas de su equipo o sin equipo. Edita solo lo que creó. Cambia el estado de lo que tiene asignado. **No** reasigna. |
| Equipo QA | `teams.is_qa` | Ve todas las tareas de los proyectos donde tiene acceso, y valida o rechaza las entregas. |

### Reglas clave
* **Proyectos privados por defecto.** Los ven su creador, las personas añadidas, los equipos con acceso (`project_teams`) y la dirección (CEO, administración y PMO). Para sacar a alguien de un proyecto basta con quitarlo de sus personas o equipos.
* **Visibilidad de tareas por equipo.** Una tarea con `team_id` solo la ven ese equipo, los equipos QA del proyecto, los gerentes, su creador, su responsable y sus observadores.
* **Borrado lógico visible para quien borra.** La tarea desaparece para los demás. Quien la borró la sigue viendo tachada, con la cinta «Eliminada», y puede restaurarla (`deleted_by_id`).
* **Comentarios.** Solo los borra su autor. No se editan directamente: el autor solicita la edición en las primeras 48 h (según la hora UTC del servidor) y el líder de su equipo la aprueba. Cada versión se guarda inmutable en `comment_versions`. El índice único `pending_comment_id` impide tener dos solicitudes pendientes para el mismo comentario. Las decisiones bloquean la fila (`SELECT … FOR UPDATE`) y comprueban la versión del comentario.
* **Reasignación.** Solo el líder del equipo responsable o un gerente pueden reasignar. El nuevo responsable debe pertenecer al equipo y tener acceso al proyecto. Cada cambio queda en `task_assignment_history` con su motivo y notifica al responsable anterior y al nuevo.
* **Transferencias.** Una tarea pasa a otro equipo con acceso al proyecto, sin duplicarse, y queda registrada en `task_team_transfers`. Si el responsable no pertenece al equipo destino, la tarea queda sin asignar. El equipo anterior pierde la facultad de reasignarla.
* **Capacidad.** Cada persona puede tener como máximo `organizations.wip_limit` tareas en progreso a la vez (4 por defecto). Las pendientes no cuentan. Al iniciar o reasignar una tarea en progreso se bloquea la fila del usuario y se cuentan sus tareas dentro de la misma transacción.

### Reconocimientos
* **Contribuciones** (`task_contributions`, una por cada fuente: único por `source_type` + `source_id` + `user_id`). Cuentan:
  * comentarios con contenido (al menos 30 caracteres y 5 palabras distintas, sin repetir uno reciente del mismo autor, o con un adjunto);
  * evidencias adjuntas;
  * tiempo registrado (15 min o más);
  * entregas a QA;
  * revisiones de QA.
* **Ciclos de resolución** (`task_resolution_cycles`). El responsable envía la tarea a QA y un integrante de un equipo QA (que no sea quien la entregó) la valida o la rechaza, siempre con evidencia. La validación otorga el logro «Resolución» a quien entregó **ese ciclo** y el logro «Validación QA» a quien validó. Reasignar o estar asignado no otorga nada. Si la tarea se reabre, se revocan los logros del ciclo.
* **Idempotencia.** Cada logro tiene una clave única (`dedupe_key`), como `resolution:{ciclo}` o `streak:{org}:{usuario}:{n}:{inicio}`. Los eventos en tiempo real se envían solo después del commit.
* **Rachas.** Cuentan días laborales con contribuciones, en la zona horaria de la organización. Fines de semana (`organizations.workdays`), festivos (`org_holidays`) y ausencias autorizadas (`user_absences`) ni suman ni rompen la racha.

### Presencia y tiempo real
* **Presencia:** cada latido del WebSocket (cada 25 s) renueva en Redis la clave `presence:{org}:{usuario}`, que caduca a los 70 s. Estar «en línea» significa tener una conexión viva, no solo una sesión iniciada.
* **Autorización:** el WebSocket reenvía los eventos de un proyecto solo a quien tiene acceso a él. La lista de proyectos accesibles se recalcula cuando cambia un proyecto y cada 60 s.

### Decisiones adicionales
11. El PMO funciona como gerente de todos los proyectos, pero no aprueba ediciones: solo recibe avisos y ve el historial completo, como pide la especificación.
12. Si el equipo del solicitante no tiene líder, o el solicitante es el propio líder, aprueban la propietaria o los administradores.
13. Las etiquetas pertenecen al proyecto. Cualquiera que pueda crear tareas puede crear una etiqueta «al vuelo» desde la tarea, y crear una con el mismo nombre (sin distinguir mayúsculas) reutiliza la existente.
14. Para mantener la jerarquía, un integrante solo puede asignarse una tarea a sí mismo al crearla.
