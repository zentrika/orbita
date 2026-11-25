"""Reglas de negocio: jerarquía, equipos, comentarios con aprobación, reasignación, transferencias, capacidad,
contribuciones, logros y rachas."""

import io
from datetime import date, timedelta

import pytest

from app.core.db import SessionLocal, utcnow
from app.models import (
    Comment,
    CommentVersion,
    Notification,
    Organization,
    OrgHoliday,
    TaskContribution,
    UserAbsence,
    UserAchievement,
)
from app.services.achievements import compute_streak

API = "/api/v1"


@pytest.fixture
def world(make_user, join):
    """Organización tipo: CEO, PMO, Team 404 (líder Jairo, Juan y Jesús), Team Meraki y Bug Hunter (QA)."""
    ceo = make_user("ceo@x.com", "Taktica")
    org = ceo.org_id
    pmo = join(ceo, "pmo@x.com", "pmo")
    jairo = join(ceo, "jairo@x.com", "member")
    juan = join(ceo, "juan@x.com", "member")
    jesus = join(ceo, "jesus@x.com", "member")
    lider_meraki = join(ceo, "lmeraki@x.com", "member")
    ana = join(ceo, "ana@x.com", "member")
    qa = join(ceo, "qa@x.com", "member")
    maria = join(ceo, "maria@x.com", "member")

    def team(name, lead, members, is_qa=False):
        r = ceo.post(f"{API}/orgs/{org}/teams", json={"name": name, "lead_id": lead.me["id"],
                                                      "member_ids": [m.me["id"] for m in members], "is_qa": is_qa})
        assert r.status_code == 201, r.text
        return r.json()

    t404 = team("Team 404", jairo, [juan, jesus])
    meraki = team("Team Meraki", lider_meraki, [ana])
    bug = team("Bug Hunter", qa, [], is_qa=True)
    p = ceo.post(f"{API}/orgs/{org}/projects", json={"name": "Vatia", "key": "VAT", "team_ids": [t404["id"], meraki["id"], bug["id"]]})
    assert p.status_code == 201, p.text
    project = p.json()
    statuses = {s["category"]: s["id"] for s in project["statuses"]}
    return {"org": org, "ceo": ceo, "pmo": pmo, "jairo": jairo, "juan": juan, "jesus": jesus, "lmeraki": lider_meraki,
            "ana": ana, "qa": qa, "maria": maria, "t404": t404, "meraki": meraki, "bug": bug, "project": project,
            "statuses": statuses}


