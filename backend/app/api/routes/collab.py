from urllib.parse import quote

import os
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.api.deps import OrgCtx, get_org_ctx
from app.api.permissions import (
    forbidden,
    led_team_ids,
    load_task,
    not_found,
    project_role,
    project_team_ids,
    user_team_ids,
)
from app.api.routes.tasks import _add_watcher, _watcher_ids
from app.core.config import settings
from app.core.db import get_db, utcnow
from app.models import (
    Attachment,
    Comment,
    CommentEditRequest,
    CommentVersion,
    Membership,
    Project,
    Task,
    Team,
    User,
)
from app.schemas.common import Message, UserBrief
from app.schemas.task import (
    AttachmentOut,
    CommentAttachment,
    CommentIn,
    CommentOut,
    CommentVersionOut,
    DecisionIn,
    EditRequestIn,
    EditRequestOut,
    TeamBrief,
)
from app.services.achievements import comment_is_substantive, record_contribution
from app.services.audit import log_activity
from app.services.notifications import notify
from app.services.realtime import emit_org
from app.services.sanitize import clean_html, extract_mentions
from app.services.storage import get_storage

router = APIRouter(prefix="/orgs/{org_id}/tasks/{task_id}", tags=["collaboration"])
requests_router = APIRouter(prefix="/orgs/{org_id}/comment-edit-requests", tags=["collaboration"])

EDIT_WINDOW = timedelta(hours=48)


def _comments_out(db: Session, ctx: OrgCtx, comments: list[Comment]) -> list[CommentOut]:
    ids = [c.id for c in comments]
    authors = {u.id: u for u in db.scalars(select(User).where(User.id.in_({c.author_id for c in comments if c.author_id} or {0})))}
    atts: dict[int, list[CommentAttachment]] = {}
    for a in db.scalars(select(Attachment).where(Attachment.comment_id.in_(ids or [0]), Attachment.deleted_at.is_(None))):
        atts.setdefault(a.comment_id, []).append(CommentAttachment(id=a.id, filename=a.filename, content_type=a.content_type, size=a.size))
    pending = set(db.scalars(select(CommentEditRequest.comment_id).where(
        CommentEditRequest.comment_id.in_(ids or [0]), CommentEditRequest.status == "pending")))
    now = utcnow()
    return [
        CommentOut(
            id=c.id, body=c.body, parent_id=c.parent_id, version=c.version, created_at=c.created_at, edited_at=c.edited_at,
            author=UserBrief.model_validate(authors[c.author_id]) if c.author_id in authors else None,
            can_delete=c.author_id == ctx.user.id,
            can_request_edit=c.author_id == ctx.user.id and now - c.created_at <= EDIT_WINDOW and c.id not in pending,
            edit_pending=c.id in pending,
            attachments=atts.get(c.id, []),
        )
        for c in comments
    ]


def _resolve_mentions(db: Session, ctx: OrgCtx, project: Project, body: str) -> set[int]:
    """Convierte @correo o @nombre.apellido en usuarios con acceso al proyecto."""
    handles = extract_mentions(body)
    if not handles:
        return set()
    users = db.scalars(select(User).join(Membership, Membership.user_id == User.id)
                       .where(Membership.organization_id == ctx.org_id)).all()
    found = set()
    for u in users:
        local = u.email.split("@")[0].lower()
        compact = u.full_name.lower().replace(" ", ".")
        if {u.email.lower(), local, compact, u.full_name.lower().split(" ")[0]} & handles:
            m = next(mm for mm in u.memberships if mm.organization_id == ctx.org_id)
            if project_role(db, OrgCtx(org_id=ctx.org_id, user=u, role=m.role), project):
                found.add(u.id)
    return found


