"""
Alarmy: tabela alerts jako maszyna stanow. Push tylko przy otwarciu i zamknieciu alarmu.
- high/low: osobno dla kazdego uzytkownika (wlasne progi), tylko dla swiezych pomiarow
- sensor_error / sensor_missing / offline: wspolne dla lodowki, do wszystkich z dostepem i notify_fault
Funkcje nie commituja - wywolujacy robi commit, potem push_service.send_pending().
"""
import logging

from flask import current_app

from app.extensions import db
from app.models import Alert, Board, Fridge, Sensor, SensorAssignment, User, UserFridge
from app.models.alert import (
    FAULT_KINDS, KIND_HIGH, KIND_LOW, KIND_OFFLINE, KIND_SENSOR_ERROR, KIND_SENSOR_MISSING,
)
from app.models.user import ROLE_ADMIN
from app.services import push_service

logger = logging.getLogger(__name__)

FAULT_TEXT = {
    KIND_SENSOR_ERROR: ("Czujnik nie odpowiada (odczyt -127)", "Czujnik znów działa"),
    KIND_SENSOR_MISSING: ("Czujnik odłączony od płytki", "Czujnik ponownie podłączony"),
    KIND_OFFLINE: ("Brak danych od płytki", "Płytka znów online"),
}


def _fmt_duration(seconds):
    minutes = max(1, int(seconds) // 60)
    if minutes < 60:
        return f"{minutes} min"
    return f"{minutes // 60} h {minutes % 60} min"


def _display_name(fridge, prefs):
    return (prefs.custom_name if prefs and prefs.custom_name else None) or fridge.name


def _active(fridge_id, kind, user_id=None):
    return Alert.query.filter_by(fridge_id=fridge_id, kind=kind, user_id=user_id, ended_at=None).first()


def _notify(user, fridge, prefs, title_prefix, body, kind):
    if not user.notifications_enabled or not user.is_active:
        return
    push_service.queue(
        user.id,
        title=f"{title_prefix}: {_display_name(fridge, prefs)}",
        body=body,
        url=f"/fridges/{fridge.id}",
        tag=f"{fridge.id}-{kind}",
    )


# ---------- Alarmy temperatury (per uzytkownik) ----------

def evaluate_temperature(fridge_id, temp, ts, now):
    """Wywolywac dla pomiaru swiezego i najnowszego dla czujnika (ingest pilnuje obu warunkow)."""
    if now - ts > current_app.config["ALERT_FRESH_S"]:
        return
    fridge = db.session.get(Fridge, fridge_id)
    if fridge is None or not fridge.is_active:
        return
    hysteresis = current_app.config["ALERT_HYSTERESIS"]

    rows = (
        db.session.query(UserFridge, User)
        .join(User, User.id == UserFridge.user_id)
        .filter(UserFridge.fridge_id == fridge_id, User.is_active.is_(True))
        .all()
    )
    for prefs, user in rows:
        _evaluate_one(
            fridge, prefs, user, KIND_HIGH, temp, now,
            enabled=prefs.notify_high and prefs.max_temp is not None,
            breach=prefs.max_temp is not None and temp > prefs.max_temp,
            back_to_normal=prefs.max_temp is None or temp <= prefs.max_temp - hysteresis,
            body=f"{temp:.1f} °C - powyżej Twojego progu {prefs.max_temp} °C",
        )
        _evaluate_one(
            fridge, prefs, user, KIND_LOW, temp, now,
            enabled=prefs.notify_low and prefs.min_temp is not None,
            breach=prefs.min_temp is not None and temp < prefs.min_temp,
            back_to_normal=prefs.min_temp is None or temp >= prefs.min_temp + hysteresis,
            body=f"{temp:.1f} °C - poniżej Twojego progu {prefs.min_temp} °C",
        )


def _evaluate_one(fridge, prefs, user, kind, temp, now, enabled, breach, back_to_normal, body):
    active = _active(fridge.id, kind, user.id)
    if active is not None:
        if not enabled:
            active.ended_at = now  # wylaczone powiadomienie lub usuniety prog - bez push
        elif back_to_normal:
            active.ended_at = now
            _notify(user, fridge, prefs, "OK", f"Temperatura wróciła do normy ({temp:.1f} °C)", kind)
    elif enabled and breach:
        db.session.add(Alert(fridge_id=fridge.id, user_id=user.id, kind=kind, value=temp, started_at=now))
        _notify(user, fridge, prefs, "ALARM", body, kind)
        logger.info(f"ALARM {kind}: lodówka {fridge.id}, user {user.id}, {temp} °C")


def reconcile_prefs(prefs, now):
    """Po zmianie ustawien: zamyka bez push alarmy, ktorych uzytkownik juz nie chce."""
    if not prefs.notify_high or prefs.max_temp is None:
        close_user_alerts(prefs.user_id, prefs.fridge_id, now, kinds=(KIND_HIGH,))
    if not prefs.notify_low or prefs.min_temp is None:
        close_user_alerts(prefs.user_id, prefs.fridge_id, now, kinds=(KIND_LOW,))


def close_user_alerts(user_id, fridge_id=None, now=None, kinds=(KIND_HIGH, KIND_LOW)):
    """Bez push: odebrany dostep, usuniete konto, zmienione ustawienia."""
    query = Alert.query.filter(Alert.user_id == user_id, Alert.ended_at.is_(None), Alert.kind.in_(kinds))
    if fridge_id is not None:
        query = query.filter(Alert.fridge_id == fridge_id)
    for alert in query.all():
        alert.ended_at = now


# ---------- Awarie (wspolne dla lodowki) ----------

def _fault_recipients(fridge):
    """(user, prefs): uzytkownicy z dostepem i notify_fault + wszyscy admini (o ile nie wylaczyli)."""
    prefs_by_user = {
        p.user_id: p for p in UserFridge.query.filter_by(fridge_id=fridge.id).all()
    }
    users = User.query.filter(User.is_active.is_(True)).filter(
        (User.role == ROLE_ADMIN) | (User.id.in_(list(prefs_by_user)))
    ).all()
    result = []
    for user in users:
        prefs = prefs_by_user.get(user.id)
        if prefs is not None and not prefs.notify_fault:
            continue
        if not user.is_admin and not fridge.is_active:
            continue
        result.append((user, prefs))
    return result


def open_fault(fridge_id, kind, now, detail=None):
    if _active(fridge_id, kind) is not None:
        return False
    fridge = db.session.get(Fridge, fridge_id)
    if fridge is None:
        return False
    db.session.add(Alert(fridge_id=fridge_id, user_id=None, kind=kind, started_at=now))
    body = FAULT_TEXT[kind][0] + (f" ({detail})" if detail else "")
    for user, prefs in _fault_recipients(fridge):
        _notify(user, fridge, prefs, "AWARIA", body, kind)
    logger.warning(f"AWARIA {kind}: lodówka {fridge_id} {detail or ''}")
    return True


def close_fault(fridge_id, kind, now, notify=True):
    active = _active(fridge_id, kind)
    if active is None:
        return False
    active.ended_at = now
    fridge = db.session.get(Fridge, fridge_id) if notify else None
    if fridge is not None:
        body = f"{FAULT_TEXT[kind][1]} (przerwa {_fmt_duration(now - active.started_at)})"
        for user, prefs in _fault_recipients(fridge):
            _notify(user, fridge, prefs, "OK", body, kind)
    logger.info(f"Koniec awarii {kind}: lodówka {fridge_id}")
    return True


def close_fridge_faults(fridge_id, now, kinds=(KIND_SENSOR_ERROR, KIND_SENSOR_MISSING)):
    """Bez push: zmiana przypisania czujnika - stare awarie dotycza innej sondy."""
    for kind in kinds:
        close_fault(fridge_id, kind, now, notify=False)


def active_fridge_of_sensor(sensor_id):
    row = db.session.query(SensorAssignment.fridge_id).filter(
        SensorAssignment.sensor_id == sensor_id, SensorAssignment.valid_to.is_(None)
    ).first()
    return row[0] if row else None


def fridges_of_board(board_id):
    """Lodowki z aktywnie przypisanym czujnikiem tej plytki."""
    rows = (
        db.session.query(SensorAssignment.fridge_id)
        .join(Sensor, Sensor.id == SensorAssignment.sensor_id)
        .filter(Sensor.board_id == board_id, SensorAssignment.valid_to.is_(None))
        .all()
    )
    return [r[0] for r in rows]


def board_seen(board_id, now):
    """Dowolna swieza wiadomosc od plytki zamyka jej awarie offline."""
    for fridge_id in fridges_of_board(board_id):
        close_fault(fridge_id, KIND_OFFLINE, now)


def check_offline(now):
    """Zadanie cykliczne: plytka bez wiadomosci dluzej niz OFFLINE_FACTOR x interval_s."""
    factor = current_app.config["OFFLINE_FACTOR"]
    default_interval = current_app.config["DEFAULT_INTERVAL_S"]
    for board in Board.query.filter(Board.last_seen_at.isnot(None)).all():
        silent = now - board.last_seen_at
        if silent <= factor * (board.interval_s or default_interval):
            continue
        for fridge_id in fridges_of_board(board.id):
            open_fault(fridge_id, KIND_OFFLINE, now, detail=f"od {_fmt_duration(silent)}")


def active_alerts_for(user, fridge_ids):
    """fridge_id -> lista aktywnych alarmow widocznych dla uzytkownika (awarie + jego temperatury)."""
    if not fridge_ids:
        return {}
    rows = Alert.query.filter(
        Alert.fridge_id.in_(fridge_ids),
        Alert.ended_at.is_(None),
        (Alert.user_id.is_(None)) | (Alert.user_id == user.id),
    ).all()
    result = {}
    for alert in rows:
        result.setdefault(alert.fridge_id, []).append(alert)
    return result


def alert_to_dict(alert):
    return {
        "id": alert.id,
        "kind": alert.kind,
        "is_fault": alert.kind in FAULT_KINDS,
        "value": alert.value,
        "started_at": alert.started_at,
        "ended_at": alert.ended_at,
    }
