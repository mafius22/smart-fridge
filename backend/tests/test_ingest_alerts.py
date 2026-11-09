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
    ingest_data(BOARD, _data((now - 700, -127.0)))
    db.session.commit()
    assert Alert.query.filter_by(kind="sensor_error", ended_at=None, user_id=None).count() == 1
    assert {p["user_id"] for p in pushes} == {admin.id, user.id}

    # Awaria otwiera sie od razu, ale zamyka dopiero po 10 min poprawnych odczytow
    ingest_data(BOARD, _data((now - 300, 4.0)))
    db.session.commit()
    assert Alert.query.filter_by(kind="sensor_error", ended_at=None).count() == 1
    # Interfejs pokazuje, kiedy awaria sie zamknie (czujnik znow odpowiada)
    from app.services.fridge_service import fridge_summaries
    [summary] = fridge_summaries(user, [fridge])
    [fault] = [a for a in summary["alerts"] if a["kind"] == "sensor_error"]
    assert fault["recovers_at"] == now - 700 + app.config["SENSOR_RECOVERY_S"]

    ingest_data(BOARD, _data((now, 4.0)))
    db.session.commit()
    assert Alert.query.filter_by(kind="sensor_error", ended_at=None).count() == 0
    assert [p["title"].split(":")[0] for p in pushes] == ["AWARIA", "AWARIA", "OK", "OK"]


def test_flapping_sensor_gives_one_fault(app, fridge, admin, pushes):
    now = now_ts()
    for i, temp in enumerate([-127.0, 4.0, -127.0, 4.0, -127.0]):
        ingest_data(BOARD, _data((now - 600 + i * 120, temp)))
        db.session.commit()
    assert Alert.query.filter_by(kind="sensor_error").count() == 1
    assert [p["title"].split(":")[0] for p in pushes if p["user_id"] == admin.id] == ["AWARIA"]


def test_delay_short_excursion_is_silent(app, fridge, user, pushes):
    now = now_ts()
    prefs = db.session.get(UserFridge, (user.id, fridge.id))
    prefs.alert_delay_min = 20
    db.session.commit()

    ingest_data(BOARD, _data((now - 880, 9.0)))     # poczatek przekroczenia (odszranianie)
    ingest_data(BOARD, _data((now - 600, 9.5)))     # 5 min < 20 min
    db.session.commit()
    alert = Alert.query.filter_by(kind="high", ended_at=None).one()
    assert alert.notified_at is None
    assert pushes == []

    ingest_data(BOARD, _data((now - 300, 7.0)))     # powrot przed uplywem opoznienia
    db.session.commit()
    assert Alert.query.filter_by(kind="high", ended_at=None).count() == 0
    assert pushes == []


def test_delay_long_excursion_notifies(app, fridge, user, pushes):
    now = now_ts()
    prefs = db.session.get(UserFridge, (user.id, fridge.id))
    prefs.alert_delay_min = 10
    db.session.commit()

    ingest_data(BOARD, _data((now - 840, 9.0)))
    ingest_data(BOARD, _data((now - 540, 7.8)))     # w histerezie - licznik dalej biegnie, bez push
    ingest_data(BOARD, _data((now - 240, 9.2)))     # 10 min od poczatku
    db.session.commit()
    assert [p["title"].split(":")[0] for p in pushes] == ["ALARM"]
    assert "od 10 min" in pushes[0]["body"]
    alert = Alert.query.filter_by(kind="high", ended_at=None).one()
    assert alert.notified_at is not None and alert.threshold == 8.0

    ingest_data(BOARD, _data((now - 60, 7.0)))
    db.session.commit()
    assert [p["title"].split(":")[0] for p in pushes] == ["ALARM", "OK"]


def test_inactive_board_is_ignored(app, fridge, pushes):
    now = now_ts()
    board = db.session.get(Board, BOARD)
    board.is_active = False
    db.session.commit()

    ingest_data(BOARD, _data((now - 60, 20.0)))
    db.session.commit()
    assert Measurement.query.filter_by(ts=now - 60).count() == 0
    assert board.last_seen_at >= now               # wiadomo, ze nadal nadaje

    board.last_seen_at = now - 5000
    alert_service.check_offline(now)
    db.session.commit()
    assert Alert.query.count() == 0
    assert pushes == []


def test_outage_summary(app, fridge, user, pushes):
    now = now_ts()
    board = db.session.get(Board, BOARD)
    board.last_seen_at = now - 7000
    alert_service.check_offline(now - 3000)        # awaria offline w trakcie przerwy
    db.session.commit()

    # Powrot plytki: biezacy pomiar + bufor z czasu przerwy (pik 9.5 °C, juz minal)
    ingest_data(BOARD, _data((now - 600, 4.0)))
    ingest_data(BOARD, _data((now - 5000, 5.0), (now - 4000, 9.5), (now - 3500, 8.5), (now - 2000, 4.5)))
    db.session.commit()
    offline = Alert.query.filter_by(kind="offline").one()
    assert offline.ended_at is not None
    offline.ended_at = now - 600                   # "5 min temu" - caly bufor doszedl

    pushes.clear()
    alert_service.send_outage_summaries(now)
    db.session.commit()
    assert len(pushes) == 1 and pushes[0]["title"].startswith("W CZASIE PRZERWY")
    assert "max 9.5" in pushes[0]["body"]
    summary = Alert.query.filter_by(kind="high", end_reason="outage").one()
    assert summary.ended_at is not None and summary.value == 9.5

    alert_service.send_outage_summaries(now + 60)  # tylko raz
    db.session.commit()
    assert len(pushes) == 1


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
    # Poczatek awarii = ostatnia wiadomosc plytki, nie chwila wykrycia
    assert Alert.query.filter_by(kind="offline", ended_at=None).one().started_at == now - 1000

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
