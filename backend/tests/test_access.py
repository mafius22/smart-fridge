from conftest import csrf, login

from app.extensions import db
from app.models import Folder, Fridge
from app.services.user_service import create_user


def _fridges(app):
    a, b = Fridge(name="Nabiał"), Fridge(name="Mięso")
    db.session.add_all([a, b])
    db.session.commit()
    return a, b


def test_user_sees_only_granted_fridges(app, client, admin, user):
    a, b = _fridges(app)

    login(client, "user@test.pl")
    assert client.get("/api/fridges").get_json()["fridges"] == []
    assert client.get(f"/api/fridges/{a.id}").status_code == 404
    client.post("/api/auth/logout")

    login(client, "admin@test.pl")
    resp = client.put(f"/api/admin/users/{user.id}/fridges", json={"fridge_ids": [a.id]}, headers=csrf(client))
    assert resp.status_code == 200
    assert len(client.get("/api/fridges").get_json()["fridges"]) == 2  # admin widzi wszystko
    client.post("/api/auth/logout")

    login(client, "user@test.pl")
    names = [f["name"] for f in client.get("/api/fridges").get_json()["fridges"]]
    assert names == ["Nabiał"]
    assert client.get(f"/api/fridges/{b.id}").status_code == 404
    assert client.get(f"/api/fridges/{b.id}/measurements").status_code == 404


def test_prefs_alias_and_folder(app, client, admin, user):
    a, _ = _fridges(app)
    other = create_user("inny@test.pl", "haslo-testowe-123", must_change_password=False)
    foreign_folder = Folder(user_id=other.id, name="Cudzy")
    db.session.add(foreign_folder)
    db.session.commit()

    login(client, "admin@test.pl")
    client.put(f"/api/admin/users/{user.id}/fridges", json={"fridge_ids": [a.id]}, headers=csrf(client))
    client.post("/api/auth/logout")

    login(client, "user@test.pl")
    folder = client.post("/api/folders", json={"name": "Sklep 1"}, headers=csrf(client)).get_json()["folder"]

    resp = client.patch(f"/api/fridges/{a.id}/prefs", json={"folder_id": foreign_folder.id}, headers=csrf(client))
    assert resp.status_code == 404

    resp = client.patch(
        f"/api/fridges/{a.id}/prefs",
        json={"custom_name": "Moja lodówka", "folder_id": folder["id"], "min_temp": 2, "max_temp": 8},
        headers=csrf(client),
    )
    assert resp.status_code == 200
    data = resp.get_json()["fridge"]
    assert data["display_name"] == "Moja lodówka"
    assert data["folder_id"] == folder["id"]
    assert data["settings"]["max_temp"] == 8

    resp = client.patch(f"/api/fridges/{a.id}/prefs", json={"min_temp": 9}, headers=csrf(client))
    assert resp.status_code == 400  # min >= max

    client.delete(f"/api/folders/{folder['id']}", headers=csrf(client))
    assert client.get(f"/api/fridges/{a.id}").get_json()["fridge"]["folder_id"] is None
    client.post("/api/auth/logout")

    # Admin widzi oryginalna nazwe - alias jest prywatny
    login(client, "admin@test.pl")
    assert client.get(f"/api/fridges/{a.id}").get_json()["fridge"]["display_name"] == "Nabiał"


def test_revoking_access(app, client, admin, user):
    a, _ = _fridges(app)
    login(client, "admin@test.pl")
    client.put(f"/api/admin/users/{user.id}/fridges", json={"fridge_ids": [a.id]}, headers=csrf(client))
    client.put(f"/api/admin/users/{user.id}/fridges", json={"fridge_ids": []}, headers=csrf(client))
    client.post("/api/auth/logout")

    login(client, "user@test.pl")
    assert client.get(f"/api/fridges/{a.id}").status_code == 404
