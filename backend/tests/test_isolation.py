"""Aislamiento estricto entre organizaciones."""

import io


def _setup(a):
    p = a.post(f"/api/v1/orgs/{a.org_id}/projects", json={"name": "Secreto", "key": "SEC"}).json()
    t = a.post(f"/api/v1/orgs/{a.org_id}/tasks", json={"project_id": p["id"], "title": "Plan confidencial"}).json()
    return p, t


def test_cannot_access_other_org(make_user):
    a = make_user("a@a.com", "Empresa A")
    b = make_user("b@b.com", "Empresa B")
    p, t = _setup(a)

    # B no ve la organización de A por id.
    assert b.get(f"/api/v1/orgs/{a.org_id}").status_code == 404
    assert b.get(f"/api/v1/orgs/{a.org_id}/projects").status_code == 404
    assert b.get(f"/api/v1/orgs/{a.org_id}/tasks/{t['id']}").status_code == 404
    assert b.get(f"/api/v1/orgs/{a.org_id}/members").status_code == 404

    # Ni usando el id de su propia organización con ids ajenos.
    assert b.get(f"/api/v1/orgs/{b.org_id}/projects/{p['id']}").status_code == 404
    assert b.get(f"/api/v1/orgs/{b.org_id}/tasks/{t['id']}").status_code == 404
    assert b.patch(f"/api/v1/orgs/{b.org_id}/tasks/{t['id']}", json={"title": "hackeado"}).status_code == 404
    assert b.delete(f"/api/v1/orgs/{b.org_id}/tasks/{t['id']}").status_code == 404
    assert b.post(f"/api/v1/orgs/{b.org_id}/tasks/{t['id']}/comments", json={"body": "hola"}).status_code == 404
    assert b.get(f"/api/v1/orgs/{b.org_id}/tasks/{t['id']}/comments").status_code == 404
    assert b.post(f"/api/v1/orgs/{b.org_id}/tasks", json={"project_id": p["id"], "title": "x"}).status_code == 404
    files = {"file": ("a.txt", io.BytesIO(b"hola"), "text/plain")}
    assert b.post(f"/api/v1/orgs/{b.org_id}/tasks/{t['id']}/attachments", files=files).status_code == 404

    # Las listas de B no contienen datos de A.
    assert b.get(f"/api/v1/orgs/{b.org_id}/tasks").json() == []
    assert b.get(f"/api/v1/orgs/{b.org_id}/search", params={"q": "confidencial"}).json()["tasks"] == []
    assert b.get(f"/api/v1/orgs/{b.org_id}/dashboard").json()["open_tasks"] == 0

    # El título no cambió.
    assert a.get(f"/api/v1/orgs/{a.org_id}/tasks/{t['id']}").json()["title"] == "Plan confidencial"


def test_cannot_reference_foreign_entities(make_user):
    a = make_user("a@a.com", "Empresa A")
    b = make_user("b@b.com", "Empresa B")
    pa, ta = _setup(a)
    pb = b.post(f"/api/v1/orgs/{b.org_id}/projects", json={"name": "Mio", "key": "MIO"}).json()
    tb = b.post(f"/api/v1/orgs/{b.org_id}/tasks", json={"project_id": pb["id"], "title": "Mía"}).json()

    # Relacionar con una tarea ajena, usar estado/etiqueta ajenos o asignar a un usuario ajeno.
    assert b.post(f"/api/v1/orgs/{b.org_id}/tasks/{tb['id']}/relations",
                  json={"target_task_id": ta["id"], "type": "blocks"}).status_code == 404
    foreign_status = a.get(f"/api/v1/orgs/{a.org_id}/projects/{pa['id']}").json()["statuses"][0]["id"]
    assert b.patch(f"/api/v1/orgs/{b.org_id}/tasks/{tb['id']}", json={"status_id": foreign_status}).status_code == 400
    assert b.patch(f"/api/v1/orgs/{b.org_id}/tasks/{tb['id']}", json={"assignee_id": a.me["id"]}).status_code == 400
    assert b.patch(f"/api/v1/orgs/{b.org_id}/tasks/{tb['id']}", json={"parent_id": ta["id"]}).status_code == 400
    assert b.post(f"/api/v1/orgs/{b.org_id}/teams", json={"name": "Mix", "member_ids": [a.me["id"]]}).status_code == 400


def test_member_of_both_sees_each_separately(make_user, invite):
    a = make_user("a@a.com", "Empresa A")
    b = make_user("b@b.com", "Empresa B")
    _setup(a)
    token = invite(b, "a@a.com")
    a.post(f"/api/v1/invitations/{token}/accept")
    assert a.get(f"/api/v1/orgs/{b.org_id}/tasks").json() == []
    assert len(a.get(f"/api/v1/orgs/{a.org_id}/tasks").json()) == 1


def test_platform_admin_endpoints_require_flag(make_user):
    a = make_user("a@a.com", "Empresa A")
    assert a.get("/api/v1/admin/organizations").status_code == 403
