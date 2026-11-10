from conftest import PASSWORD, csrf, login


def test_login_and_me(client, admin):
    resp = login(client, "ADMIN@test.pl ")  # e-mail bez rozrozniania wielkosci liter i spacji
    assert resp.status_code == 200
    assert resp.get_json()["user"]["role"] == "admin"

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.get_json()["user"]["email"] == "admin@test.pl"


def test_login_wrong_password(client, admin):
    resp = login(client, "admin@test.pl", "zle-haslo-123")
    assert resp.status_code == 401
    assert resp.get_json()["code"] == "invalid_credentials"


def test_login_unknown_email_same_error(client):
    resp = login(client, "nie@ma.pl")
    assert resp.status_code == 401
    assert resp.get_json()["code"] == "invalid_credentials"


def test_requires_login(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/fridges").status_code == 401


def test_user_cannot_use_admin_api(client, user):
    login(client, "user@test.pl")
    resp = client.get("/api/admin/users")
    assert resp.status_code == 403


def test_csrf_required_for_changes(client, user):
    login(client, "user@test.pl")
    assert client.patch("/api/auth/me", json={"display_name": "Jan"}).status_code == 401
    resp = client.patch("/api/auth/me", json={"display_name": "Jan"}, headers=csrf(client))
    assert resp.status_code == 200
    assert resp.get_json()["user"]["display_name"] == "Jan"


def test_new_user_must_change_password(client, admin):
    login(client, "admin@test.pl")
    resp = client.post("/api/admin/users", json={"email": "nowy@test.pl", "password": "startowe-haslo-1"},
                       headers=csrf(client))
    assert resp.status_code == 201
    client.post("/api/auth/logout")

    login(client, "nowy@test.pl", "startowe-haslo-1")
    resp = client.get("/api/fridges")
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "password_change_required"

    resp = client.post("/api/auth/change-password",
                       json={"current_password": "startowe-haslo-1", "new_password": "krotkie"},
                       headers=csrf(client))
    assert resp.get_json()["code"] == "weak_password"

    resp = client.post("/api/auth/change-password",
                       json={"current_password": "startowe-haslo-1", "new_password": "nowe-dlugie-haslo"},
                       headers=csrf(client))
    assert resp.status_code == 200
    assert client.get("/api/fridges").status_code == 200


def test_disabled_user_cannot_login(client, admin, user):
    login(client, "admin@test.pl")
    client.patch(f"/api/admin/users/{user.id}", json={"is_active": False}, headers=csrf(client))
    client.post("/api/auth/logout")
    assert login(client, "user@test.pl").status_code == 403


def test_admin_cannot_block_self(client, admin):
    login(client, "admin@test.pl")
    resp = client.patch(f"/api/admin/users/{admin.id}", json={"is_active": False}, headers=csrf(client))
    assert resp.status_code == 400


def test_session_cookies_survive_browser_restart(client, admin):
    # Ciasteczka z data waznosci - zamkniecie przegladarki / restart telefonu nie wylogowuje
    resp = login(client, "admin@test.pl")
    cookies = {c.split("=", 1)[0]: c for c in resp.headers.getlist("Set-Cookie")}
    for name in ("access_token_cookie", "refresh_token_cookie", "csrf_refresh_token"):
        assert "Expires=" in cookies[name] or "Max-Age=" in cookies[name], name
