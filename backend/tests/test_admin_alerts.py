"""Zamykanie alarmow przy zmianach admina i uzytkownika, wylaczanie i usuwanie lodowek, czujnikow, plytek."""
import pytest
from conftest import csrf, login

from app.extensions import db
from app.models import Alert, Board, Fridge, Measurement, Sensor, SensorAssignment, UserFridge
from app.services import alert_service
from app.services.ingest_service import ingest_data
from app.utils import now_ts

BOARD = "sf-a4f00f8fdf38"
SID = "2860107000000009"
SID2 = "28aa000000000002"


def _data(sid, *readings):
    return {"readings": [{"sid": sid, "ts": ts, "temp": temp} for ts, temp in readings]}


@pytest.fixture
def fridge(app, user):
    """Lodowka z czujnikiem SID, uzytkownik z progiem max 8 °C i otwartym alarmem high oraz awaria offline."""
    now = now_ts()
    ingest_data(BOARD, _data(SID, (now - 7300, 4.0)))
    ingest_data(BOARD, _data(SID2, (now - 7300, 4.0)))
    fridge = Fridge(name="Nabiał")
    db.session.add(fridge)
    db.session.flush()
    db.session.add(SensorAssignment(sensor_id=SID, fridge_id=fridge.id, valid_from=now - 7200))
    db.session.add(UserFridge(user_id=user.id, fridge_id=fridge.id, max_temp=8.0))
    db.session.commit()
    ingest_data(BOARD, _data(SID, (now - 60, 9.0)))
    db.session.add(Alert(fridge_id=fridge.id, kind="offline", started_at=now - 30, notified_at=now - 30))
    db.session.commit()
    return fridge


def _active(**filters):
    return Alert.query.filter_by(ended_at=None, **filters).count()


def _as_admin(client):
    login(client, "admin@test.pl")
    return csrf(client)


def test_moving_sensor_closes_old_fridge_alerts(app, client, admin, fridge, pushes):
    assert _active(kind="high") == 1 and _active(kind="offline") == 1
    other = Fridge(name="Mięso")
    db.session.add(other)
    db.session.commit()

    headers = _as_admin(client)
    pushes.clear()
    resp = client.post(f"/api/admin/fridges/{other.id}/assign", json={"sensor_id": SID}, headers=headers)
    assert resp.status_code == 200
    assert _active(fridge_id=fridge.id) == 0
    assert {a.end_reason for a in Alert.query.filter_by(fridge_id=fridge.id)} == {"sensor_changed"}
    assert pushes == []


def test_unassign_closes_temperature_alerts(app, client, admin, fridge):
    headers = _as_admin(client)
    assert client.post(f"/api/admin/fridges/{fridge.id}/unassign", headers=headers).status_code == 200
    assert _active(fridge_id=fridge.id) == 0


def test_disabling_fridge_closes_alerts_and_blocks_faults(app, client, admin, fridge, pushes):
    headers = _as_admin(client)
    client.patch(f"/api/admin/fridges/{fridge.id}", json={"is_active": False}, headers=headers)
    assert _active(fridge_id=fridge.id) == 0

    pushes.clear()
    board = db.session.get(Board, BOARD)
    board.last_seen_at = now_ts() - 5000
    alert_service.check_offline(now_ts())
    db.session.commit()
    assert _active(fridge_id=fridge.id) == 0
    assert pushes == []


def test_blocking_user_closes_his_alerts(app, client, admin, user, fridge):
    headers = _as_admin(client)
    client.patch(f"/api/admin/users/{user.id}", json={"is_active": False}, headers=headers)
    assert _active(user_id=user.id) == 0
    assert _active(kind="offline") == 1   # awaria lodowki dotyczy innych


def test_demoted_admin_has_no_leftover_access(app, client, admin, fridge):
    from app.models.user import ROLE_ADMIN
    from app.services.user_service import create_user
    other_admin = create_user("admin2@test.pl", "haslo-testowe-123", role=ROLE_ADMIN, must_change_password=False)
    db.session.add(UserFridge(user_id=other_admin.id, fridge_id=fridge.id, max_temp=5.0))
    db.session.commit()

    headers = _as_admin(client)
    resp = client.patch(f"/api/admin/users/{other_admin.id}", json={"role": "user"}, headers=headers)
    assert resp.get_json()["user"]["fridge_ids"] == []
    assert UserFridge.query.filter_by(user_id=other_admin.id).count() == 0


