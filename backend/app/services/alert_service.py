"""
Alarmy: tabela alerts jako maszyna stanow. Push tylko przy otwarciu i zamknieciu alarmu.
- high/low: osobno dla kazdego uzytkownika (wlasne progi i opoznienie), tylko dla swiezych pomiarow
- sensor_error / sensor_missing / offline: wspolne dla lodowki, od razu, do wszystkich z dostepem i notify_fault
Funkcje nie commituja - wywolujacy robi commit, potem push_service.send_pending().
"""
import logging

from flask import current_app

from app.extensions import db
from app.models import Alert, Board, Fridge, Measurement, Sensor, SensorAssignment, User, UserFridge
from app.models.alert import (
    END_NORMAL, END_OUTAGE, END_PREFS, FAULT_KINDS, KIND_HIGH, KIND_LOW, KIND_OFFLINE,
    KIND_SENSOR_ERROR, KIND_SENSOR_MISSING,
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


def close_alerts(now, reason, fridge_id=None, user_id=None, kinds=None):
    """
    Bez push: zamyka aktywne alarmy, ktore stracily sens (zmiana ustawien, dostepu, przypisania czujnika,
    wylaczenie lodowki/plytki, blokada konta). Powod zostaje w historii.
    """
    query = Alert.query.filter(Alert.ended_at.is_(None))
    if fridge_id is not None:
        query = query.filter(Alert.fridge_id == fridge_id)
    if user_id is not None:
        query = query.filter(Alert.user_id == user_id)
    if kinds is not None:
        query = query.filter(Alert.kind.in_(kinds))
    for alert in query.all():
        alert.ended_at = now
        alert.end_reason = reason


# ---------- Alarmy temperatury (per uzytkownik) ----------

def evaluate_temperature(fridge_id, temp, ts, now):
    """Wywolywac dla pomiaru swiezego i najnowszego dla czujnika (ingest pilnuje obu warunkow)."""
    if now - ts > current_app.config["ALERT_FRESH_S"]:
        return
    fridge = db.session.get(Fridge, fridge_id)
    if fridge is None or not fridge.is_active:
        return
    rows = (
        db.session.query(UserFridge, User)
        .join(User, User.id == UserFridge.user_id)
        .filter(UserFridge.fridge_id == fridge_id, User.is_active.is_(True))
        .all()
    )
    for prefs, user in rows:
        evaluate_for_user(fridge, prefs, user, temp, ts, now)


def evaluate_for_user(fridge, prefs, user, temp, ts, now):
    hysteresis = current_app.config["ALERT_HYSTERESIS"]
    delay_s = (prefs.alert_delay_min or 0) * 60
    _evaluate_one(
        fridge, prefs, user, KIND_HIGH, temp, ts, now, delay_s,
        enabled=prefs.notify_high and prefs.max_temp is not None,
        threshold=prefs.max_temp,
        breach=prefs.max_temp is not None and temp > prefs.max_temp,
        back_to_normal=prefs.max_temp is None or temp <= prefs.max_temp - hysteresis,
    )
    _evaluate_one(
        fridge, prefs, user, KIND_LOW, temp, ts, now, delay_s,
        enabled=prefs.notify_low and prefs.min_temp is not None,
        threshold=prefs.min_temp,
        breach=prefs.min_temp is not None and temp < prefs.min_temp,
        back_to_normal=prefs.min_temp is None or temp >= prefs.min_temp + hysteresis,
    )


def _evaluate_one(fridge, prefs, user, kind, temp, ts, now, delay_s, enabled, threshold, breach, back_to_normal):
    """
    Stany: brak -> przekroczenie (notified_at NULL, bez push) -> alarm (push) -> norma (push "OK").
    Powrot do normy przed uplywem opoznienia zamyka alarm bez zadnego powiadomienia (np. odszranianie).
    Czasy alarmu = ts pomiarow, wiec opoznienie liczy sie wg czasu pomiaru.
    """
    active = _active(fridge.id, kind, user.id)
    if active is None:
        if not (enabled and breach):
            return
        active = Alert(fridge_id=fridge.id, user_id=user.id, kind=kind, value=temp, threshold=threshold, started_at=ts)
        db.session.add(active)
        logger.info(f"Przekroczenie {kind}: strefa {fridge.id}, user {user.id}, {temp} °C")
    elif not enabled:
        active.ended_at = ts
        active.end_reason = END_PREFS
        return
    elif back_to_normal:
        active.ended_at = ts
        active.end_reason = END_NORMAL
        if active.notified_at is not None:
            _notify(user, fridge, prefs, "OK", f"Temperatura wróciła do normy ({temp:.1f} °C)", kind)
        return

    # Histereza: temperatura miedzy progiem a progiem -/+ 0.5 nie zeruje licznika, ale tez nie powiadamia
    if active.notified_at is None and breach and ts - active.started_at >= delay_s:
        active.notified_at = now
        active.threshold = threshold
        direction = "powyżej" if kind == KIND_HIGH else "poniżej"
        body = f"{temp:.1f} °C - {direction} Twojego progu {threshold} °C"
        if delay_s:
            body += f" od {_fmt_duration(ts - active.started_at)}"
        _notify(user, fridge, prefs, "ALARM", body, kind)
        logger.info(f"ALARM {kind}: strefa {fridge.id}, user {user.id}, {temp} °C")


def evaluate_user_now(prefs, user, now):
    """Po zmianie ustawien: ocena ostatniego swiezego pomiaru bez czekania na kolejny cykl plytki."""
    fridge = db.session.get(Fridge, prefs.fridge_id)
    if fridge is None or not fridge.is_active or not user.is_active:
        return
    sensor = (
        db.session.query(Sensor)
        .join(SensorAssignment, SensorAssignment.sensor_id == Sensor.id)
        .filter(SensorAssignment.fridge_id == fridge.id, SensorAssignment.valid_to.is_(None))
        .first()
    )
    if sensor is None or sensor.last_ts is None or now - sensor.last_ts > current_app.config["ALERT_FRESH_S"]:
        return
    evaluate_for_user(fridge, prefs, user, sensor.last_temp, sensor.last_ts, now)


def reconcile_prefs(prefs, now):
    """Po zmianie ustawien: zamyka bez push alarmy, ktorych uzytkownik juz nie chce."""
    if not prefs.notify_high or prefs.max_temp is None:
        close_alerts(now, END_PREFS, fridge_id=prefs.fridge_id, user_id=prefs.user_id, kinds=(KIND_HIGH,))
    if not prefs.notify_low or prefs.min_temp is None:
        close_alerts(now, END_PREFS, fridge_id=prefs.fridge_id, user_id=prefs.user_id, kinds=(KIND_LOW,))


# ---------- Awarie (wspolne dla lodowki, bez opoznienia) ----------

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
        result.append((user, prefs))
    return result


def open_fault(fridge_id, kind, now, detail=None, started_at=None):
    """started_at: kiedy awaria faktycznie sie zaczela (offline = ostatnia wiadomosc plytki), domyslnie teraz."""
    if _active(fridge_id, kind) is not None:
        return False
    fridge = db.session.get(Fridge, fridge_id)
    # Wylaczona lodowka nie jest monitorowana
    if fridge is None or not fridge.is_active:
        return False
    db.session.add(Alert(fridge_id=fridge_id, user_id=None, kind=kind, started_at=started_at or now, notified_at=now))
    body = FAULT_TEXT[kind][0] + (f" ({detail})" if detail else "")
    for user, prefs in _fault_recipients(fridge):
        _notify(user, fridge, prefs, "AWARIA", body, kind)
    logger.warning(f"AWARIA {kind}: strefa {fridge_id} {detail or ''}")
    return True


def close_fault(fridge_id, kind, now):
    """Awaria minela - push "OK" do tych samych odbiorcow."""
    active = _active(fridge_id, kind)
    if active is None:
        return False
    active.ended_at = now
    active.end_reason = END_NORMAL
    fridge = db.session.get(Fridge, fridge_id)
    if fridge is not None:
        body = f"{FAULT_TEXT[kind][1]} (przerwa {_fmt_duration(now - active.started_at)})"
        for user, prefs in _fault_recipients(fridge):
            _notify(user, fridge, prefs, "OK", body, kind)
    logger.info(f"Koniec awarii {kind}: strefa {fridge_id}")
    return True


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
    """Zadanie cykliczne: aktywna plytka bez wiadomosci dluzej niz OFFLINE_FACTOR x interval_s."""
    factor = current_app.config["OFFLINE_FACTOR"]
    default_interval = current_app.config["DEFAULT_INTERVAL_S"]
    boards = Board.query.filter(Board.last_seen_at.isnot(None), Board.is_active.is_(True)).all()
    for board in boards:
        silent = now - board.last_seen_at
        if silent <= factor * (board.interval_s or default_interval):
            continue
        for fridge_id in fridges_of_board(board.id):
            # Poczatek = ostatnia wiadomosc plytki, nie chwila wykrycia (np. po restarcie backendu lub wlaczeniu plytki)
            open_fault(fridge_id, KIND_OFFLINE, now, detail=f"od {_fmt_duration(silent)}", started_at=board.last_seen_at)


# ---------- Podsumowanie przerwy w lacznosci ----------

def send_outage_summaries(now):
    """
    Zadanie cykliczne: kilka minut po powrocie plytki (caly bufor juz doszedl) sprawdza pomiary z czasu przerwy.
    Przekroczenia progow z bufora nie wywoluja alarmow na biezaco - tu kazdy uzytkownik dostaje jedno podsumowanie.
    """
    ready = now - current_app.config["OUTAGE_SUMMARY_DELAY_S"]
    outages = Alert.query.filter(
        Alert.kind == KIND_OFFLINE, Alert.ended_at.isnot(None), Alert.ended_at <= ready, Alert.summary_at.is_(None),
    ).all()
    for outage in outages:
        outage.summary_at = now
        # Zamkniecie administracyjne (odpiecie czujnika, wylaczenie) - plytka nie wrocila, nie ma czego sprawdzac
        if outage.end_reason == END_NORMAL:
            _summarize_outage(outage, now)


def _summarize_outage(outage, now):
    fridge = db.session.get(Fridge, outage.fridge_id)
    if fridge is None or not fridge.is_active:
        return
    # Pomiary wykonane w czasie przerwy, odebrane po powrocie plytki (bufor)
    readings = (
        db.session.query(Measurement.ts, Measurement.temperature)
        .filter(
            Measurement.fridge_id == fridge.id,
            Measurement.received_at >= outage.ended_at,
            Measurement.ts < outage.ended_at,
        )
        .all()
    )
    if not readings:
        return
    rows = (
        db.session.query(UserFridge, User)
        .join(User, User.id == UserFridge.user_id)
        .filter(UserFridge.fridge_id == fridge.id, User.is_active.is_(True))
        .all()
    )
    for prefs, user in rows:
        checks = (
            (KIND_HIGH, prefs.notify_high, prefs.max_temp, lambda t: t > prefs.max_temp, max, "powyżej"),
            (KIND_LOW, prefs.notify_low, prefs.min_temp, lambda t: t < prefs.min_temp, min, "poniżej"),
        )
        for kind, enabled, threshold, is_breach, worst_of, direction in checks:
            if not enabled or threshold is None:
                continue
            breaches = [(ts, t) for ts, t in readings if is_breach(t)]
            # Trwajacy alarm na biezaco - uzytkownik juz wie, podsumowanie byloby powtorzeniem
            if not breaches or _active(fridge.id, kind, user.id) is not None:
                continue
            worst = worst_of(t for _, t in breaches)
            db.session.add(Alert(
                fridge_id=fridge.id, user_id=user.id, kind=kind, value=worst, threshold=threshold,
                started_at=min(ts for ts, _ in breaches), ended_at=max(ts for ts, _ in breaches),
                notified_at=now, end_reason=END_OUTAGE,
            ))
            body = (
                f"W czasie przerwy w łączności temperatura była {direction} Twojego progu {threshold} °C "
                f"({'max' if kind == KIND_HIGH else 'min'} {worst:.1f} °C, {len(breaches)} z {len(readings)} pomiarów)"
            )
            _notify(user, fridge, prefs, "W CZASIE PRZERWY", body, kind)
            logger.info(f"Podsumowanie przerwy {kind}: strefa {fridge.id}, user {user.id}, {worst} °C")


# ---------- Dla API ----------

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
        "threshold": alert.threshold,
        "started_at": alert.started_at,
        "notified_at": alert.notified_at,
        "ended_at": alert.ended_at,
        "end_reason": alert.end_reason,
        # Przekroczenie krotsze (na razie) niz opoznienie uzytkownika - bez powiadomienia
        "pending": alert.ended_at is None and alert.notified_at is None,
    }
