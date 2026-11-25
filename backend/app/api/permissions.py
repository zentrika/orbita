"""Permisos por organización, proyecto, equipo y tarea. Toda la autorización de negocio pasa por aquí.

Jerarquía:
  * Propietario (CEO), administrador y PMO → gerentes de todos los proyectos.
  * Gerente de proyecto (project_members.role = manager) → gestiona ese proyecto.
  * Líder de equipo (teams.lead_id) → edita, reasigna y transfiere las tareas de su equipo.
  * Integrante → ve el proyecto si su equipo tiene acceso; ve las tareas sin equipo o de su equipo.
  * Invitado → sólo proyectos donde se le añadió explícitamente.
"""

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import OrgCtx
from app.models import Project, ProjectMember, ProjectTeam, Task, TaskWatcher, Team, TeamMember

ACTIONS = ("view", "create", "edit", "comment", "attach", "manage", "delete")

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "manager": set(ACTIONS),
    "member": {"view", "create", "edit", "comment", "attach"},
    "guest": {"view", "comment", "attach"},
}


def not_found(what: str = "Recurso") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} no encontrado")


def forbidden(msg: str = "No tienes permiso para esta acción") -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, msg)


# ---- Equipos ---------------------------------------------------------------------------


def user_team_ids(db: Session, org_id: int, user_id: int) -> set[int]:
    member = set(db.scalars(select(TeamMember.team_id).where(TeamMember.organization_id == org_id, TeamMember.user_id == user_id)))
    led = set(db.scalars(select(Team.id).where(Team.organization_id == org_id, Team.lead_id == user_id)))
    return member | led


def led_team_ids(db: Session, org_id: int, user_id: int) -> set[int]:
    return set(db.scalars(select(Team.id).where(Team.organization_id == org_id, Team.lead_id == user_id)))


def project_team_ids(db: Session, project_id: int) -> set[int]:
    return set(db.scalars(select(ProjectTeam.team_id).where(ProjectTeam.project_id == project_id)))


def is_team_member(db: Session, team_id: int, user_id: int) -> bool:
    team = db.get(Team, team_id)
    if not team:
        return False
    if team.lead_id == user_id:
        return True
    return db.scalar(select(TeamMember.id).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)) is not None


# ---- Proyectos -------------------------------------------------------------------------


def project_role(db: Session, ctx: OrgCtx, project: Project) -> str | None:
    if project.organization_id != ctx.org_id:
        return None
    if ctx.is_manager:
        return "manager"
    pm = db.scalar(
        select(ProjectMember).where(ProjectMember.project_id == project.id, ProjectMember.user_id == ctx.user.id)
    )
    if pm:
        return "guest" if ctx.role == "guest" else pm.role
    if ctx.role == "guest":
        return None
    if project_team_ids(db, project.id) & user_team_ids(db, ctx.org_id, ctx.user.id):
        return "member"
    if project.visibility == "organization":
        return "member"
    return None


def permissions_for(role: str | None) -> list[str]:
    return sorted(ROLE_PERMISSIONS.get(role or "", set()))


def can(role: str | None, action: str) -> bool:
    return action in ROLE_PERMISSIONS.get(role or "", set())


def load_project(db: Session, ctx: OrgCtx, project_id: int, action: str = "view") -> tuple[Project, str]:
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == ctx.org_id,
            Project.deleted_at.is_(None),
        )
    )
    if not project:
        raise not_found("Proyecto")
    role = project_role(db, ctx, project)
    if role is None:
        raise not_found("Proyecto")
    if not can(role, action):
        raise forbidden()
    return project, role


def accessible_project_ids(db: Session, ctx: OrgCtx) -> list[int]:
    base = select(Project.id).where(Project.organization_id == ctx.org_id, Project.deleted_at.is_(None))
    if ctx.is_manager:
        return list(db.scalars(base))
    member_of = select(ProjectMember.project_id).where(
        ProjectMember.user_id == ctx.user.id, ProjectMember.organization_id == ctx.org_id
    )
    if ctx.role == "guest":
        return list(db.scalars(base.where(Project.id.in_(member_of))))
    teams = user_team_ids(db, ctx.org_id, ctx.user.id)
    via_team = select(ProjectTeam.project_id).where(ProjectTeam.team_id.in_(teams or {0}))
    return list(db.scalars(base.where(or_(Project.visibility == "organization", Project.id.in_(member_of), Project.id.in_(via_team)))))


def qa_project_ids(db: Session, org_id: int, user_id: int) -> set[int]:
    """Proyectos donde la persona pertenece a un equipo QA con acceso: ve todas sus tareas para validarlas."""
    qa_teams = set(db.scalars(select(Team.id).where(Team.organization_id == org_id, Team.is_qa.is_(True))))
    mine = qa_teams & user_team_ids(db, org_id, user_id)
    if not mine:
        return set()
    return set(db.scalars(select(ProjectTeam.project_id).where(ProjectTeam.team_id.in_(mine))))