def test_prefs_change_evaluates_immediately(app, client, user, fridge, pushes):
    alert_service.close_alerts(now_ts(), "normal", kinds=("offline",))  # offline ma pierwszenstwo w stanie
    db.session.commit()
    login(client, "user@test.pl")
    headers = csrf(client)
    # Podniesienie progu ponad biezaca temperature zamyka alarm od razu
    resp = client.patch(f"/api/fridges/{fridge.id}/prefs", json={"max_temp": 10}, headers=headers)
    assert resp.status_code == 200
    assert _active(kind="high") == 0
    assert pushes[-1]["title"].startswith("OK")

    # Opoznienie: obnizony prog daje przekroczenie bez push i stan "pending"
    resp = client.patch(
        f"/api/fridges/{fridge.id}/prefs", json={"max_temp": 8, "alert_delay_min": 30}, headers=headers,
    )
    data = resp.get_json()["fridge"]
    assert data["state"] == "pending"
    assert data["settings"]["alert_delay_min"] == 30
    assert pushes[-1]["title"].startswith("OK")

    resp = client.patch(f"/api/fridges/{fridge.id}/prefs", json={"alert_delay_min": 999}, headers=headers)
    assert resp.status_code == 400


def test_delete_fridge_with_history_requires_confirmation(app, client, admin, user, fridge):
    headers = _as_admin(client)
    resp = client.delete(f"/api/admin/fridges/{fridge.id}", headers=headers)
    assert resp.status_code == 409 and resp.get_json()["code"] == "has_history"

    resp = client.delete(f"/api/admin/fridges/{fridge.id}?force=1", json={"confirm_name": "zła"}, headers=headers)
    assert resp.status_code == 400

    resp = client.delete(f"/api/admin/fridges/{fridge.id}?force=1", json={"confirm_name": "Nabiał"}, headers=headers)
    assert resp.status_code == 200
    assert db.session.get(Fridge, fridge.id) is None
    assert Measurement.query.filter_by(fridge_id=fridge.id).count() == 0
    assert UserFridge.query.count() == 0 and Alert.query.count() == 0
    assert db.session.get(Sensor, SID) is not None   # czujnik zostaje, wolny do przypiecia


def test_delete_sensor_and_board(app, client, admin, fridge):
    headers = _as_admin(client)
    assert client.delete(f"/api/admin/sensors/{SID}", headers=headers).status_code == 409   # przypiety
    assert client.delete(f"/api/admin/boards/{BOARD}", headers=headers).status_code == 409

    assert client.delete(f"/api/admin/sensors/{SID2}", headers=headers).status_code == 200
    assert db.session.get(Sensor, SID2) is None

    client.post(f"/api/admin/fridges/{fridge.id}/unassign", headers=headers)
    # Pomiary SID sa w historii lodowki - usuniecie dopiero po usunieciu lodowki
    resp = client.delete(f"/api/admin/boards/{BOARD}", headers=headers)
    assert resp.status_code == 409 and resp.get_json()["code"] == "has_history"

    client.delete(f"/api/admin/fridges/{fridge.id}?force=1", json={"confirm_name": "Nabiał"}, headers=headers)
    assert client.delete(f"/api/admin/boards/{BOARD}", headers=headers).status_code == 200
    assert db.session.get(Board, BOARD) is None and Measurement.query.count() == 0


def test_disable_board_closes_alerts(app, client, admin, fridge):
    headers = _as_admin(client)
    resp = client.patch(f"/api/admin/boards/{BOARD}", json={"is_active": False}, headers=headers)
    assert resp.get_json()["board"]["is_active"] is False
    assert _active(fridge_id=fridge.id) == 0


def test_short_excursions_hidden_unless_enabled(app, client, user, fridge):
    now = now_ts()
    db.session.add(Alert(
        fridge_id=fridge.id, user_id=user.id, kind="low", value=1.5, threshold=2.0,
        started_at=now - 3000, ended_at=now - 2900, end_reason="normal",
    ))
    db.session.commit()
    login(client, "user@test.pl")
    headers = csrf(client)

    def kinds():
        return sorted(a["kind"] for a in client.get(f"/api/fridges/{fridge.id}/alerts").get_json()["alerts"])

    # Domyslnie: trwajace (high, offline) widoczne, krotkie przekroczenie bez push ukryte
    assert kinds() == ["high", "offline"]
    resp = client.patch("/api/auth/me", json={"show_short_alerts": True}, headers=headers)
    assert resp.get_json()["user"]["show_short_alerts"] is True
    assert kinds() == ["high", "low", "offline"]
