import pytest

from app.extensions import db
from app.models import Alert, Board, Fridge, Measurement, Sensor, SensorAssignment, UserFridge
from app.services import alert_service
from app.services.ingest_service import ingest_data, ingest_status
from app.utils import now_ts

BOARD = "sf-a4f00f8fdf38"
SID = "2860107000000009"


def _data(*readings):
    return {"readings": [{"sid": SID, "ts": ts, "temp": temp} for ts, temp in readings]}


@pytest.fixture
def fridge(app, user):
    """Lodowka z przypietym czujnikiem (od 2 h) i uzytkownikiem z progiem max 8 °C."""
    now = now_ts()
    ingest_data(BOARD, _data((now - 7300, 4.0)))
    fridge = Fridge(name="Nabiał")
    db.session.add(fridge)
    db.session.flush()
    db.session.add(SensorAssignment(sensor_id=SID, fridge_id=fridge.id, valid_from=now - 7200))
    db.session.add(UserFridge(user_id=user.id, fridge_id=fridge.id, max_temp=8.0, min_temp=2.0))
    db.session.commit()
    return fridge


def test_duplicates_and_sensor_error(app):
    now = now_ts()
    first = ingest_data(BOARD, _data((now - 60, 4.5), (now, -127.0), (0, 5.0)))
    db.session.commit()
    assert len(first.inserted) == 2          # 4.5 i pomiar bez czasu (czas serwera)
    assert first.sensor_errors == [(SID, now)]

    second = ingest_data(BOARD, _data((now - 60, 4.5)))
    db.session.commit()
    assert second.inserted == []              # duplikat paczki z bufora
    assert Measurement.query.count() == 2
    assert Measurement.query.filter_by(temperature=-127.0).count() == 0
    assert db.session.get(Board, BOARD) is not None


def test_backlog_goes_to_fridge_by_measurement_time(app, fridge):
    now = now_ts()
    ingest_data(BOARD, _data((now - 7250, 3.0), (now - 3600, 3.5)))
    db.session.commit()
    before = Measurement.query.filter_by(ts=now - 7250).one()
    after = Measurement.query.filter_by(ts=now - 3600).one()
    assert before.fridge_id is None           # sprzed przypisania
    assert after.fridge_id == fridge.id


def test_high_alarm_once_with_hysteresis(app, fridge, user, pushes):
    now = now_ts()
    ingest_data(BOARD, _data((now - 600, 9.0)))
    ingest_data(BOARD, _data((now - 300, 9.5)))
    db.session.commit()
    assert Alert.query.filter_by(kind="high", ended_at=None, user_id=user.id).count() == 1
    assert [p["title"].split(":")[0] for p in pushes] == ["ALARM"]

    ingest_data(BOARD, _data((now - 200, 7.8)))  # ponizej progu, ale w histerezie 0.5
    db.session.commit()
    assert Alert.query.filter_by(kind="high", ended_at=None).count() == 1

    ingest_data(BOARD, _data((now - 100, 7.4)))
    db.session.commit()
    assert Alert.query.filter_by(kind="high", ended_at=None).count() == 0
    assert [p["title"].split(":")[0] for p in pushes] == ["ALARM", "OK"]


def test_old_or_out_of_order_readings_do_not_alarm(app, fridge, pushes):
    now = now_ts()
    ingest_data(BOARD, _data((now - 3600, 20.0)))  # stary pomiar z bufora
    db.session.commit()
    assert Alert.query.count() == 0

    ingest_data(BOARD, _data((now - 60, 5.0)))
    ingest_data(BOARD, _data((now - 120, 20.0)))   # swiezy, ale starszy niz ostatni
    db.session.commit()
    assert Alert.query.count() == 0
    assert db.session.get(Sensor, SID).last_temp == 5.0
    assert pushes == []


def test_low_alarm_and_disabling_closes_silently(app, fridge, user, pushes):
    now = now_ts()
    ingest_data(BOARD, _data((now - 60, 1.0)))
    db.session.commit()
    assert Alert.query.filter_by(kind="low", ended_at=None).count() == 1

    prefs = db.session.get(UserFridge, (user.id, fridge.id))
    prefs.notify_low = False
    alert_service.reconcile_prefs(prefs, now)
    db.session.commit()
    assert Alert.query.filter_by(kind="low", ended_at=None).count() == 0
    assert len(pushes) == 1


def test_sensor_error_fault(app, fridge, admin, user, pushes):
    now = now_ts()
    ingest_data(BOARD, _data((now - 30, -127.0)))
    db.session.commit()
    assert Alert.query.filter_by(kind="sensor_error", ended_at=None, user_id=None).count() == 1
    assert {p["user_id"] for p in pushes} == {admin.id, user.id}

    ingest_data(BOARD, _data((now, 4.0)))
    db.session.commit()
    assert Alert.query.filter_by(kind="sensor_error", ended_at=None).count() == 0


def test_status_sensor_missing_and_retained(app, fridge, pushes):
    now = now_ts()
    old = {"fw": "1.0.0", "ts": now - 7000, "interval_s": 300, "sensors": [], "ota": "none"}
    ingest_status(BOARD, old, retained=True)     # stary status z brokera - bez alarmow
    db.session.commit()
    assert Alert.query.count() == 0

    ingest_status(BOARD, {**old, "ts": now}, retained=False)
    db.session.commit()
    assert Alert.query.filter_by(kind="sensor_missing", ended_at=None).count() == 1
    assert db.session.get(Sensor, SID).present is False

    ingest_status(BOARD, {**old, "ts": now + 1, "sensors": [SID]}, retained=False)
    db.session.commit()
    assert Alert.query.filter_by(kind="sensor_missing", ended_at=None).count() == 0


def test_offline_detection(app, fridge, pushes):
    now = now_ts()
    board = db.session.get(Board, BOARD)
    board.last_seen_at = now - 1000           # > 3 x 300 s
    alert_service.check_offline(now)
    db.session.commit()
    assert Alert.query.filter_by(kind="offline", ended_at=None).count() == 1

    alert_service.check_offline(now + 60)     # bez ponownego alarmu
    db.session.commit()
    assert Alert.query.filter_by(kind="offline").count() == 1

    ingest_data(BOARD, _data((now, 4.0)))
    db.session.commit()
    assert Alert.query.filter_by(kind="offline", ended_at=None).count() == 0


def test_history_buckets(app, fridge, client, user):
    from conftest import login
    now = now_ts()
    ingest_data(BOARD, _data(*[(now - 7000 + i * 300, 4.0 + i * 0.1) for i in range(20)]))
    db.session.commit()

    login(client, "user@test.pl")
    raw = client.get(f"/api/fridges/{fridge.id}/measurements?from={now - 86400}&to={now}").get_json()
    assert raw["bucket_s"] == 0
    assert len(raw["points"]) == 20

    week = client.get(f"/api/fridges/{fridge.id}/measurements?from={now - 7 * 86400}&to={now}").get_json()
    assert week["bucket_s"] == 900
    assert 0 < len(week["points"]) < 20
