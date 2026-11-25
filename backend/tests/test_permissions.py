"""Roles de organización y de proyecto validados en el backend."""


def _project(actor, **kw):
    r = actor.post(f"/api/v1/orgs/{actor.org_id}/projects", json={"name": "Proyecto", "key": "PRJ", **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_guest_permissions(make_user, join):
    owner = make_user("o@x.com", "Acme")
    guest = join(owner, "g@x.com", "guest")
    p = _project(owner)
    t = owner.post(f"/api/v1/orgs/{owner.org_id}/tasks", json={"project_id": p["id"], "title": "T"}).json()
    org = owner.org_id

    # El invitado no ve proyectos a los que no fue añadido.
    assert guest.get(f"/api/v1/orgs/{org}/projects").json() == []
    assert guest.get(f"/api/v1/orgs/{org}/tasks/{t['id']}").status_code == 404
    # Ni puede crear proyectos.
    assert guest.post(f"/api/v1/orgs/{org}/projects", json={"name": "Xyz", "key": "XX"}).status_code == 403

    # Añadido al proyecto (aunque se pida "manager", se limita a guest).
    r = owner.post(f"/api/v1/orgs/{org}/projects/{p['id']}/members", json={"user_id": guest.me["id"], "role": "manager"})
    assert r.json()["role"] == "guest"
    assert guest.get(f"/api/v1/orgs/{org}/tasks/{t['id']}").status_code == 200
    assert guest.post(f"/api/v1/orgs/{org}/tasks/{t['id']}/comments", json={"body": "Hola"}).status_code == 201
    assert guest.patch(f"/api/v1/orgs/{org}/tasks/{t['id']}", json={"title": "x"}).status_code == 403
    assert guest.post(f"/api/v1/orgs/{org}/tasks", json={"project_id": p["id"], "title": "x"}).status_code == 403
    assert guest.delete(f"/api/v1/orgs/{org}/tasks/{t['id']}").status_code == 403


def test_member_permissions(make_user, join):
    owner = make_user("o@x.com", "Acme")
    member = join(owner, "m@x.com", "member")
    org = owner.org_id
    p = _project(owner, visibility="organization")
    t = owner.post(f"/api/v1/orgs/{org}/tasks", json={"project_id": p["id"], "title": "Del owner"}).json()

    # Proyecto abierto a la organización: el miembro trabaja pero sólo edita lo que creó.
    assert member.patch(f"/api/v1/orgs/{org}/tasks/{t['id']}", json={"title": "Editada"}).status_code == 403
    mine = member.post(f"/api/v1/orgs/{org}/tasks", json={"project_id": p["id"], "title": "Mía"}).json()
    assert member.patch(f"/api/v1/orgs/{org}/tasks/{mine['id']}", json={"title": "Mía editada"}).status_code == 200
    assert member.delete(f"/api/v1/orgs/{org}/tasks/{t['id']}").status_code == 403
    assert member.delete(f"/api/v1/orgs/{org}/tasks/{mine['id']}").status_code == 200
    assert member.patch(f"/api/v1/orgs/{org}/projects/{p['id']}", json={"name": "Xyz"}).status_code == 403
    assert member.post(f"/api/v1/orgs/{org}/projects/{p['id']}/statuses", json={"name": "QA"}).status_code == 403
    assert member.delete(f"/api/v1/orgs/{org}/projects/{p['id']}").status_code == 403
    # No administra la organización.
    assert member.post(f"/api/v1/orgs/{org}/invitations", json={"email": "z@x.com"}).status_code == 403
    assert member.patch(f"/api/v1/orgs/{org}/members/{owner.me['id']}", json={"role": "member"}).status_code == 403


def test_private_project_hidden_from_members(make_user, join):
    owner = make_user("o@x.com", "Acme")
    member = join(owner, "m@x.com", "member")
    org = owner.org_id
    p = _project(owner, visibility="private")
    assert member.get(f"/api/v1/orgs/{org}/projects").json() == []
    assert member.get(f"/api/v1/orgs/{org}/projects/{p['id']}").status_code == 404
    owner.post(f"/api/v1/orgs/{org}/projects/{p['id']}/members", json={"user_id": member.me["id"], "role": "member"})
    assert member.get(f"/api/v1/orgs/{org}/projects/{p['id']}").status_code == 200


def test_project_manager_role(make_user, join):
    owner = make_user("o@x.com", "Acme")
    pm = join(owner, "pm@x.com", "member")
    org = owner.org_id
    p = _project(owner, visibility="private")
    owner.post(f"/api/v1/orgs/{org}/projects/{p['id']}/members", json={"user_id": pm.me["id"], "role": "manager"})
    assert pm.patch(f"/api/v1/orgs/{org}/projects/{p['id']}", json={"name": "Renombrado"}).status_code == 200
    assert pm.post(f"/api/v1/orgs/{org}/projects/{p['id']}/labels", json={"name": "Urgente"}).status_code == 201


def test_owner_rules(make_user, join):
    owner = make_user("o@x.com", "Acme")
    admin = join(owner, "a@x.com", "admin")
    org = owner.org_id
    # Un admin no puede tocar al propietario ni promover a propietario.
    assert admin.patch(f"/api/v1/orgs/{org}/members/{owner.me['id']}", json={"role": "member"}).status_code == 403
    assert admin.post(f"/api/v1/orgs/{org}/invitations", json={"email": "z@x.com", "role": "owner"}).status_code == 403
    # El último propietario no puede degradarse.
    assert owner.patch(f"/api/v1/orgs/{org}/members/{owner.me['id']}", json={"role": "admin"}).status_code == 400
    # Un admin sí puede invitar miembros.
    assert admin.post(f"/api/v1/orgs/{org}/invitations", json={"email": "z@x.com", "role": "member"}).status_code == 201


def test_task_lifecycle_and_audit(make_user, join):
    owner = make_user("o@x.com", "Acme")
    member = join(owner, "maria@x.com", "member")
    org = owner.org_id
    p = _project(owner, visibility="organization")
    detail = owner.get(f"/api/v1/orgs/{org}/projects/{p['id']}").json()
    done = next(s for s in detail["statuses"] if s["category"] == "done")
    t = owner.post(f"/api/v1/orgs/{org}/tasks", json={
        "project_id": p["id"], "title": "Tarea", "assignee_id": member.me["id"], "type": "bug",
        "description": "<p>Hola <script>alert(1)</script></p>"}).json()
    assert t["key"] == "PRJ-1"
    assert "<script>" not in t["description"]
    # Notificación de asignación.
    notes = member.get(f"/api/v1/orgs/{org}/notifications").json()
    assert notes["unread"] == 1 and notes["items"][0]["type"] == "assigned"
    # Mover a "Hecho" marca completada y deja auditoría.
    moved = owner.post(f"/api/v1/orgs/{org}/tasks/{t['id']}/move", json={"status_id": done["id"], "position": 10}).json()
    assert moved["completed_at"] is not None
    activity = owner.get(f"/api/v1/orgs/{org}/tasks/{t['id']}/activity").json()
    assert {a["action"] for a in activity} >= {"created", "updated"}
    # Mención en comentario.
    owner.post(f"/api/v1/orgs/{org}/tasks/{t['id']}/comments", json={"body": "Revisa esto @maria"})
    types = [n["type"] for n in member.get(f"/api/v1/orgs/{org}/notifications").json()["items"]]
    assert "mentioned" in types
    # Subtarea, checklist, relación, tiempo.
    sub = owner.post(f"/api/v1/orgs/{org}/tasks", json={"project_id": p["id"], "title": "Sub", "parent_id": t["id"]}).json()
    assert owner.post(f"/api/v1/orgs/{org}/tasks/{t['id']}/checklist", json={"text": "Paso 1"}).status_code == 201
    assert owner.post(f"/api/v1/orgs/{org}/tasks/{sub['id']}/relations", json={"target_task_id": t["id"], "type": "blocks"}).status_code == 201
    assert owner.post(f"/api/v1/orgs/{org}/tasks/{t['id']}/time-entries", json={"minutes": 90}).status_code == 201
    full = owner.get(f"/api/v1/orgs/{org}/tasks/{t['id']}").json()
    assert full["subtask_count"] == 1 and full["checklist_total"] == 1 and full["time_spent_minutes"] == 90
    assert full["relations"][0]["label"] == "Bloqueada por"
    # Ciclo padre-hijo rechazado.
    assert owner.patch(f"/api/v1/orgs/{org}/tasks/{t['id']}", json={"parent_id": sub["id"]}).status_code == 400
    # Borrado lógico: desaparece para los demás; quien la borró la sigue viendo tachada y puede restaurarla.
    assert owner.delete(f"/api/v1/orgs/{org}/tasks/{t['id']}").status_code == 200
    assert owner.get(f"/api/v1/orgs/{org}/tasks/{t['id']}").json()["deleted_at"] is not None
    assert member.get(f"/api/v1/orgs/{org}/tasks/{t['id']}").status_code == 404
    listed = owner.get(f"/api/v1/orgs/{org}/tasks", params={"project_id": p["id"]}).json()
    assert any(x["id"] == t["id"] and x["deleted_at"] for x in listed)
    assert all(x["id"] != t["id"] for x in member.get(f"/api/v1/orgs/{org}/tasks", params={"project_id": p["id"]}).json())
    assert owner.post(f"/api/v1/orgs/{org}/tasks/{t['id']}/restore").status_code == 200
    assert member.get(f"/api/v1/orgs/{org}/tasks/{t['id']}").status_code == 200


def test_attachments_validation(make_user):
    import io

    owner = make_user("o@x.com", "Acme")
    org = owner.org_id
    p = _project(owner)
    t = owner.post(f"/api/v1/orgs/{org}/tasks", json={"project_id": p["id"], "title": "T"}).json()
    ok = owner.post(f"/api/v1/orgs/{org}/tasks/{t['id']}/attachments",
                    files={"file": ("nota.txt", io.BytesIO(b"contenido"), "text/plain")})
    assert ok.status_code == 201
    bad = owner.post(f"/api/v1/orgs/{org}/tasks/{t['id']}/attachments",
                     files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")})
    assert bad.status_code == 415
    dl = owner.get(f"/api/v1/orgs/{org}/tasks/{t['id']}/attachments/{ok.json()['id']}/download")
    assert dl.status_code == 200 and dl.content == b"contenido"