@router.get("/comments", response_model=list[CommentOut])
def list_comments(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, _, _ = load_task(db, ctx, task_id, include_deleted=True)
    rows = db.scalars(select(Comment).where(Comment.task_id == task.id, Comment.organization_id == ctx.org_id,
                                            Comment.deleted_at.is_(None)).order_by(Comment.created_at, Comment.id)).all()
    return _comments_out(db, ctx, list(rows))


@router.post("/comments", response_model=CommentOut, status_code=201)
def add_comment(task_id: int, data: CommentIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "comment")
    body = clean_html(data.body)
    if not body.strip():
        raise HTTPException(422, "El comentario está vacío")
    parent_id = None
    parent = None
    if data.parent_id:
        parent = db.scalar(select(Comment).where(Comment.id == data.parent_id, Comment.task_id == task.id,
                                                 Comment.organization_id == ctx.org_id, Comment.deleted_at.is_(None)))
        if not parent:
            raise HTTPException(400, "El comentario al que respondes no existe")
        parent_id = parent.parent_id or parent.id  # un solo nivel de hilo
    c = Comment(organization_id=ctx.org_id, task_id=task.id, author_id=ctx.user.id, body=body, parent_id=parent_id)
    db.add(c)
    db.flush()
    db.add(CommentVersion(organization_id=ctx.org_id, comment_id=c.id, version=1, body=body))
    key = f"{project.key}-{task.number}"
    mentioned = _resolve_mentions(db, ctx, project, data.body)
    notify(db, org_id=ctx.org_id, user_ids=mentioned, actor_id=ctx.user.id, type_="mentioned",
           title=f"{ctx.user.full_name} te mencionó en {key}", body=task.title, task_id=task.id, project_id=project.id)
    if parent and parent.author_id not in mentioned:
        notify(db, org_id=ctx.org_id, user_ids=[parent.author_id], actor_id=ctx.user.id, type_="replied",
               title=f"{ctx.user.full_name} respondió tu comentario en {key}", body=task.title, task_id=task.id, project_id=project.id)
    others = set(_watcher_ids(db, task.id)) - mentioned - ({parent.author_id} if parent else set())
    notify(db, org_id=ctx.org_id, user_ids=others, actor_id=ctx.user.id, type_="commented",
           title=f"{ctx.user.full_name} comentó en {key}", body=task.title, task_id=task.id, project_id=project.id)
    _add_watcher(db, ctx.org_id, task.id, ctx.user.id)
    if comment_is_substantive(db, c):
        record_contribution(db, task=task, user_id=ctx.user.id, kind="comment", source_type="comment", source_id=c.id)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="commented", entity_type="comment", entity_id=c.id,
                 project_id=project.id, task_id=task.id)
    task.updated_at = utcnow()
    emit_org(db, ctx.org_id, "comment.created", project_id=project.id, task_id=task.id)
    db.commit()
    return _comments_out(db, ctx, [c])[0]


def _get_comment(db: Session, ctx: OrgCtx, task: Task, comment_id: int) -> Comment:
    c = db.scalar(select(Comment).where(Comment.id == comment_id, Comment.task_id == task.id,
                                        Comment.organization_id == ctx.org_id, Comment.deleted_at.is_(None)))
    if not c:
        raise not_found("Comentario")
    return c


@router.delete("/comments/{comment_id}", response_model=Message)
def delete_comment(task_id: int, comment_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, include_deleted=True)
    c = _get_comment(db, ctx, task, comment_id)
    if c.author_id != ctx.user.id:
        raise forbidden("Sólo quien escribió el comentario puede borrarlo")
    c.deleted_at = utcnow()  # borrado lógico: el historial de versiones se conserva
    db.execute(update(CommentEditRequest).where(CommentEditRequest.comment_id == c.id, CommentEditRequest.status == "pending")
               .values(status="rejected", pending_comment_id=None, decision_note="Comentario eliminado por su autor",
                       decided_at=utcnow()))
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="comment_deleted", entity_type="comment",
                 entity_id=c.id, project_id=project.id, task_id=task.id)
    emit_org(db, ctx.org_id, "comment.deleted", project_id=project.id, task_id=task.id)
    db.commit()
    return Message(detail="Comentario eliminado")


