from flask import current_app
from sqlalchemy import BigInteger, func, literal_column

from app.extensions import db
from app.models import Board, Measurement, Sensor, SensorAssignment, UserFridge
from app.models.alert import FAULT_KINDS, KIND_OFFLINE, KIND_SENSOR_ERROR
from app.services import alert_service
from app.utils import now_ts

# Rozmiar przedzialu wykresu w zaleznosci od zakresu (punktow ~300-900); 0 = surowe pomiary
BUCKETS = (
    (36 * 3600, 0),
    (8 * 86400, 15 * 60),
    (35 * 86400, 3600),
    (200 * 86400, 6 * 3600),
)
MAX_RANGE_S = 400 * 86400


def board_online(board, now):
    if board is None or board.last_seen_at is None or not board.is_active:
        return False
    cfg = current_app.config
    return now - board.last_seen_at <= cfg["OFFLINE_FACTOR"] * (board.interval_s or cfg["DEFAULT_INTERVAL_S"])


def _active_sensors(fridge_ids):
    """fridge_id -> (Sensor, Board) z aktywnego przypisania."""
    if not fridge_ids:
        return {}
    rows = (
        db.session.query(SensorAssignment.fridge_id, Sensor, Board)
        .join(Sensor, Sensor.id == SensorAssignment.sensor_id)
        .join(Board, Board.id == Sensor.board_id)
        .filter(SensorAssignment.fridge_id.in_(fridge_ids), SensorAssignment.valid_to.is_(None))
        .all()
    )
    return {fridge_id: (sensor, board) for fridge_id, sensor, board in rows}


def prefs_to_dict(prefs):
    return {
        "min_temp": prefs.min_temp if prefs else None,
        "max_temp": prefs.max_temp if prefs else None,
        "notify_low": prefs.notify_low if prefs and prefs.notify_low is not None else True,
        "notify_high": prefs.notify_high if prefs and prefs.notify_high is not None else True,
        "notify_fault": prefs.notify_fault if prefs and prefs.notify_fault is not None else True,
        "alert_delay_min": prefs.alert_delay_min if prefs and prefs.alert_delay_min is not None else 0,
    }


def _state(sensor, board, alerts, online):
    if sensor is None:
        return "no_sensor"
    # Przekroczenie w trakcie opoznienia (bez powiadomienia) to "pending", nie "alarm"
    kinds = {a.kind for a in alerts if a.notified_at is not None}
    if KIND_OFFLINE in kinds or not online:
        return "offline"
    if kinds & set(FAULT_KINDS):
        return "fault"
    if kinds:
        return "alarm"
    if alerts:
        return "pending"
    if sensor.last_ts is None:
        return "no_data"
    return "ok"


def fridge_summaries(user, fridges):
    """Lista lodowek w postaci dla API, z ustawieniami i alarmami widocznymi dla tego uzytkownika."""
    now = now_ts()
    ids = [f.id for f in fridges]
    sensors = _active_sensors(ids)
    alerts = alert_service.active_alerts_for(user, ids)
    prefs_map = {
        p.fridge_id: p
        for p in UserFridge.query.filter(UserFridge.user_id == user.id, UserFridge.fridge_id.in_(ids)).all()
    } if ids else {}

    result = []
    for fridge in fridges:
        prefs = prefs_map.get(fridge.id)
        sensor, board = sensors.get(fridge.id, (None, None))
        fridge_alerts = alerts.get(fridge.id, [])
        online = board_online(board, now)
        result.append({
            "id": fridge.id,
            "name": fridge.name,
            "location": fridge.location,
            "is_active": fridge.is_active,
            "custom_name": prefs.custom_name if prefs else None,
            "display_name": (prefs.custom_name if prefs and prefs.custom_name else None) or fridge.name,
            "folder_id": prefs.folder_id if prefs else None,
            "settings": prefs_to_dict(prefs),
            "sensor": {"id": sensor.id, "board_id": sensor.board_id, "present": sensor.present} if sensor else None,
            "last_temp": sensor.last_temp if sensor else None,
            "last_ts": sensor.last_ts if sensor else None,
            "board": {"id": board.id, "online": online, "last_seen_at": board.last_seen_at} if board else None,
            "alerts": [_alert_dict(a, sensor) for a in fridge_alerts],
            "state": _state(sensor, board, fridge_alerts, online),
        })
    return result


def _alert_dict(alert, sensor):
    data = alert_service.alert_to_dict(alert)
    # Czujnik po -127 znow odpowiada: awaria zamknie sie po SENSOR_RECOVERY_S poprawnych odczytow
    if (
        alert.kind == KIND_SENSOR_ERROR and alert.ended_at is None and sensor is not None
        and sensor.last_error_at is not None and sensor.last_ts is not None and sensor.last_ts > sensor.last_error_at
    ):
        data["recovers_at"] = sensor.last_error_at + current_app.config["SENSOR_RECOVERY_S"]
    return data


def choose_bucket(span):
    for max_span, bucket in BUCKETS:
        if span <= max_span:
            return bucket
    return 86400


def history(fridge_id, start, end):
    """Punkty wykresu {ts, avg, min, max}; dla dluzszych zakresow agregacja w bazie."""
    bucket = choose_bucket(end - start)
    base = db.session.query(Measurement).filter(
        Measurement.fridge_id == fridge_id, Measurement.ts >= start, Measurement.ts <= end
    )
    if bucket == 0:
        rows = base.with_entities(Measurement.ts, Measurement.temperature).order_by(Measurement.ts).all()
        points = [{"ts": ts, "avg": t, "min": t, "max": t} for ts, t in rows]
    else:
        # bucket pochodzi z BUCKETS (nie od klienta) - bezpieczny w tekscie SQL; dzielenie calkowite w SQLite i Postgresie
        bucket_expr = literal_column(f"(measurements.ts / {int(bucket)}) * {int(bucket)}", type_=BigInteger)
        rows = (
            base.with_entities(
                bucket_expr.label("bucket"),
                func.avg(Measurement.temperature),
                func.min(Measurement.temperature),
                func.max(Measurement.temperature),
            )
            .group_by(bucket_expr)
            .order_by(bucket_expr)
            .all()
        )
        points = [
            {"ts": int(b), "avg": round(float(avg), 2), "min": float(mn), "max": float(mx)}
            for b, avg, mn, mx in rows
        ]
    return {"bucket_s": bucket, "start": start, "end": end, "points": points}