def managed_project_ids(db: Session, ctx: OrgCtx) -> set[int]:
    """Proyectos donde el usuario es gerente (sin contar el rol de organización)."""
    return set(db.scalars(select(ProjectMember.project_id).where(
        ProjectMember.organization_id == ctx.org_id, ProjectMember.user_id == ctx.user.id, ProjectMember.role == "manager")))


# ---- Tareas ----------------------------------------------------------------------------


def task_visibility_clause(db: Session, ctx: OrgCtx):
    """Condición SQL: tareas que el usuario puede ver dentro de los proyectos a los que accede.

    Una tarea con equipo sólo la ven ese equipo, los gerentes, su creador, su responsable y sus observadores.
    Devuelve None cuando el usuario ve todas las tareas (gerentes de organización).
    """
    if ctx.is_manager:
        return None
    me = ctx.user.id
    return or_(
        Task.team_id.is_(None),
        Task.team_id.in_(user_team_ids(db, ctx.org_id, me) or {0}),
        Task.project_id.in_(managed_project_ids(db, ctx) | qa_project_ids(db, ctx.org_id, me) or {0}),
        Task.reporter_id == me,
        Task.assignee_id == me,
        Task.id.in_(select(TaskWatcher.task_id).where(TaskWatcher.user_id == me)),
    )


def can_view_task(db: Session, ctx: OrgCtx, task: Task, role: str) -> bool:
    if role == "manager" or task.team_id is None:
        return True
    me = ctx.user.id
    if me in (task.reporter_id, task.assignee_id, task.deleted_by_id):
        return True
    if task.team_id in user_team_ids(db, ctx.org_id, me):
        return True
    if task.project_id in qa_project_ids(db, ctx.org_id, me):
        return True
    return db.scalar(select(TaskWatcher.id).where(TaskWatcher.task_id == task.id, TaskWatcher.user_id == me)) is not None


def task_capabilities(db: Session, ctx: OrgCtx, task: Task, role: str) -> set[str]:
    """Qué puede hacer el usuario con esta tarea concreta.

    * edit:     cambiar campos (título, descripción, fechas…): gerente, creador o líder del equipo de la tarea.
    * status:   mover de estado: lo anterior + responsable.
    * assign:   cambiar responsable: gerente o líder del equipo de la tarea. Los integrantes NO pueden.
    * transfer: cambiar de equipo: gerente o líder del equipo actual.
    * delete:   borrado lógico: gerente o creador.
    * qa:       validar o rechazar en QA: gerente o integrante de un equipo QA con acceso al proyecto.
    """
    me = ctx.user.id
    caps: set[str] = set()
    if role in ("manager", "member", "guest"):
        caps.add("view")
    if can(role, "comment"):
        caps.add("comment")
    if can(role, "attach"):
        caps.add("attach")
    manager = role == "manager"
    is_lead = task.team_id is not None and task.team_id in led_team_ids(db, ctx.org_id, me)
    if role == "guest":
        return caps
    if manager or is_lead or task.reporter_id == me:
        caps |= {"edit", "status"}
    if task.assignee_id == me:
        caps.add("status")
    if manager or is_lead:
        caps |= {"assign", "transfer"}
    if manager or task.reporter_id == me:
        caps.add("delete")
    qa_teams = set(db.scalars(select(Team.id).where(Team.organization_id == ctx.org_id, Team.is_qa.is_(True))))
    if manager or (qa_teams & project_team_ids(db, task.project_id) & user_team_ids(db, ctx.org_id, me)):
        caps.add("qa")
    return caps


def load_task(db: Session, ctx: OrgCtx, task_id: int, action: str = "view", include_deleted: bool = False
              ) -> tuple[Task, Project, str]:
    task = db.scalar(select(Task).where(Task.id == task_id, Task.organization_id == ctx.org_id))
    if not task:
        raise not_found("Tarea")
    if task.deleted_at is not None and not (include_deleted and task.deleted_by_id == ctx.user.id):
        raise not_found("Tarea")
    project, role = load_project(db, ctx, task.project_id, "view")
    if not can_view_task(db, ctx, task, role):
        raise not_found("Tarea")
    if action != "view":
        caps = task_capabilities(db, ctx, task, role)
        mapped = {"edit": "edit", "comment": "comment", "attach": "attach", "delete": "delete", "status": "status",
                  "assign": "assign", "transfer": "transfer", "qa": "qa"}.get(action)
        if mapped and mapped not in caps:
            raise forbidden()
        if not mapped and not can(role, action):
            raise forbidden()
    return task, project, role
