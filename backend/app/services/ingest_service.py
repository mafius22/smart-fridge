import logging
import math
import re
from dataclasses import dataclass, field

from flask import current_app
from sqlalchemy.dialects import postgresql, sqlite

from app.extensions import db
from app.models import Board, Measurement, Sensor, SensorAssignment
from app.models.alert import KIND_SENSOR_ERROR, KIND_SENSOR_MISSING
from app.services import alert_service
from app.utils import now_ts

logger = logging.getLogger(__name__)

BOARD_ID_RE = re.compile(r"^sf-[0-9a-f]{12}$")
SID_RE = re.compile(r"^[0-9a-f]{16}$")

# Plytka wysyla te wartosc, gdy nie udalo sie odczytac czujnika
SENSOR_ERROR_TEMP = -127.0
# ts mniejszy = plytka nie miala czasu (2024-01-01), wiekszy niz teraz + zapas = zly zegar
MIN_VALID_TS = 1704067200
MAX_FUTURE_S = 3600
# Zakres pracy DS18B20; inne wartosci to smieci z magistrali
MIN_TEMP, MAX_TEMP = -55.0, 125.0
OTA_VALUES = ("none", "pending", "ok", "error", "rollback")


@dataclass
class IngestResult:
    received: int = 0
    # (sensor_id, fridge_id, ts, temp) faktycznie dopisane - duplikaty z bufora tu nie trafiaja
    inserted: list = field(default_factory=list)
    # (sid, ts) czujnikow, ktore zglosily -127
    sensor_errors: list = field(default_factory=list)
    rejected: int = 0


def _get_or_create_board(board_id):
    board = db.session.get(Board, board_id)
    if board is None:
        board = Board(id=board_id)
        db.session.add(board)
        logger.info(f"Nowa płytka: {board_id}")
    return board


def _get_or_create_sensor(sid, board_id):
    sensor = db.session.get(Sensor, sid)
    if sensor is None:
        sensor = Sensor(id=sid, board_id=board_id)
        db.session.add(sensor)
        logger.info(f"Nowy czujnik: {sid} na płytce {board_id}")
    elif sensor.board_id != board_id:
        logger.warning(f"Czujnik {sid} przeniesiony z {sensor.board_id} na {board_id}")
        sensor.board_id = board_id
    return sensor


def _load_assignments(sensor_ids):
    """sid -> lista (valid_from, valid_to, fridge_id); jedno zapytanie na paczke."""
    rows = db.session.query(
        SensorAssignment.sensor_id, SensorAssignment.valid_from,
        SensorAssignment.valid_to, SensorAssignment.fridge_id,
    ).filter(SensorAssignment.sensor_id.in_(sensor_ids)).all()
    result = {}
    for sid, valid_from, valid_to, fridge_id in rows:
        result.setdefault(sid, []).append((valid_from, valid_to, fridge_id))
    return result


def _fridge_at(assignments, ts):
    """Lodowka, w ktorej czujnik byl w chwili pomiaru (pomiary z bufora moga byc sprzed przepiecia)."""
    for valid_from, valid_to, fridge_id in assignments:
        if valid_from <= ts and (valid_to is None or ts < valid_to):
            return fridge_id
    return None


def _insert_ignore_duplicates(rows):
    """Wstawia pomiary, pomija istniejace (sensor_id, ts). Zwraca liste faktycznie wstawionych."""
    dialect = db.session.get_bind().dialect.name
    if dialect == "postgresql":
        insert = postgresql.insert
    elif dialect == "sqlite":
        insert = sqlite.insert
    else:
        raise RuntimeError(f"Nieobsługiwana baza: {dialect}")

    stmt = (
        insert(Measurement)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["sensor_id", "ts"])
        .returning(Measurement.sensor_id, Measurement.fridge_id, Measurement.ts, Measurement.temperature)
    )
    return [tuple(r) for r in db.session.execute(stmt).all()]


def _parse_ts(value, now):
    """(ts, ts_from_server) - czas serwera, gdy plytka nie miala czasu albo ma zly zegar."""
    try:
        ts = int(value or 0)
    except (TypeError, ValueError):
        ts = 0
    if MIN_VALID_TS <= ts <= now + MAX_FUTURE_S:
        return ts, False
    return now, True