@router.get("/comments/{comment_id}/versions", response_model=list[CommentVersionOut])
def comment_versions(task_id: int, comment_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, _, _ = load_task(db, ctx, task_id, include_deleted=True)
    c = _get_comment(db, ctx, task, comment_id)
    return [CommentVersionOut(version=v.version, body=v.body, created_at=v.created_at, edit_request_id=v.edit_request_id)
            for v in db.scalars(select(CommentVersion).where(CommentVersion.comment_id == c.id).order_by(CommentVersion.version))]


# ---- Solicitudes de edición ------------------------------------------------------------


def _requester_team(db: Session, ctx: OrgCtx, task: Task) -> Team | None:
    """Equipo desde el que se solicita: el de la tarea si el autor pertenece a él; si no, su equipo en el proyecto."""
    mine = user_team_ids(db, ctx.org_id, ctx.user.id)
    if task.team_id and task.team_id in mine:
        return db.get(Team, task.team_id)
    candidates = sorted(mine & project_team_ids(db, task.project_id)) or sorted(mine)
    return db.get(Team, candidates[0]) if candidates else None


def _org_pmos(db: Session, org_id: int) -> list[int]:
    return list(db.scalars(select(Membership.user_id).where(Membership.organization_id == org_id, Membership.role == "pmo")))


@router.post("/comments/{comment_id}/edit-requests", response_model=EditRequestOut, status_code=201)
def request_edit(task_id: int, comment_id: int, data: EditRequestIn, ctx: OrgCtx = Depends(get_org_ctx),
                 db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "comment")
    c = _get_comment(db, ctx, task, comment_id)
    if c.author_id != ctx.user.id:
        raise forbidden("Sólo el autor puede solicitar la edición de su comentario")
    # Hora del servidor en UTC: nunca se confía en fechas enviadas por el cliente.
    if utcnow() - c.created_at > EDIT_WINDOW:
        raise HTTPException(400, "Sólo puedes solicitar cambios durante las primeras 48 horas")
    proposed = clean_html(data.proposed_body)
    if not proposed.strip() or proposed == c.body:
        raise HTTPException(422, "La propuesta debe cambiar el comentario")
    if db.scalar(select(CommentEditRequest.id).where(CommentEditRequest.pending_comment_id == c.id)):
        raise HTTPException(409, "Ya existe una solicitud pendiente para este comentario")
    team = _requester_team(db, ctx, task)
    approver = team.lead_id if team and team.lead_id and team.lead_id != ctx.user.id else None
    req = CommentEditRequest(
        organization_id=ctx.org_id, project_id=project.id, team_id=team.id if team else None, task_id=task.id,
        comment_id=c.id, pending_comment_id=c.id, comment_version=c.version, requester_id=ctx.user.id, approver_id=approver,
        original_body=c.body, proposed_body=proposed, reason=data.reason,
    )
    db.add(req)
    try:
        db.flush()
    except Exception as exc:  # noqa: BLE001 — índice único: ya hay una solicitud pendiente
        db.rollback()
        raise HTTPException(409, "Ya existe una solicitud pendiente para este comentario") from exc
    key = f"{project.key}-{task.number}"
    # Sin líder (o si el autor es el líder): aprueban propietario/administradores. El PMO sólo recibe aviso.
    approvers = [approver] if approver else list(db.scalars(select(Membership.user_id).where(
        Membership.organization_id == ctx.org_id, Membership.role.in_(["owner", "admin"]))))
    notify(db, org_id=ctx.org_id, user_ids=approvers, actor_id=ctx.user.id, type_="edit_request",
           title=f"{ctx.user.full_name} pide editar un comentario en {key}", body=data.reason, task_id=task.id, project_id=project.id)
    notify(db, org_id=ctx.org_id, user_ids=set(_org_pmos(db, ctx.org_id)) - set(approvers), actor_id=ctx.user.id,
           type_="edit_request_info", title=f"Solicitud de edición en {key} (para seguimiento)", body=data.reason,
           task_id=task.id, project_id=project.id)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="edit_requested", entity_type="comment", entity_id=c.id,
                 project_id=project.id, task_id=task.id, changes={"request_id": [None, req.id]})
    emit_org(db, ctx.org_id, "comment.updated", project_id=project.id, task_id=task.id)
    db.commit()
    return _request_out(db, ctx, req)


