"""Datos de demostración idempotentes (sólo desarrollo).

Usa "buscar o crear" en todas las entidades: ejecutarlo varias veces no duplica ni borra nada.
Las credenciales de demostración están documentadas en README.md.
"""

from datetime import date, timedelta

from sqlalchemy import select

from app.core.db import SessionLocal, utcnow
from app.core.security import hash_password
from app.models import (
    ProjectTeam,
    Team,
    TeamMember,
    ChecklistItem,
    Comment,
    Goal,
    Label,
    Membership,
    Milestone,
    Organization,
    Project,
    ProjectMember,
    Sprint,
    Task,
    TaskLabel,
    TaskRelation,
    TaskWatcher,
    User,
    WorkflowStatus,
)
from app.services.orgs import create_project, pick_avatar_color

DEMO_PASSWORD = "Orbita2026!"

USERS = [
    ("marina@orbita.dev", "Marina Costa", "owner", "Product lead"),
    ("pedro@orbita.dev", "Pedro Lima", "admin", "Engineering manager"),
    ("ana@orbita.dev", "Ana Ribeiro", "member", "Product designer"),
    ("lucas@orbita.dev", "Lucas Méndez", "member", "Frontend engineer"),
    ("sofia@orbita.dev", "Sofía Torres", "member", "Backend engineer"),
    ("cliente@orbita.dev", "Carla Cliente", "guest", "Cliente"),
    ("pmo@orbita.dev", "Paula Rincón", "pmo", "PMO"),
    ("juan@orbita.dev", "Juan Pérez", "member", "Desarrollador"),
    ("jesus@orbita.dev", "Jesús Mora", "member", "Desarrollador"),
    ("valentina@orbita.dev", "Valentina Ruiz", "member", "Líder QA"),
    ("tomas@orbita.dev", "Tomás Gil", "member", "QA"),
    ("camilo@orbita.dev", "Camilo Díaz", "member", "Líder Brikers"),
    ("diana@orbita.dev", "Diana Vélez", "member", "Líder 24/7"),
    ("andres@orbita.dev", "Andrés Ortiz", "member", "Soporte"),
]

TEAMS = [
    # nombre, líder, integrantes, color, QA
    ("Team 404", "pedro", ["juan", "jesus", "lucas"], "#4F46E5", False),
    ("Team Meraki", "ana", ["sofia"], "#0E9384", False),
    ("Team Brikers", "camilo", [], "#F79009", False),
    ("Team 24/7", "diana", ["andres"], "#2563EB", False),
    ("Team Bug Hunter", "valentina", ["tomas"], "#DD2590", True),
]


def _user(db, email, name):
    u = db.scalar(select(User).where(User.email == email))
    if not u:
        u = User(email=email, full_name=name, password_hash=hash_password(DEMO_PASSWORD), email_verified_at=utcnow(),
                 avatar_color=pick_avatar_color(email))
        db.add(u)
        db.flush()
    return u


def _org(db, slug, name, owner):
    o = db.scalar(select(Organization).where(Organization.slug == slug))
    if not o:
        o = Organization(name=name, slug=slug, created_by_id=owner.id)
        db.add(o)
        db.flush()
    return o


def _member(db, org, user, role, title=""):
    m = db.scalar(select(Membership).where(Membership.organization_id == org.id, Membership.user_id == user.id))
    if not m:
        db.add(Membership(organization_id=org.id, user_id=user.id, role=role, title=title))


def _project(db, org, creator, key, **fields):
    p = db.scalar(select(Project).where(Project.organization_id == org.id, Project.key == key))
    if not p:
        p = create_project(db, org.id, creator, key=key, **fields)
    return p


def _get_or(db, model, defaults=None, **where):
    obj = db.scalar(select(model).filter_by(**where))
    if not obj:
        obj = model(**where, **(defaults or {}))
        db.add(obj)
        db.flush()
    return obj


