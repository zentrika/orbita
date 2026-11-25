import os

os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:////tmp/orbita-test.db"
os.environ["REDIS_URL"] = ""
os.environ["SECRET_KEY"] = "test-secret-key-test-secret-key-123456"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def _db():
    # Base de datos SQLite efímera exclusiva de las pruebas.
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from app.core.db import SessionLocal
    from app.services.achievements import ensure_definitions

    with SessionLocal() as db:
        ensure_definitions(db)
        db.commit()
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class Actor:
    def __init__(self, client: TestClient, email: str, token: str):
        self.c = client
        self.email = email
        self.headers = {"Authorization": f"Bearer {token}"}
        self.me = client.get("/api/v1/auth/me", headers=self.headers).json()

    @property
    def org_id(self) -> int:
        return self.me["organizations"][0]["organization_id"]

    def refresh_me(self):
        self.me = self.c.get("/api/v1/auth/me", headers=self.headers).json()
        return self.me

    def get(self, url, **kw):
        return self.c.get(url, headers=self.headers, **kw)

    def post(self, url, **kw):
        return self.c.post(url, headers=self.headers, **kw)

    def patch(self, url, **kw):
        return self.c.patch(url, headers=self.headers, **kw)

    def delete(self, url, **kw):
        return self.c.delete(url, headers=self.headers, **kw)


@pytest.fixture
def make_user(client):
    def _make(email: str, org: str | None = "Org", password: str = "Secreta123", invitation_token: str | None = None):
        payload = {"email": email, "password": password, "full_name": "Usuario " + email.split("@")[0].title()}
        if org:
            payload["organization_name"] = org
        if invitation_token:
            payload["invitation_token"] = invitation_token
        r = client.post("/api/v1/auth/register", json=payload)
        assert r.status_code == 201, r.text
        client.cookies.clear()
        return Actor(client, email, r.json()["access_token"])

    return _make


@pytest.fixture
def invite(client):
    def _invite(admin: Actor, email: str, role: str = "member"):
        r = admin.post(f"/api/v1/orgs/{admin.org_id}/invitations", json={"email": email, "role": role})
        assert r.status_code == 201, r.text
        return r.json()["invite_url"].rsplit("/", 1)[1]

    return _invite


@pytest.fixture
def join(make_user, invite):
    def _join(admin: Actor, email: str, role: str = "member"):
        token = invite(admin, email, role)
        return make_user(email, org=None, invitation_token=token)

    return _join
