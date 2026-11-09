import pytest

from app import create_app
from app.extensions import db as _db
from app.models.user import ROLE_ADMIN
from app.services.user_service import create_user

PASSWORD = "haslo-testowe-123"


@pytest.fixture
def app():
    app = create_app("testing")
    with app.app_context():
        _db.create_all()
        yield app
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def admin(app):
    return create_user("admin@test.pl", PASSWORD, role=ROLE_ADMIN, must_change_password=False)


@pytest.fixture
def user(app):
    return create_user("user@test.pl", PASSWORD, must_change_password=False)


@pytest.fixture
def pushes(monkeypatch):
    """Zbiera powiadomienia zamiast je wysylac."""
    from app.services import push_service
    sent = []
    monkeypatch.setattr(push_service, "queue", lambda user_id, title, body, url="/", tag=None: sent.append(
        {"user_id": user_id, "title": title, "body": body, "tag": tag}
    ))
    return sent


def login(client, email, password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def csrf(client):
    """Naglowek CSRF wymagany przy POST/PATCH/PUT/DELETE (wartosc z ciasteczka, jak we frontendzie)."""
    cookie = client.get_cookie("csrf_access_token")
    return {"X-CSRF-TOKEN": cookie.value} if cookie else {}