def seed_demo() -> None:
    today = date.today()
    d = lambda n: today + timedelta(days=n)  # noqa: E731
    with SessionLocal() as db:
        users = {e.split("@")[0]: _user(db, e, n) for e, n, _, _ in USERS}
        org = _org(db, "acme-demo", "Acme Corp", users["marina"])
        for e, _, role, title in USERS:
            _member(db, org, users[e.split("@")[0]], role, title)
        db.flush()

        # --- Proyecto 1: Website redesign -------------------------------------------------
        web = _project(db, org, users["marina"], "WEB", name="Website redesign",
                       description="Rediseñar el sitio de marketing para mejorar claridad, conversión y rendimiento.",
                       color="#4F46E5", start_date=d(-21), end_date=d(30))
        web.scope = ("<p><strong>Incluye:</strong> home, precios, páginas de producto y blog.</p>"
                     "<p><strong>Fuera de alcance:</strong> app de clientes y documentación.</p>")
        for u in ("pedro", "ana", "lucas", "sofia"):
            _get_or(db, ProjectMember, {"role": "member"}, organization_id=org.id, project_id=web.id, user_id=users[u].id)
        _get_or(db, ProjectMember, {"role": "guest"}, organization_id=org.id, project_id=web.id, user_id=users["cliente"].id)

        labels = {}
        for name, color in [("Marketing", "#4F46E5"), ("Web", "#475467"), ("Design", "#8B5CF6"), ("Content", "#0E9384"),
                            ("Analytics", "#2563EB"), ("Performance", "#F79009"), ("Research", "#12B76A"), ("Bug", "#F04438")]:
            labels[name] = _get_or(db, Label, {"color": color}, organization_id=org.id, project_id=web.id, name=name)

        statuses = {s.category: s for s in db.scalars(select(WorkflowStatus).where(WorkflowStatus.project_id == web.id))}
        sprint = _get_or(db, Sprint, {"goal": "Lanzar la nueva home y la página de precios", "start_date": d(-7),
                                      "end_date": d(7), "state": "active"},
                         organization_id=org.id, project_id=web.id, name="Sprint 3")
        ms_beta = _get_or(db, Milestone, {"due_date": d(10), "description": "Versión navegable para revisión interna"},
                          organization_id=org.id, project_id=web.id, name="Beta interna")
        ms_launch = _get_or(db, Milestone, {"due_date": d(30), "description": "Publicación del nuevo sitio"},
                            organization_id=org.id, project_id=web.id, name="Lanzamiento público")
        _get_or(db, Goal, {"description": "Subir la conversión de visitas a registro", "target_date": d(60), "progress": 35,
                           "owner_id": users["marina"].id},
                organization_id=org.id, project_id=web.id, title="Conversión de registro +20 %")
        _get_or(db, Goal, {"description": "LCP por debajo de 2,5 s en móvil", "target_date": d(45), "progress": 60,
                           "owner_id": users["sofia"].id},
                organization_id=org.id, project_id=web.id, title="Core Web Vitals en verde")

        T = [
            # título, estado, tipo, prioridad, responsable, inicio, fin, etiquetas, estimación (h), hito
            ("Auditar el sitio actual y definir alcance", "done", "task", "medium", "ana", -21, -16, ["Research"], 12, None),
            ("Crear wireframes de páginas clave", "done", "story", "high", "ana", -16, -10, ["Design"], 16, ms_beta),
            ("Alinear nueva arquitectura de información", "done", "task", "medium", "marina", -12, -9, ["Research"], 6, None),
            ("Implementar nueva maquetación de la home", "in_progress", "story", "high", "lucas", -6, 3, ["Web", "Design"], 24, ms_beta),
            ("Integrar eventos de analítica actualizados", "in_progress", "task", "medium", "sofia", -3, 4, ["Analytics"], 8, ms_beta),
            ("Cargar contenido CMS para secciones clave", "in_progress", "task", "medium", "pedro", -2, 5, ["Content", "Web"], 10, None),
            ("Revisar copy de páginas de producto", "review", "task", "high", "marina", -5, 1, ["Content", "Marketing"], 6, ms_beta),
            ("Diseñar nueva librería de componentes", "review", "story", "medium", "ana", -8, 2, ["Design", "Web"], 20, ms_beta),
            ("Construir nueva página de precios", "todo", "story", "high", "lucas", 2, 9, ["Marketing", "Web"], 16, ms_beta),
            ("Configurar test A/B para la home", "todo", "task", "medium", "sofia", 6, 12, ["Analytics"], 6, ms_launch),
            ("Optimizar imágenes y recursos", "todo", "task", "medium", "lucas", 8, 14, ["Performance", "Web"], 8, ms_launch),
            ("Actualizar páginas legales (Términos, Privacidad)", "todo", "task", "low", "pedro", 12, 20, ["Content"], 4, ms_launch),
            ("El menú móvil no cierra al navegar", "blocked", "bug", "urgent", "lucas", -1, 1, ["Bug", "Web"], 2, None),
            ("Formulario de contacto devuelve error 500", "todo", "incident", "urgent", "sofia", 0, 0, ["Bug"], 3, None),
            ("Solicitud: añadir logo del cliente en la home", "todo", "ticket", "low", None, 3, 6, ["Marketing"], 1, None),
        ]
        created = {}
        for i, (title, cat, ttype, prio, who, s, e, lbls, est, ms) in enumerate(T):
            task = db.scalar(select(Task).where(Task.project_id == web.id, Task.title == title))
            if not task:
                web.task_seq += 1
                task = Task(organization_id=org.id, project_id=web.id, number=web.task_seq, title=title, type=ttype,
                            status_id=statuses[cat].id, priority=prio, assignee_id=users[who].id if who else None,
                            reporter_id=users["marina"].id, start_date=d(s), due_date=d(e), estimate_minutes=est * 60,
                            position=(i + 1) * 1024, sprint_id=sprint.id if -7 <= s <= 7 else None,
                            milestone_id=ms.id if ms else None, completed_at=utcnow() if cat == "done" else None,
                            description=f"<p>{title}. Criterios de aceptación definidos con el equipo.</p>")
                db.add(task)
                db.flush()
                for ln in lbls:
                    db.add(TaskLabel(organization_id=org.id, task_id=task.id, label_id=labels[ln].id))
                for uid in {users["marina"].id, task.assignee_id}:
                    if uid:
                        db.add(TaskWatcher(organization_id=org.id, task_id=task.id, user_id=uid))
            created[title] = task
        db.flush()

        home = created["Implementar nueva maquetación de la home"]
        for i, (txt, done) in enumerate([("Hero y navegación", True), ("Sección de beneficios", True),
                                         ("Testimonios", False), ("Pie de página", False)]):
            _get_or(db, ChecklistItem, {"done": done, "position": i}, organization_id=org.id, task_id=home.id, text=txt)
        for title in ("Header responsive", "Animaciones de entrada"):
            if not db.scalar(select(Task.id).where(Task.project_id == web.id, Task.title == title)):
                web.task_seq += 1
                db.add(Task(organization_id=org.id, project_id=web.id, number=web.task_seq, title=title, type="task",
                            status_id=statuses["in_progress" if title.startswith("Header") else "todo"].id, priority="medium",
                            assignee_id=users["lucas"].id, reporter_id=users["lucas"].id, parent_id=home.id,
                            start_date=d(-2), due_date=d(2), position=99_000))
        rels = [
            ("Crear wireframes de páginas clave", "Implementar nueva maquetación de la home", "blocks"),
            ("Diseñar nueva librería de componentes", "Construir nueva página de precios", "blocks"),
            ("Implementar nueva maquetación de la home", "Configurar test A/B para la home", "blocks"),
            ("Optimizar imágenes y recursos", "Implementar nueva maquetación de la home", "depends_on"),
            ("El menú móvil no cierra al navegar", "Implementar nueva maquetación de la home", "relates_to"),
        ]
        for a, b, kind in rels:
            _get_or(db, TaskRelation, {"created_by_id": users["marina"].id}, organization_id=org.id,
                    source_task_id=created[a].id, target_task_id=created[b].id, type=kind)
        if not db.scalar(select(Comment.id).where(Comment.task_id == home.id)):
            db.add(Comment(organization_id=org.id, task_id=home.id, author_id=users["pedro"].id,
                           body="<p>Arranqué con la estructura del hero. @ana ¿revisamos espaciados mañana?</p>"))
            db.add(Comment(organization_id=org.id, task_id=home.id, author_id=users["ana"].id,
                           body="<p>¡Perfecto! Dejé los tokens actualizados en la librería de componentes.</p>"))

        # --- Proyecto 2: Órbita v2.0 -------------------------------------------------------
        v2 = _project(db, org, users["pedro"], "ORB", name="Órbita v2.0",
                      description="Siguiente generación de la plataforma de gestión de trabajo.", color="#7A5AF8",
                      start_date=d(-14), end_date=d(40), visibility="organization")
        st2 = {s.category: s for s in db.scalars(select(WorkflowStatus).where(WorkflowStatus.project_id == v2.id))}
        rel_ms = _get_or(db, Milestone, {"due_date": d(35), "description": "Publicación de la versión 2.0"},
                         organization_id=org.id, project_id=v2.id, name="Release v2.0")
        T2 = [
            ("Definir alcance", "done", "ana", -14, -10),
            ("Validar con stakeholders", "done", "marina", -11, -4),
            ("Diseñar flujos principales", "in_progress", "ana", -3, 10),
            ("Finalizar sistema de diseño", "todo", "ana", 4, 14),
            ("Implementar funciones principales", "todo", "sofia", 10, 22),
            ("QA y corrección de incidencias", "todo", "lucas", 18, 30),
            ("Rendimiento y seguridad", "todo", "pedro", 18, 30),
        ]
        c2 = {}
        for i, (title, cat, who, s, e) in enumerate(T2):
            t = db.scalar(select(Task).where(Task.project_id == v2.id, Task.title == title))
            if not t:
                v2.task_seq += 1
                t = Task(organization_id=org.id, project_id=v2.id, number=v2.task_seq, title=title, type="task",
                         status_id=st2[cat].id, priority="medium", assignee_id=users[who].id, reporter_id=users["pedro"].id,
                         start_date=d(s), due_date=d(e), position=(i + 1) * 1024, milestone_id=rel_ms.id,
                         completed_at=utcnow() if cat == "done" else None)
                db.add(t)
                db.flush()
            c2[title] = t
        chain = list(c2.values())
        for a, b in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (4, 6)]:
            _get_or(db, TaskRelation, {}, organization_id=org.id, source_task_id=chain[a].id, target_task_id=chain[b].id,
                    type="blocks")

        # --- Proyecto privado (no visible para miembros no añadidos) ------------------------
        _project(db, org, users["pedro"], "SEC", name="Auditoría de seguridad", visibility="private",
                 description="Proyecto privado del equipo de plataforma.", color="#F04438")

        # --- Equipos y jerarquía ---------------------------------------------------------
        teams = {}
        for name, lead, members, color, is_qa in TEAMS:
            team = _get_or(db, Team, {"color": color, "is_qa": is_qa, "lead_id": users[lead].id}, organization_id=org.id, name=name)
            for u in {lead, *members}:
                _get_or(db, TeamMember, {}, organization_id=org.id, team_id=team.id, user_id=users[u].id)
            teams[name] = team
        for pr in (web, v2):
            for tn in ("Team 404", "Team Meraki", "Team Bug Hunter"):
                _get_or(db, ProjectTeam, {}, organization_id=org.id, project_id=pr.id, team_id=teams[tn].id)

        # --- Proyecto Vatia: visible sólo para los equipos con acceso -----------------------
        vat = _project(db, org, users["pmo"], "VAT", name="Vatia", visibility="private", color="#DD2590",
                       description="Pasarela de pagos para comercios. Trabajo repartido por equipos.", start_date=d(-10), end_date=d(45))
        for tn in ("Team 404", "Team Meraki", "Team Bug Hunter"):
            _get_or(db, ProjectTeam, {}, organization_id=org.id, project_id=vat.id, team_id=teams[tn].id)
        stv = {s.category: s for s in db.scalars(select(WorkflowStatus).where(WorkflowStatus.project_id == vat.id))}
        for name, color in [("Backend", "#2563EB"), ("Frontend", "#0E9384"), ("Pagos", "#DD2590"), ("Mobile", "#F79009")]:
            _get_or(db, Label, {"color": color}, organization_id=org.id, project_id=vat.id, name=name)
        VT = [
            ("Integrar pasarela de pagos", "in_progress", "Team 404", "juan", "high", -4, 4),
            ("Validar montos negativos en reembolsos", "review", "Team 404", "jesus", "urgent", -3, 1),
            ("Panel de conciliación diaria", "todo", "Team 404", None, "medium", 2, 10),
            ("Checkout responsive", "in_progress", "Team Meraki", "sofia", "high", -2, 5),
            ("Pantalla de recibos", "todo", "Team Meraki", "ana", "medium", 3, 9),
            ("Plan de pruebas de regresión", "in_progress", "Team Bug Hunter", "tomas", "medium", -1, 6),
            ("Webhook de confirmación duplicado", "blocked", "Team 404", "juan", "urgent", -2, 0),
            ("Documentar API pública", "todo", None, None, "low", 5, 15),
        ]
        for i, (title, cat, tn, who, prio, sd, ed) in enumerate(VT):
            if not db.scalar(select(Task.id).where(Task.project_id == vat.id, Task.title == title)):
                vat.task_seq += 1
                db.add(Task(organization_id=org.id, project_id=vat.id, number=vat.task_seq, title=title, type="task",
                            status_id=stv[cat].id, priority=prio, team_id=teams[tn].id if tn else None,
                            assignee_id=users[who].id if who else None, reporter_id=users["pmo"].id,
                            start_date=d(sd), due_date=d(ed), position=(i + 1) * 1024))
        db.flush()

        # --- Segunda organización para demostrar el aislamiento ----------------------------
        other = _user(db, "otra@globex.dev", "Olga Globex")
        globex = _org(db, "globex-demo", "Globex", other)
        _member(db, globex, other, "owner")
        _member(db, globex, users["marina"], "member", "Consultora")
        _project(db, globex, other, "OPS", name="Operaciones Globex", description="Proyecto de otra empresa.",
                 color="#0E9384")
        db.commit()
    print("Datos de demostración listos (idempotente). Usuario: marina@orbita.dev / " + DEMO_PASSWORD)


if __name__ == "__main__":
    seed_demo()