def _can_decide(db: Session, ctx: OrgCtx, req: CommentEditRequest) -> bool:
    if req.status != "pending" or req.requester_id == ctx.user.id:
        return False
    if req.approver_id:
        # Sólo el líder del equipo del solicitante: otro líder no puede aprobar solicitudes ajenas.
        return req.approver_id == ctx.user.id and (req.team_id in led_team_ids(db, ctx.org_id, ctx.user.id))
    return ctx.is_admin


def _request_out(db: Session, ctx: OrgCtx, r: CommentEditRequest) -> EditRequestOut:
    def ub(uid):
        u = db.get(User, uid) if uid else None
        return UserBrief.model_validate(u) if u else None

    project = db.get(Project, r.project_id)
    task = db.get(Task, r.task_id)
    team = db.get(Team, r.team_id) if r.team_id else None
    return EditRequestOut(
        id=r.id, organization_id=r.organization_id,
        project={"id": project.id, "key": project.key, "name": project.name},
        team=TeamBrief.model_validate(team) if team else None,
        task={"id": task.id, "key": f"{project.key}-{task.number}", "title": task.title, "project_id": project.id},
        comment_id=r.comment_id, original_body=r.original_body, proposed_body=r.proposed_body, reason=r.reason,
        requester=ub(r.requester_id), approver=ub(r.approver_id), status=r.status, created_at=r.created_at,
        decided_by=ub(r.decided_by_id), decided_at=r.decided_at, decision_note=r.decision_note,
        can_decide=_can_decide(db, ctx, r),
    )


