import re

import pytest

from app.api.routes import auth as auth_routes


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(auth_routes, "queue_email", lambda db, to, subject, body, **kwargs: sent.append((to, subject, body)))
    return sent


def _token_from(body: str) -> str:
    return re.search(r"token=([\w-]+)", body).group(1)


def test_register_login_and_me(client, outbox):
    r = client.post("/api/v1/auth/register", json={
        "email": "Ana@Example.com", "password": "Secreta123", "full_name": "Ana", "organization_name": "Acme"})
    assert r.status_code == 201
    assert "orbita_refresh" in r.cookies
    assert r.cookies.get("orbita_refresh")
    token = r.json()["access_token"]
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["email"] == "ana@example.com"
    assert me["organizations"][0]["role"] == "owner"
    assert me["email_verified"] is False
    assert outbox and outbox[0][0] == "ana@example.com"

    bad = client.post("/api/v1/auth/login", json={"email": "ana@example.com", "password": "incorrecta1"})
    assert bad.status_code == 401
    ok = client.post("/api/v1/auth/login", json={"email": "ana@example.com", "password": "Secreta123"})
    assert ok.status_code == 200


def test_duplicate_email_and_weak_password(client):
    payload = {"email": "a@x.com", "password": "Secreta123", "full_name": "Usuario A"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    assert client.post("/api/v1/auth/register", json=payload).status_code == 409
    weak = {"email": "b@x.com", "password": "solocaracteres", "full_name": "Usuario B"}
    assert client.post("/api/v1/auth/register", json=weak).status_code == 422


def test_password_is_hashed(client):
    from app.core.db import SessionLocal
    from app.models import User

    client.post("/api/v1/auth/register", json={"email": "h@x.com", "password": "Secreta123", "full_name": "Usuario H"})
    with SessionLocal() as db:
        u = db.query(User).filter_by(email="h@x.com").one()
        assert u.password_hash.startswith("$argon2")
        assert "Secreta123" not in u.password_hash


def test_refresh_rotation_and_logout(client):
    client.post("/api/v1/auth/register", json={"email": "r@x.com", "password": "Secreta123", "full_name": "Usuario R"})
    first = client.cookies.get("orbita_refresh")
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    second = client.cookies.get("orbita_refresh")
    assert second and second != first
    # El token anterior ya no sirve (rotación).
    client.cookies.set("orbita_refresh", first, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh").status_code == 401
    client.cookies.clear()
    client.cookies.set("orbita_refresh", second, path="/api/v1/auth")
    access = client.post("/api/v1/auth/refresh").json()["access_token"]
    client.post("/api/v1/auth/logout")
    # Tras logout la sesión queda revocada y el access token deja de valer.
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 401


def test_invalid_token_rejected(client):
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer basura"}).status_code == 401


def test_verify_email(client, outbox):
    r = client.post("/api/v1/auth/register", json={"email": "v@x.com", "password": "Secreta123", "full_name": "Usuario V"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    token = _token_from(outbox[-1][2])
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 200
    assert client.get("/api/v1/auth/me", headers=h).json()["email_verified"] is True
    # Un solo uso.
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 400


def test_password_reset_revokes_sessions(client, outbox):
    r = client.post("/api/v1/auth/register", json={"email": "p@x.com", "password": "Secreta123", "full_name": "Usuario P"})
    old = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.post("/api/v1/auth/forgot-password", json={"email": "p@x.com"}).status_code == 200
    # Respuesta idéntica para correos inexistentes.
    assert client.post("/api/v1/auth/forgot-password", json={"email": "nadie@x.com"}).status_code == 200
    token = _token_from(outbox[-1][2])
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "NuevaClave9"}).status_code == 200
    assert client.get("/api/v1/auth/me", headers=old).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "p@x.com", "password": "Secreta123"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "p@x.com", "password": "NuevaClave9"}).status_code == 200


def test_invitation_flow(client, make_user, invite):
    owner = make_user("owner@x.com", "Acme")
    token = invite(owner, "nuevo@x.com", "member")
    preview = client.get(f"/api/v1/invitations/{token}").json()
    assert preview["organization_name"] == "Acme" and preview["user_exists"] is False
    # Otro correo no puede usar la invitación.
    intruso = make_user("intruso@x.com", None)
    assert intruso.post(f"/api/v1/invitations/{token}/accept").status_code == 403
    nuevo = make_user("nuevo@x.com", None, invitation_token=token)
    assert nuevo.me["organizations"][0]["role"] == "member"
    assert nuevo.me["email_verified"] is True
    # Reutilizar la invitación falla.
    assert nuevo.post(f"/api/v1/invitations/{token}/accept").status_code == 400


def test_user_in_multiple_orgs(make_user, invite, client):
    a = make_user("a@x.com", "Org A")
    b = make_user("b@x.com", "Org B")
    token = invite(a, "b@x.com", "member")
    assert b.post(f"/api/v1/invitations/{token}/accept").status_code == 200
    orgs = b.get("/api/v1/orgs").json()
    assert {o["name"] for o in orgs} == {"Org A", "Org B"}


def test_sessions_listing_and_revocation(make_user, client):
    u = make_user("s@x.com", "Org")
    sessions = u.get("/api/v1/auth/sessions").json()
    assert len(sessions) == 1 and sessions[0]["current"]
    assert u.delete(f"/api/v1/auth/sessions/{sessions[0]['id']}").status_code == 200
    assert u.get("/api/v1/auth/me").status_code == 401