def _parse_reading(reading, now):
    """Zwraca (sid, ts, ts_from_server, temp) albo None, gdy rekord jest niepoprawny."""
    if not isinstance(reading, dict):
        return None
    sid = str(reading.get("sid", "")).lower()
    if not SID_RE.match(sid):
        return None
    try:
        temp = float(reading["temp"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(temp):
        return None
    ts, ts_from_server = _parse_ts(reading.get("ts"), now)
    return sid, ts, ts_from_server, temp


def ingest_data(board_id, payload):
    """
    Obsluga sf/v1/{board_id}/data: {"readings": [{"sid", "ts", "temp"}, ...]}.
    Biezace pomiary i zaleglosci z bufora maja ten sam format - rozroznia je tylko ts.
    Commit robi wywolujacy (jedna transakcja na wiadomosc).
    """
    readings = payload.get("readings") if isinstance(payload, dict) else None
    if not isinstance(readings, list):
        raise ValueError("brak listy 'readings'")

    now = now_ts()
    fresh_s = current_app.config["ALERT_FRESH_S"]
    result = IngestResult(received=len(readings))
    board = _get_or_create_board(board_id)
    board.last_seen_at = now

    parsed = []
    for reading in readings:
        item = _parse_reading(reading, now)
        if item is None:
            result.rejected += 1
            logger.warning(f"{board_id}: odrzucony rekord {reading}")
            continue
        parsed.append(item)

    sensors = {}
    for sid, _, _, _ in parsed:
        if sid not in sensors:
            sensors[sid] = _get_or_create_sensor(sid, board_id)
            sensors[sid].last_seen_at = now
    assignments = _load_assignments(list(sensors)) if sensors else {}

    rows = []
    for sid, ts, ts_from_server, temp in parsed:
        if temp == SENSOR_ERROR_TEMP:
            # Nie zapisujemy jako pomiar (psuloby wykres) - tylko alarm awarii
            result.sensor_errors.append((sid, ts))
            logger.warning(f"{board_id}: czujnik {sid} nie odpowiada (-127) @ {ts}")
            continue
        if not MIN_TEMP <= temp <= MAX_TEMP:
            result.rejected += 1
            logger.warning(f"{board_id}: temperatura poza zakresem czujnika {sid}: {temp}")
            continue
        rows.append({
            "sensor_id": sid,
            "fridge_id": _fridge_at(assignments.get(sid, ()), ts),
            "ts": ts,
            "ts_from_server": ts_from_server,
            "temperature": temp,
            "received_at": now,
        })

    if rows:
        # Nowe plytki/czujniki musza byc w bazie przed pomiarami (klucz obcy w Postgresie)
        db.session.flush()
        result.inserted = _insert_ignore_duplicates(rows)

    alert_service.board_seen(board_id, now)

    # Stan czujnika i alarmy tylko z najnowszego pomiaru - stary pomiar z bufora nie zmienia biezacego stanu
    newest = {}
    for sensor_id, fridge_id, ts, temp in result.inserted:
        if sensor_id not in newest or ts > newest[sensor_id][1]:
            newest[sensor_id] = (fridge_id, ts, temp)
    for sensor_id, (fridge_id, ts, temp) in newest.items():
        sensor = sensors[sensor_id]
        if sensor.last_ts is not None and ts <= sensor.last_ts:
            continue
        sensor.last_ts = ts
        sensor.last_temp = temp
        sensor.present = True
        if fridge_id is not None and now - ts <= fresh_s:
            alert_service.close_fault(fridge_id, KIND_SENSOR_ERROR, now)
            alert_service.close_fault(fridge_id, KIND_SENSOR_MISSING, now)
            alert_service.evaluate_temperature(fridge_id, temp, ts, now)

    for sid, ts in result.sensor_errors:
        sensor = sensors[sid]
        if now - ts > fresh_s or (sensor.last_ts is not None and ts <= sensor.last_ts):
            continue
        fridge_id = alert_service.active_fridge_of_sensor(sid)
        if fridge_id is not None:
            alert_service.open_fault(fridge_id, KIND_SENSOR_ERROR, now)

    duplicates = len(rows) - len(result.inserted)
    logger.info(
        f"📦 {board_id}: odebrane {result.received}, zapisane {len(result.inserted)}, "
        f"duplikaty {duplicates}, -127: {len(result.sensor_errors)}, odrzucone {result.rejected}"
    )
    return result


def ingest_status(board_id, payload, retained=False):
    """
    Obsluga sf/v1/{board_id}/status (retained). Wiadomosc retained = zapisana na brokerze wczesniej
    (np. po starcie backendu): aktualizuje dane plytki, ale nie oznacza, ze plytka jest teraz online.
    """
    if not isinstance(payload, dict):
        raise ValueError("status nie jest obiektem JSON")

    now = now_ts()
    board = _get_or_create_board(board_id)
    status_ts, ts_from_server = _parse_ts(payload.get("ts"), now)
    if board.last_status_at is not None and status_ts < board.last_status_at:
        logger.info(f"{board_id}: starszy status ({status_ts}) niż zapisany - pomijam")
        return False

    old_ota = board.ota
    board.fw = str(payload.get("fw"))[:32] if payload.get("fw") is not None else board.fw
    for key in ("rssi", "buffered", "interval_s", "status_interval_s"):
        value = payload.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            setattr(board, key, value)
    ota = payload.get("ota")
    if ota in OTA_VALUES:
        board.ota = ota
        if old_ota is not None and ota != old_ota:
            logger.info(f"{board_id}: OTA {old_ota} -> {ota}")
    board.last_status_at = status_ts

    reported = payload.get("sensors")
    if not isinstance(reported, list):
        reported = []
    reported = {str(s).lower() for s in reported if SID_RE.match(str(s).lower())}
    for sid in reported:
        _get_or_create_sensor(sid, board_id)
    db.session.flush()

    fresh = not retained or (not ts_from_server and now - status_ts <= current_app.config["ALERT_FRESH_S"])
    for sensor in Sensor.query.filter_by(board_id=board_id).all():
        sensor.present = sensor.id in reported
        if not fresh:
            continue
        fridge_id = alert_service.active_fridge_of_sensor(sensor.id)
        if fridge_id is None:
            continue
        if sensor.present:
            alert_service.close_fault(fridge_id, KIND_SENSOR_MISSING, now)
        else:
            alert_service.open_fault(fridge_id, KIND_SENSOR_MISSING, now)

    if fresh:
        board.last_seen_at = now
        alert_service.board_seen(board_id, now)

    logger.info(
        f"ℹ️ {board_id}: status fw={board.fw} ota={board.ota} rssi={board.rssi} "
        f"buffered={board.buffered} czujniki={len(reported)}{' (retained)' if retained else ''}"
    )
    return True