def new_task(w, by, **kw):
    body = {"project_id": w["project"]["id"], "title": kw.pop("title", "VAT tarea"), **kw}
    r = by.post(f"{API}/orgs/{w['org']}/tasks", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ---- Proyectos y visibilidad ----------------------------------------------------------


def test_private_project_and_team_access(world):
    w, org = world, world["org"]
    # Maria pertenece a la organización pero a ningún equipo del proyecto: no lo ve.
    assert w["maria"].get(f"{API}/orgs/{org}/projects/{w['project']['id']}").status_code == 404
    assert w["juan"].get(f"{API}/orgs/{org}/projects/{w['project']['id']}").status_code == 200
    # Proyecto «Aura»: sólo de su creador.
    aura = w["jairo"].post(f"{API}/orgs/{org}/projects", json={"name": "Aura", "key": "AUR"}).json()
    assert aura["visibility"] == "private"
    assert w["juan"].get(f"{API}/orgs/{org}/projects/{aura['id']}").status_code == 404
    # Añadir y quitar a Maria de un proyecto concreto.
    w["jairo"].post(f"{API}/orgs/{org}/projects/{aura['id']}/members", json={"user_id": w["maria"].me["id"], "role": "member"})
    assert w["maria"].get(f"{API}/orgs/{org}/projects/{aura['id']}").status_code == 200
    w["jairo"].delete(f"{API}/orgs/{org}/projects/{aura['id']}/members/{w['maria'].me['id']}")
    assert w["maria"].get(f"{API}/orgs/{org}/projects/{aura['id']}").status_code == 404


def test_task_visible_only_to_its_team(world):
    w, org = world, world["org"]
    t = new_task(w, w["jairo"], team_id=w["t404"]["id"], title="Sólo para el 404")
    assert w["juan"].get(f"{API}/orgs/{org}/tasks/{t['id']}").status_code == 200
    assert w["ana"].get(f"{API}/orgs/{org}/tasks/{t['id']}").status_code == 404  # Meraki no la ve
    assert all(x["id"] != t["id"] for x in w["ana"].get(f"{API}/orgs/{org}/tasks").json())
    assert w["pmo"].get(f"{API}/orgs/{org}/tasks/{t['id']}").status_code == 200  # PMO ve todo


def test_only_creator_or_lead_edits(world):
    w, org = world, world["org"]
    t = new_task(w, w["juan"], team_id=w["t404"]["id"])
    assert w["jesus"].patch(f"{API}/orgs/{org}/tasks/{t['id']}", json={"title": "Cambio ajeno"}).status_code == 403
    assert w["juan"].patch(f"{API}/orgs/{org}/tasks/{t['id']}", json={"title": "Cambio del creador"}).status_code == 200
    assert w["jairo"].patch(f"{API}/orgs/{org}/tasks/{t['id']}", json={"title": "Cambio del líder"}).status_code == 200


def test_labels_created_inline_per_project(world):
    w, org, pid = world, world["org"], world["project"]["id"]
    r = w["juan"].post(f"{API}/orgs/{org}/projects/{pid}/labels", json={"name": "Backend", "color": "#2563EB"})
    assert r.status_code == 201
    again = w["juan"].post(f"{API}/orgs/{org}/projects/{pid}/labels", json={"name": "backend", "color": "#2563EB"})
    assert again.json()["id"] == r.json()["id"]  # idempotente, sin duplicados
    t = new_task(w, w["juan"], team_id=w["t404"]["id"], label_ids=[r.json()["id"]])
    assert [lb["name"] for lb in t["labels"]] == ["Backend"]


# ---- Reasignación y transferencias ------------------------------------------------------


def test_lead_reassigns_member_cannot(world):
    w, org = world, world["org"]
    t = new_task(w, w["jairo"], team_id=w["t404"]["id"], assignee_id=w["jesus"].me["id"])
    # Jesús no puede transferirse la tarea a Juan.
    r = w["jesus"].post(f"{API}/orgs/{org}/tasks/{t['id']}/assign", json={"assignee_id": w["juan"].me["id"], "reason": "x"})
    assert r.status_code == 403
    assert w["jesus"].patch(f"{API}/orgs/{org}/tasks/{t['id']}", json={"assignee_id": w["juan"].me["id"]}).status_code == 403
    # Un integrante de otro equipo no es elegible.
    r = w["jairo"].post(f"{API}/orgs/{org}/tasks/{t['id']}/assign", json={"assignee_id": w["ana"].me["id"], "reason": "x"})
    assert r.status_code == 400
    # Jairo (líder) sí.
    r = w["jairo"].post(f"{API}/orgs/{org}/tasks/{t['id']}/assign",
                        json={"assignee_id": w["juan"].me["id"], "reason": "Juan tiene 0 pendientes"})
    assert r.status_code == 200 and r.json()["assignee"]["id"] == w["juan"].me["id"]
    assert r.json()["reporter"]["id"] == w["jairo"].me["id"]  # el creador no cambia
    hist = w["jairo"].get(f"{API}/orgs/{org}/tasks/{t['id']}/assignment-history").json()
    assert hist[0]["reason"] == "Juan tiene 0 pendientes" and hist[0]["changed_by"]["id"] == w["jairo"].me["id"]
    assert hist[0]["from_user"]["id"] == w["jesus"].me["id"]
    # Notificaciones al anterior y al nuevo responsable.
    assert any(n["type"] == "unassigned" for n in w["jesus"].get(f"{API}/orgs/{org}/notifications").json()["items"])
    assert any(n["type"] == "assigned" for n in w["juan"].get(f"{API}/orgs/{org}/notifications").json()["items"])
    # Selector de responsables con carga.
    el = w["jairo"].get(f"{API}/orgs/{org}/tasks/{t['id']}/eligible-assignees").json()
    names = {e["user"]["email"]: e for e in el}
    assert set(names) == {"jairo@x.com", "juan@x.com", "jesus@x.com"}
    assert names["juan@x.com"]["pending"] == 1


def test_member_cannot_assign_others_at_creation(world):
    w, org = world, world["org"]
    r = w["juan"].post(f"{API}/orgs/{org}/tasks", json={"project_id": w["project"]["id"], "title": "x",
                                                        "team_id": w["t404"]["id"], "assignee_id": w["jesus"].me["id"]})
    assert r.status_code == 403
    mine = new_task(w, w["juan"], team_id=w["t404"]["id"], assignee_id=w["juan"].me["id"])
    assert mine["assignee"]["id"] == w["juan"].me["id"]


def test_transfer_between_teams(world):
    w, org = world, world["org"]
    t = new_task(w, w["jairo"], team_id=w["t404"]["id"], assignee_id=w["jesus"].me["id"])
    assert w["jesus"].post(f"{API}/orgs/{org}/tasks/{t['id']}/transfer", json={"team_id": w["meraki"]["id"], "reason": "x" * 5}).status_code == 403
    r = w["jairo"].post(f"{API}/orgs/{org}/tasks/{t['id']}/transfer", json={"team_id": w["meraki"]["id"], "reason": "Es frontend"})
    assert r.status_code == 200
    body = r.json()
    assert body["team"]["id"] == w["meraki"]["id"] and body["assignee"] is None  # Jesús no es de Meraki
    # No se duplica la tarea.
    assert len([x for x in w["pmo"].get(f"{API}/orgs/{org}/tasks").json() if x["id"] == t["id"]]) == 1
    tr = w["pmo"].get(f"{API}/orgs/{org}/tasks/{t['id']}/transfers").json()
    assert tr[0]["from_team"]["id"] == w["t404"]["id"] and tr[0]["to_team"]["id"] == w["meraki"]["id"]
    # El equipo anterior pierde la facultad de reasignar; el receptor la gana.
    assert w["jairo"].post(f"{API}/orgs/{org}/tasks/{t['id']}/assign", json={"assignee_id": w["juan"].me["id"]}).status_code in (403, 404)
    assert w["lmeraki"].post(f"{API}/orgs/{org}/tasks/{t['id']}/assign", json={"assignee_id": w["ana"].me["id"], "reason": "ok"}).status_code == 200
    assert any(n["type"] == "transferred" for n in w["lmeraki"].get(f"{API}/orgs/{org}/notifications").json()["items"])


# ---- Capacidad ---------------------------------------------------------------------------


def test_wip_limit_four_in_progress(world):
    w, org, st = world, world["org"], world["statuses"]
    juan = w["juan"]
    ids = [new_task(w, w["jairo"], team_id=w["t404"]["id"], assignee_id=juan.me["id"], title=f"T{i}")["id"] for i in range(6)]
    for i in ids[:4]:
        assert juan.post(f"{API}/orgs/{org}/tasks/{i}/move", json={"status_id": st["in_progress"], "position": 1}).status_code == 200
    r = juan.post(f"{API}/orgs/{org}/tasks/{ids[4]}/move", json={"status_id": st["in_progress"], "position": 1})
    assert r.status_code == 409  # 4/4: no puede iniciar una quinta (aunque tenga 6 asignadas)
    # Reasignar a alguien sin cupo una tarea en progreso también se bloquea.
    other = new_task(w, w["jairo"], team_id=w["t404"]["id"], assignee_id=w["jesus"].me["id"], title="De Jesús")
    w["jesus"].post(f"{API}/orgs/{org}/tasks/{other['id']}/move", json={"status_id": st["in_progress"], "position": 1})
    assert w["jairo"].post(f"{API}/orgs/{org}/tasks/{other['id']}/assign", json={"assignee_id": juan.me["id"]}).status_code == 409
    # Terminar una libera el cupo de inmediato.
    assert juan.post(f"{API}/orgs/{org}/tasks/{ids[0]}/move", json={"status_id": st["done"], "position": 1}).status_code == 200
    assert juan.post(f"{API}/orgs/{org}/tasks/{ids[4]}/move", json={"status_id": st["in_progress"], "position": 1}).status_code == 200
    office = w["ceo"].get(f"{API}/orgs/{org}/office").json()
    juan_row = next(m for t in office["teams"] for m in t["members"] if m["user"]["id"] == juan.me["id"])
    assert juan_row["in_progress"] == 4 and juan_row["capacity"] == 4


# ---- Comentarios -------------------------------------------------------------------------


def test_comment_delete_only_author_and_replies_with_attachments(world):
    w, org = world, world["org"]
    t = new_task(w, w["jairo"], team_id=w["t404"]["id"])
    c = w["juan"].post(f"{API}/orgs/{org}/tasks/{t['id']}/comments", json={"body": "<p>Primer avance</p>"}).json()
    # Ni el CEO ni el líder pueden borrar un comentario ajeno.
    assert w["ceo"].delete(f"{API}/orgs/{org}/tasks/{t['id']}/comments/{c['id']}").status_code == 403
    assert w["jairo"].delete(f"{API}/orgs/{org}/tasks/{t['id']}/comments/{c['id']}").status_code == 403
    reply = w["jairo"].post(f"{API}/orgs/{org}/tasks/{t['id']}/comments", json={"body": "<p>Gracias</p>", "parent_id": c["id"]}).json()
    assert reply["parent_id"] == c["id"]
    up = w["jairo"].post(f"{API}/orgs/{org}/tasks/{t['id']}/attachments", data={"comment_id": str(reply["id"])},
                         files={"file": ("captura.png", io.BytesIO(b"\x89PNG..."), "image/png")})
    assert up.status_code == 201 and up.json()["comment_id"] == reply["id"]
    # No se puede adjuntar a comentarios ajenos.
    bad = w["jesus"].post(f"{API}/orgs/{org}/tasks/{t['id']}/attachments", data={"comment_id": str(reply["id"])},
                          files={"file": ("x.png", io.BytesIO(b"x"), "image/png")})
    assert bad.status_code == 403
    listed = w["juan"].get(f"{API}/orgs/{org}/tasks/{t['id']}/comments").json()
    assert next(x for x in listed if x["id"] == reply["id"])["attachments"][0]["filename"] == "captura.png"
    assert any(n["type"] == "replied" for n in w["juan"].get(f"{API}/orgs/{org}/notifications").json()["items"])
    assert w["juan"].delete(f"{API}/orgs/{org}/tasks/{t['id']}/comments/{c['id']}").status_code == 200


def _comment(w, author, text="<p>Texto original del comentario</p>"):
    t = new_task(w, w["jairo"], team_id=w["t404"]["id"])
    c = author.post(f"{API}/orgs/{w['org']}/tasks/{t['id']}/comments", json={"body": text}).json()
    return t, c


def test_edit_request_flow_approve(world):
    w, org = world, world["org"]
    t, c = _comment(w, w["juan"])
    base = f"{API}/orgs/{org}/tasks/{t['id']}/comments/{c['id']}"
    # No hay edición directa.
    assert w["juan"].patch(base, json={"body": "nuevo"}).status_code == 405
    # Sólo el autor puede pedirla.
    assert w["jesus"].post(f"{base}/edit-requests", json={"proposed_body": "x", "reason": "porque sí"}).status_code == 403
    r = w["juan"].post(f"{base}/edit-requests", json={"proposed_body": "<p>Texto corregido</p>", "reason": "Error de cifra"})
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["approver"]["id"] == w["jairo"].me["id"] and req["team"]["id"] == w["t404"]["id"]
    assert req["project"]["key"] == "VAT" and req["organization_id"] == org and req["status"] == "pending"
    # Sin duplicados pendientes.
    assert w["juan"].post(f"{base}/edit-requests", json={"proposed_body": "<p>Otra</p>", "reason": "Otra vez"}).status_code == 409
    # El comentario original no cambia mientras está pendiente.
    assert w["juan"].get(f"{API}/orgs/{org}/tasks/{t['id']}/comments").json()[0]["body"] == "<p>Texto original del comentario</p>"
    # Notificaciones al líder y al PMO.
    assert any(n["type"] == "edit_request" for n in w["jairo"].get(f"{API}/orgs/{org}/notifications").json()["items"])
    assert any(n["type"] == "edit_request_info" for n in w["pmo"].get(f"{API}/orgs/{org}/notifications").json()["items"])
    # El PMO no aprueba automáticamente; un líder ajeno tampoco.
    dec = f"{API}/orgs/{org}/comment-edit-requests/{req['id']}/decision"
    assert w["pmo"].post(dec, json={"approve": True}).status_code == 403
    assert w["lmeraki"].post(dec, json={"approve": True}).status_code == 403
    assert w["pmo"].get(f"{API}/orgs/{org}/comment-edit-requests", params={"scope": "all"}).status_code == 200
    assert w["juan"].get(f"{API}/orgs/{org}/comment-edit-requests", params={"scope": "all"}).status_code == 403
    inbox = w["jairo"].get(f"{API}/orgs/{org}/comment-edit-requests").json()
    assert inbox[0]["can_decide"] is True
    ok = w["jairo"].post(dec, json={"approve": True, "note": "Correcto"})
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    # Una segunda decisión (p. ej., doble clic o aprobación simultánea) no vuelve a aplicar el cambio.
    assert w["jairo"].post(dec, json={"approve": True}).status_code == 409
    comments = w["juan"].get(f"{API}/orgs/{org}/tasks/{t['id']}/comments").json()
    assert comments[0]["body"] == "<p>Texto corregido</p>" and comments[0]["version"] == 2
    versions = w["juan"].get(f"{base}/versions").json()
    assert [v["body"] for v in versions] == ["<p>Texto original del comentario</p>", "<p>Texto corregido</p>"]
    assert any(n["type"] == "edit_decision" for n in w["juan"].get(f"{API}/orgs/{org}/notifications").json()["items"])
    assert any(n["type"] == "edit_decision_info" for n in w["pmo"].get(f"{API}/orgs/{org}/notifications").json()["items"])
    activity = w["ceo"].get(f"{API}/orgs/{org}/tasks/{t['id']}/activity").json()
    assert {"edit_requested", "edit_approved"} <= {a["action"] for a in activity}


def test_edit_request_reject_and_window(world):
    w, org = world, world["org"]
    t, c = _comment(w, w["juan"])
    base = f"{API}/orgs/{org}/tasks/{t['id']}/comments/{c['id']}"
    req = w["juan"].post(f"{base}/edit-requests", json={"proposed_body": "<p>B</p>", "reason": "Ajuste menor"}).json()
    r = w["jairo"].post(f"{API}/orgs/{org}/comment-edit-requests/{req['id']}/decision", json={"approve": False, "note": "No aplica"})
    assert r.json()["status"] == "rejected"
    assert w["juan"].get(f"{API}/orgs/{org}/tasks/{t['id']}/comments").json()[0]["body"] == "<p>Texto original del comentario</p>"
    # Tras 48 h (reloj del servidor) ya no se puede pedir.
    with SessionLocal() as db:
        db.get(Comment, c["id"]).created_at = utcnow() - timedelta(hours=49)
        db.commit()
    late = w["juan"].post(f"{base}/edit-requests", json={"proposed_body": "<p>C</p>", "reason": "Tarde"})
    assert late.status_code == 400


def test_request_inside_window_can_be_resolved_later(world):
    w, org = world, world["org"]
    t, c = _comment(w, w["juan"])
    req = w["juan"].post(f"{API}/orgs/{org}/tasks/{t['id']}/comments/{c['id']}/edit-requests",
                         json={"proposed_body": "<p>D</p>", "reason": "Dentro de plazo"}).json()
    with SessionLocal() as db:
        db.get(Comment, c["id"]).created_at = utcnow() - timedelta(days=5)
        db.commit()
    r = w["jairo"].post(f"{API}/orgs/{org}/comment-edit-requests/{req['id']}/decision", json={"approve": True})
    assert r.status_code == 200
    with SessionLocal() as db:
        assert db.query(CommentVersion).filter_by(comment_id=c["id"]).count() == 2


# ---- Logros y rachas ----------------------------------------------------------------------


def _achievements(user_id):
    with SessionLocal() as db:
        return [(a.user_id, a.dedupe_key.split(":")[0], a.status) for a in db.query(UserAchievement).filter_by(user_id=user_id)]


def test_vat1_resolution_scenario(world):
    w, org, st = world, world["org"], world["statuses"]
    juan, jesus, qa, jairo = w["juan"], w["jesus"], w["qa"], w["jairo"]
    t = new_task(w, jairo, team_id=w["t404"]["id"], assignee_id=juan.me["id"], title="VAT-1")
    tid = t["id"]
    # 1. Juan inicia y registra contribuciones.
    juan.post(f"{API}/orgs/{org}/tasks/{tid}/move", json={"status_id": st["in_progress"], "position": 1})
    for i in range(3):
        juan.post(f"{API}/orgs/{org}/tasks/{tid}/comments",
                  json={"body": f"<p>Avance técnico {i}: ajusté el endpoint de pagos y validé respuesta {i * 7}</p>"})
    juan.post(f"{API}/orgs/{org}/tasks/{tid}/comments", json={"body": "<p>ok</p>"})  # trivial: no cuenta
    # 2. Juan envía a QA; 3. QA rechaza.
    assert juan.post(f"{API}/orgs/{org}/tasks/{tid}/submit-qa", json={"note": "Listo para revisión v1"}).status_code == 200
    assert juan.post(f"{API}/orgs/{org}/tasks/{tid}/qa-review", json={"approve": True, "evidence": "Me apruebo yo mismo"}).status_code == 403
    r = qa.post(f"{API}/orgs/{org}/tasks/{tid}/qa-review", json={"approve": False, "evidence": "Falla con montos negativos"})
    assert r.status_code == 200
    # 4. El líder reasigna a Jesús (sin puntos por reasignar).
    jairo.post(f"{API}/orgs/{org}/tasks/{tid}/assign", json={"assignee_id": jesus.me["id"], "reason": "Juan sin contexto"})
    assert _achievements(jesus.me["id"]) == []
    # 5. Jesús corrige y envía; 6. QA valida.
    jesus.post(f"{API}/orgs/{org}/tasks/{tid}/comments",
               json={"body": "<p>Corregí la validación de montos negativos y agregué pruebas unitarias</p>"})
    assert jesus.post(f"{API}/orgs/{org}/tasks/{tid}/submit-qa", json={"note": "Corrección de negativos"}).status_code == 200
    r = qa.post(f"{API}/orgs/{org}/tasks/{tid}/qa-review", json={"approve": True, "evidence": "Probé 12 casos, todos pasan"})
    assert r.status_code == 200 and r.json()["status"]["category"] == "done"

    assert _achievements(juan.me["id"]) == []  # sus comentarios no le dan la resolución
    assert ("resolution" in [a[1] for a in _achievements(jesus.me["id"])])
    assert ("validation" in [a[1] for a in _achievements(qa.me["id"])])
    assert _achievements(jairo.me["id"]) == []  # nadie gana por haber estado asignado o por reasignar
    with SessionLocal() as db:
        juan_contribs = db.query(TaskContribution).filter_by(user_id=juan.me["id"], task_id=tid).all()
        assert sum(c.kind == "comment" for c in juan_contribs) == 3  # el «ok» no cuenta
        assert any(c.kind == "qa_submission" for c in juan_contribs)
    perf = jairo.get(f"{API}/orgs/{org}/users/{jesus.me['id']}/performance").json()  # el líder puede consultarla
    assert perf["resolutions"] == 1
    assert w["ana"].get(f"{API}/orgs/{org}/users/{jesus.me['id']}/performance").status_code == 403
    assert w["pmo"].get(f"{API}/orgs/{org}/achievements", params={"team_id": w["t404"]["id"]}).status_code == 200
    assert juan.get(f"{API}/orgs/{org}/achievements").status_code == 403

    # Reapertura: los logros del ciclo aceptado se revocan.
    jairo.post(f"{API}/orgs/{org}/tasks/{tid}/move", json={"status_id": st["in_progress"], "position": 1})
    assert {a[2] for a in _achievements(jesus.me["id"])} == {"revoked"}


def test_no_duplicate_achievements_on_retry(world):
    from app.models import Task, TaskResolutionCycle
    from app.services.achievements import award

    w = world
    t = new_task(w, w["jairo"], team_id=w["t404"]["id"])
    with SessionLocal() as db:
        task = db.get(Task, t["id"])
        cycle = TaskResolutionCycle(organization_id=w["org"], project_id=task.project_id, task_id=task.id, number=1,
                                    submitted_by_id=w["juan"].me["id"], status="accepted")
        db.add(cycle)
        db.flush()
        first = award(db, org_id=w["org"], user_id=w["juan"].me["id"], code="resolution", dedupe_key=f"resolution:{cycle.id}",
                      task=task, cycle=cycle)
        second = award(db, org_id=w["org"], user_id=w["juan"].me["id"], code="resolution", dedupe_key=f"resolution:{cycle.id}",
                       task=task, cycle=cycle)
        db.commit()
        assert first is not None and second is None
        assert db.query(UserAchievement).filter_by(cycle_id=cycle.id).count() == 1


def test_streak_skips_weekends_holidays_and_absences(world):
    w = world
    uid = w["juan"].me["id"]
    with SessionLocal() as db:
        org = db.get(Organization, w["org"])
        from app.models import Task

        task = db.query(Task).first() or None
        tid = new_task(w, w["jairo"], team_id=w["t404"]["id"])["id"] if task is None else task.id
        # Jueves 5, viernes 6, (fin de semana), lunes 9 = festivo, martes 10 ausencia, miércoles 11.
        days = [date(2026, 11, 5), date(2026, 11, 6), date(2026, 11, 11)]
        db.add(OrgHoliday(organization_id=org.id, date=date(2026, 11, 9), name="Festivo"))
        db.add(UserAbsence(organization_id=org.id, user_id=uid, start_date=date(2026, 11, 10), end_date=date(2026, 11, 10)))
        for i, d in enumerate(days):
            db.add(TaskContribution(organization_id=org.id, project_id=w["project"]["id"], task_id=tid, user_id=uid,
                                    kind="comment", source_type="test", source_id=1000 + i, local_date=d))
        db.commit()
        current, best, last, _ = compute_streak(db, org, uid, today=date(2026, 11, 11))
        assert (current, best, last) == (3, 3, date(2026, 11, 11))
        # Un día laboral sin contribución sí la rompe.
        current, _, _, _ = compute_streak(db, org, uid, today=date(2026, 11, 13))
        assert current == 0


def test_notifications_for_pmo_exist(world):
    """El PMO recibe avisos de solicitudes; comprobación directa en base de datos."""
    w, org = world, world["org"]
    t, c = _comment(w, w["juan"])
    w["juan"].post(f"{API}/orgs/{org}/tasks/{t['id']}/comments/{c['id']}/edit-requests",
                   json={"proposed_body": "<p>Z</p>", "reason": "Detalle"})
    with SessionLocal() as db:
        assert db.query(Notification).filter_by(user_id=w["pmo"].me["id"], type="edit_request_info").count() == 1