@requests_router.get("", response_model=list[EditRequestOut])
def list_edit_requests(scope: str = Query("inbox", pattern="^(inbox|mine|all)$"), status: str | None = None,
                       ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    """inbox: las que debo resolver · mine: las que pedí · all: seguimiento (PMO, propietario, administrador)."""
    q = select(CommentEditRequest).where(CommentEditRequest.organization_id == ctx.org_id)
    if scope == "mine":
        q = q.where(CommentEditRequest.requester_id == ctx.user.id)
    elif scope == "all":
        if not ctx.is_manager:
            raise forbidden("El historial completo es para PMO, propietario o administradores")
    else:
        conds = [CommentEditRequest.approver_id == ctx.user.id]
        if ctx.is_admin:
            conds.append(CommentEditRequest.approver_id.is_(None))
        q = q.where(or_(*conds))
    if status:
        q = q.where(CommentEditRequest.status == status)
    rows = db.scalars(q.order_by(CommentEditRequest.status != "pending", CommentEditRequest.created_at.desc()).limit(200))
    return [_request_out(db, ctx, r) for r in rows]


@requests_router.get("/count", response_model=dict)
def pending_count(ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    conds = [CommentEditRequest.approver_id == ctx.user.id]
    if ctx.is_admin:
        conds.append(CommentEditRequest.approver_id.is_(None))
    n = db.scalar(select(func.count()).select_from(CommentEditRequest).where(
        CommentEditRequest.organization_id == ctx.org_id, CommentEditRequest.status == "pending", or_(*conds)))
    return {"pending": n or 0}


@requests_router.post("/{request_id}/decision", response_model=EditRequestOut)
def decide(request_id: int, data: DecisionIn, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    # Bloqueo de la solicitud: dos aprobaciones simultáneas no pueden aplicar el cambio dos veces.
    req = db.scalar(select(CommentEditRequest).where(CommentEditRequest.id == request_id,
                                                     CommentEditRequest.organization_id == ctx.org_id).with_for_update())
    if not req:
        raise not_found("Solicitud")
    if req.status != "pending":
        raise HTTPException(409, "La solicitud ya fue resuelta")
    if not _can_decide(db, ctx, req):
        raise forbidden("Sólo el líder responsable puede resolver esta solicitud")
    comment = db.scalar(select(Comment).where(Comment.id == req.comment_id).with_for_update())
    if not comment or comment.deleted_at:
        raise HTTPException(409, "El comentario ya no existe")
    if comment.version != req.comment_version:
        raise HTTPException(409, "El comentario cambió desde la solicitud")
    req.status = "approved" if data.approve else "rejected"
    req.pending_comment_id = None
    req.decided_by_id = ctx.user.id
    req.decided_at = utcnow()
    req.decision_note = data.note
    if data.approve:
        comment.version += 1
        comment.body = req.proposed_body
        comment.edited_at = utcnow()
        db.add(CommentVersion(organization_id=ctx.org_id, comment_id=comment.id, version=comment.version,
                              body=req.proposed_body, edit_request_id=req.id))
    task = db.get(Task, req.task_id)
    project = db.get(Project, req.project_id)
    key = f"{project.key}-{task.number}"
    verdict = "aprobó" if data.approve else "rechazó"
    notify(db, org_id=ctx.org_id, user_ids=[req.requester_id], actor_id=ctx.user.id, type_="edit_decision",
           title=f"{ctx.user.full_name} {verdict} tu edición en {key}", body=data.note, task_id=task.id, project_id=project.id)
    notify(db, org_id=ctx.org_id, user_ids=_org_pmos(db, ctx.org_id), actor_id=ctx.user.id, type_="edit_decision_info",
           title=f"Edición {'aprobada' if data.approve else 'rechazada'} en {key}", body=data.note, task_id=task.id,
           project_id=project.id)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="edit_approved" if data.approve else "edit_rejected",
                 entity_type="comment", entity_id=comment.id, project_id=project.id, task_id=task.id,
                 changes={"request_id": req.id, "version": comment.version})
    emit_org(db, ctx.org_id, "comment.updated", project_id=project.id, task_id=task.id)
    db.commit()
    return _request_out(db, ctx, req)


# ---- Adjuntos -------------------------------------------------------------------------


def _att_out(db: Session, a: Attachment) -> AttachmentOut:
    u = db.get(User, a.uploader_id) if a.uploader_id else None
    return AttachmentOut(id=a.id, filename=a.filename, content_type=a.content_type, size=a.size, created_at=a.created_at,
                         comment_id=a.comment_id, uploader=UserBrief.model_validate(u) if u else None)


@router.get("/attachments", response_model=list[AttachmentOut])
def list_attachments(task_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, _, _ = load_task(db, ctx, task_id, include_deleted=True)
    rows = db.scalars(select(Attachment).where(Attachment.task_id == task.id, Attachment.organization_id == ctx.org_id,
                                               Attachment.deleted_at.is_(None)).order_by(Attachment.created_at.desc()))
    return [_att_out(db, a) for a in rows]


_BLOCKED_EXT = {".exe", ".bat", ".cmd", ".sh", ".msi", ".dll", ".js", ".html", ".htm", ".php", ".jar", ".com", ".scr"}


@router.post("/attachments", response_model=AttachmentOut, status_code=201)
def upload_attachment(task_id: int, file: UploadFile = File(...), comment_id: int | None = Form(default=None),
                      ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, _ = load_task(db, ctx, task_id, "attach")
    comment = None
    if comment_id is not None:
        comment = _get_comment(db, ctx, task, comment_id)
        if comment.author_id != ctx.user.id:
            raise forbidden("Sólo puedes adjuntar archivos a tus propios comentarios")
    filename = os.path.basename(file.filename or "archivo")[:200] or "archivo"
    ext = os.path.splitext(filename)[1].lower()
    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if ext in _BLOCKED_EXT or content_type not in settings.allowed_upload_types:
        raise HTTPException(415, "Tipo de archivo no permitido")
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size == 0:
        raise HTTPException(422, "El archivo está vacío")
    if size > max_bytes:
        raise HTTPException(413, f"El archivo supera {settings.MAX_UPLOAD_MB} MB")
    count = db.scalar(select(func.count()).select_from(Attachment).where(Attachment.task_id == task.id, Attachment.deleted_at.is_(None)))
    if count >= 50:
        raise HTTPException(400, "Máximo 50 adjuntos por tarea")
    key = f"org-{ctx.org_id}/task-{task.id}/{uuid.uuid4().hex}{ext}"
    get_storage().put(key, file.file, content_type)
    a = Attachment(organization_id=ctx.org_id, task_id=task.id, uploader_id=ctx.user.id, filename=filename,
                   content_type=content_type, size=size, storage_key=key, comment_id=comment.id if comment else None)
    db.add(a)
    db.flush()
    # Una evidencia adjunta cuenta como contribución verificable (también valida el comentario al que acompaña).
    record_contribution(db, task=task, user_id=ctx.user.id, kind="evidence", source_type="attachment", source_id=a.id)
    if comment:
        record_contribution(db, task=task, user_id=ctx.user.id, kind="comment", source_type="comment", source_id=comment.id)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="attached", entity_type="attachment", entity_id=a.id,
                 project_id=project.id, task_id=task.id, changes={"filename": [None, filename]})
    task.updated_at = utcnow()
    emit_org(db, ctx.org_id, "comment.updated" if comment else "task.updated", project_id=project.id, task_id=task.id)
    db.commit()
    return _att_out(db, a)


def _get_att(db: Session, ctx: OrgCtx, task: Task, att_id: int) -> Attachment:
    a = db.scalar(select(Attachment).where(Attachment.id == att_id, Attachment.task_id == task.id,
                                           Attachment.organization_id == ctx.org_id, Attachment.deleted_at.is_(None)))
    if not a:
        raise not_found("Adjunto")
    return a


@router.get("/attachments/{att_id}/download")
def download_attachment(task_id: int, att_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, _, _ = load_task(db, ctx, task_id, include_deleted=True)
    a = _get_att(db, ctx, task, att_id)
    safe = quote(a.filename, safe="")
    inline = a.content_type.startswith("image/") and a.content_type != "image/svg+xml" or a.content_type == "application/pdf"
    headers = {
        "Content-Disposition": f'{"inline" if inline else "attachment"}; filename*=UTF-8\'\'{safe}',
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Content-Length": str(a.size),
    }
    return StreamingResponse(get_storage().stream(a.storage_key), media_type=a.content_type, headers=headers)


@router.delete("/attachments/{att_id}", response_model=Message)
def delete_attachment(task_id: int, att_id: int, ctx: OrgCtx = Depends(get_org_ctx), db: Session = Depends(get_db)):
    task, project, role = load_task(db, ctx, task_id)
    a = _get_att(db, ctx, task, att_id)
    if a.uploader_id != ctx.user.id and role != "manager":
        raise forbidden()
    a.deleted_at = utcnow()  # el objeto se conserva en S3 (borrado lógico)
    log_activity(db, org_id=ctx.org_id, actor_id=ctx.user.id, action="attachment_deleted", entity_type="attachment",
                 entity_id=a.id, project_id=project.id, task_id=task.id, changes={"filename": [a.filename, None]})
    emit_org(db, ctx.org_id, "task.updated", project_id=project.id, task_id=task.id)
    db.commit()
    return Message(detail="Adjunto eliminado")
