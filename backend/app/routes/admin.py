from flask import current_app, jsonify, request
from flask_jwt_extended import current_user

from app.api_utils import ApiError, get_bool, get_json, get_str, not_found
from app.auth import admin_required
from app.extensions import db
from app.models import Alert, Board, Fridge, Measurement, Sensor, SensorAssignment, User, UserFridge
from app.models.alert import KIND_OFFLINE
from app.models.user import ROLE_ADMIN, ROLES
from app.routes.auth import user_to_dict
from app.services import alert_service, fridge_service
from app.services.user_service import create_user, validate_password
from app.utils import now_ts
from . import api_bp


def _get_or_404(model, key, what):
    obj = db.session.get(model, key)
    if obj is None:
        raise not_found(f"Nie znaleziono: {what}")
    return obj


# ---------- Uzytkownicy ----------

def _admin_user_dict(user):
    data = user_to_dict(user)
    data["is_active"] = user.is_active
    data["created_at"] = user.created_at.isoformat() if user.created_at else None
    data["fridge_ids"] = [link.fridge_id for link in user.fridge_links] if not user.is_admin else []
    return data


@api_bp.route("/admin/users", methods=["GET"])
@admin_required
def admin_list_users():
    users = User.query.order_by(User.email).all()
    return jsonify({"users": [_admin_user_dict(u) for u in users]})


@api_bp.route("/admin/users", methods=["POST"])
@admin_required
def admin_create_user():
    """Konto z haslem startowym - uzytkownik musi je zmienic przy pierwszym logowaniu."""
    data = get_json()
    try:
        user = create_user(
            email=data.get("email") if isinstance(data.get("email"), str) else "",
            password=data.get("password") if isinstance(data.get("password"), str) else "",
            role=data.get("role", "user"),
            display_name=get_str(data, "display_name", 100, allow_none=True),
            must_change_password=True,
        )
    except ValueError as e:
        raise ApiError(str(e), 400, "validation")
    return jsonify({"user": _admin_user_dict(user)}), 201


@api_bp.route("/admin/users/<int:user_id>", methods=["PATCH"])
@admin_required
def admin_update_user(user_id):
    user = _get_or_404(User, user_id, "użytkownik")
    data = get_json()
    is_self = user.id == current_user.id

    if "display_name" in data:
        user.display_name = get_str(data, "display_name", 100, allow_none=True)
    if "role" in data:
        if data["role"] not in ROLES:
            raise ApiError("Nieznana rola", 400, "validation")
        if is_self and data["role"] != user.role:
            raise ApiError("Nie możesz zmienić własnej roli", 400, "self_action")
        user.role = data["role"]
    if "is_active" in data:
        is_active = get_bool(data, "is_active")
        if is_self and not is_active:
            raise ApiError("Nie możesz zablokować własnego konta", 400, "self_action")
        if user.is_active and not is_active:
            user.token_version += 1  # natychmiastowe wylogowanie
        user.is_active = is_active
    db.session.commit()
    return jsonify({"user": _admin_user_dict(user)})


@api_bp.route("/admin/users/<int:user_id>/reset-password", methods=["POST"])
@admin_required
def admin_reset_password(user_id):
    user = _get_or_404(User, user_id, "użytkownik")
    password = get_json().get("password")
    error = validate_password(password if isinstance(password, str) else "")
    if error:
        raise ApiError(error, 400, "weak_password")
    user.set_password(password)
    user.must_change_password = True
    user.token_version += 1
    db.session.commit()
    return jsonify({"message": "Ustawiono hasło startowe"})


@api_bp.route("/admin/users/<int:user_id>", methods=["DELETE"])
@admin_required
def admin_delete_user(user_id):
    user = _get_or_404(User, user_id, "użytkownik")
    if user.id == current_user.id:
        raise ApiError("Nie możesz usunąć własnego konta", 400, "self_action")
    Alert.query.filter_by(user_id=user.id).delete()
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "Usunięto konto"})


@api_bp.route("/admin/users/<int:user_id>/fridges", methods=["PUT"])
@admin_required
def admin_set_user_fridges(user_id):
    """Pelna lista lodowek, do ktorych uzytkownik ma dostep: {"fridge_ids": [1, 2]}."""
    user = _get_or_404(User, user_id, "użytkownik")
    if user.is_admin:
        raise ApiError("Admin ma dostęp do wszystkich lodówek", 400, "validation")
    fridge_ids = get_json().get("fridge_ids")
    if not isinstance(fridge_ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in fridge_ids):
        raise ApiError("Pole fridge_ids musi być listą liczb", 400, "validation")
    wanted = set(fridge_ids)
    existing = {f.id for f in Fridge.query.filter(Fridge.id.in_(wanted)).all()} if wanted else set()
    if existing != wanted:
        raise not_found(f"Nie znaleziono lodówek: {sorted(wanted - existing)}")

    now = now_ts()
    current = {link.fridge_id: link for link in user.fridge_links}
    for fridge_id, link in current.items():
        if fridge_id not in wanted:
            alert_service.close_user_alerts(user.id, fridge_id, now)
            db.session.delete(link)
    for fridge_id in wanted - set(current):
        db.session.add(UserFridge(user_id=user.id, fridge_id=fridge_id))
    db.session.commit()
    return jsonify({"user": _admin_user_dict(user)})


# ---------- Lodowki ----------

@api_bp.route("/admin/fridges", methods=["GET"])
@admin_required
def admin_list_fridges():
    fridges = Fridge.query.order_by(Fridge.name).all()
    summaries = fridge_service.fridge_summaries(current_user, fridges)
    counts = dict(
        db.session.query(UserFridge.fridge_id, db.func.count())
        .join(User, User.id == UserFridge.user_id)
        .filter(User.role != ROLE_ADMIN)
        .group_by(UserFridge.fridge_id)
        .all()
    )
    for summary in summaries:
        summary["users_count"] = counts.get(summary["id"], 0)
    return jsonify({"fridges": summaries})


@api_bp.route("/admin/fridges", methods=["POST"])
@admin_required
def admin_create_fridge():
    data = get_json()
    fridge = Fridge(
        name=get_str(data, "name", 100, required=True),
        location=get_str(data, "location", 100, allow_none=True),
    )
    db.session.add(fridge)
    db.session.commit()
    return jsonify({"fridge": fridge_service.fridge_summaries(current_user, [fridge])[0]}), 201


@api_bp.route("/admin/fridges/<int:fridge_id>", methods=["PATCH"])
@admin_required
def admin_update_fridge(fridge_id):
    fridge = _get_or_404(Fridge, fridge_id, "lodówka")
    data = get_json()
    if "name" in data:
        fridge.name = get_str(data, "name", 100, required=True)
    if "location" in data:
        fridge.location = get_str(data, "location", 100, allow_none=True)
    if "is_active" in data:
        fridge.is_active = get_bool(data, "is_active")
    db.session.commit()
    return jsonify({"fridge": fridge_service.fridge_summaries(current_user, [fridge])[0]})


@api_bp.route("/admin/fridges/<int:fridge_id>", methods=["DELETE"])
@admin_required
def admin_delete_fridge(fridge_id):
    fridge = _get_or_404(Fridge, fridge_id, "lodówka")
    if db.session.query(Measurement.id).filter_by(fridge_id=fridge.id).first():
        raise ApiError("Lodówka ma historię pomiarów - zamiast usuwać, dezaktywuj ją", 409, "has_history")
    Alert.query.filter_by(fridge_id=fridge.id).delete()
    SensorAssignment.query.filter_by(fridge_id=fridge.id).delete()
    db.session.delete(fridge)
    db.session.commit()
    return jsonify({"message": "Usunięto lodówkę"})


def _close_active_assignments(now, fridge_id=None, sensor_id=None):
    query = SensorAssignment.query.filter(SensorAssignment.valid_to.is_(None))
    if fridge_id is not None:
        query = query.filter(SensorAssignment.fridge_id == fridge_id)
    if sensor_id is not None:
        query = query.filter(SensorAssignment.sensor_id == sensor_id)
    closed = query.all()
    for assignment in closed:
        assignment.valid_to = now
        alert_service.close_fridge_faults(assignment.fridge_id, now)
    return closed


@api_bp.route("/admin/fridges/<int:fridge_id>/assign", methods=["POST"])
@admin_required
def admin_assign_sensor(fridge_id):
    """Przypina czujnik do lodowki od teraz; poprzednie przypisania czujnika i lodowki sie koncza."""
    fridge = _get_or_404(Fridge, fridge_id, "lodówka")
    sensor_id = get_str(get_json(), "sensor_id", 16, required=True).lower()
    sensor = _get_or_404(Sensor, sensor_id, "czujnik")

    now = now_ts()
    _close_active_assignments(now, fridge_id=fridge.id)
    _close_active_assignments(now, sensor_id=sensor.id)
    db.session.add(SensorAssignment(sensor_id=sensor.id, fridge_id=fridge.id, valid_from=now))
    db.session.commit()
    return jsonify({"fridge": fridge_service.fridge_summaries(current_user, [fridge])[0]})


@api_bp.route("/admin/fridges/<int:fridge_id>/unassign", methods=["POST"])
@admin_required
def admin_unassign_sensor(fridge_id):
    fridge = _get_or_404(Fridge, fridge_id, "lodówka")
    now = now_ts()
    _close_active_assignments(now, fridge_id=fridge.id)
    alert_service.close_fault(fridge.id, KIND_OFFLINE, now, notify=False)
    db.session.commit()
    return jsonify({"fridge": fridge_service.fridge_summaries(current_user, [fridge])[0]})


# ---------- Plytki i czujniki ----------

def _board_dict(board, now, assigned):
    return {
        "id": board.id,
        "name": board.name,
        "fw": board.fw,
        "rssi": board.rssi,
        "buffered": board.buffered,
        "ota": board.ota,
        "interval_s": board.interval_s,
        "status_interval_s": board.status_interval_s,
        "last_seen_at": board.last_seen_at,
        "last_status_at": board.last_status_at,
        "online": fridge_service.board_online(board, now),
        "sensors": [_sensor_dict(s, assigned) for s in sorted(board.sensors, key=lambda s: s.id)],
    }


def _sensor_dict(sensor, assigned):
    fridge = assigned.get(sensor.id)
    return {
        "id": sensor.id,
        "board_id": sensor.board_id,
        "present": sensor.present,
        "last_temp": sensor.last_temp,
        "last_ts": sensor.last_ts,
        "fridge": {"id": fridge.id, "name": fridge.name} if fridge else None,
    }


def _assigned_fridges():
    """sensor_id -> Fridge z aktywnego przypisania."""
    rows = (
        db.session.query(SensorAssignment.sensor_id, Fridge)
        .join(Fridge, Fridge.id == SensorAssignment.fridge_id)
        .filter(SensorAssignment.valid_to.is_(None))
        .all()
    )
    return dict(rows)


@api_bp.route("/admin/boards", methods=["GET"])
@admin_required
def admin_list_boards():
    now = now_ts()
    assigned = _assigned_fridges()
    boards = Board.query.order_by(Board.id).all()
    return jsonify({"boards": [_board_dict(b, now, assigned) for b in boards]})


@api_bp.route("/admin/boards/<board_id>", methods=["PATCH"])
@admin_required
def admin_update_board(board_id):
    board = _get_or_404(Board, board_id, "płytka")
    data = get_json()
    if "name" in data:
        board.name = get_str(data, "name", 100, allow_none=True)
    db.session.commit()
    return jsonify({"board": _board_dict(board, now_ts(), _assigned_fridges())})


@api_bp.route("/admin/sensors", methods=["GET"])
@admin_required
def admin_list_sensors():
    """?unassigned=1 - tylko czujniki bez lodowki (do przypisania)."""
    assigned = _assigned_fridges()
    sensors = Sensor.query.order_by(Sensor.board_id, Sensor.id).all()
    if request.args.get("unassigned") == "1":
        sensors = [s for s in sensors if s.id not in assigned]
    return jsonify({"sensors": [_sensor_dict(s, assigned) for s in sensors]})


def _mqtt():
    client = current_app.extensions.get("mqtt")
    if client is None or client.connected_since is None:
        raise ApiError("Brak połączenia z brokerem MQTT", 503, "mqtt_unavailable")
    return client


@api_bp.route("/admin/boards/<board_id>/reset", methods=["POST"])
@admin_required
def admin_reset_board(board_id):
    board = _get_or_404(Board, board_id, "płytka")
    if not _mqtt().publish_command(board.id, "reset", "1"):
        raise ApiError("Nie udało się wysłać komendy", 503, "mqtt_publish_failed")
    return jsonify({"message": "Płytka zrestartuje się po najbliższym cyklu pomiarowym"})


@api_bp.route("/admin/boards/<board_id>/update", methods=["POST"])
@admin_required
def admin_update_firmware(board_id):
    """{"url": "https://..."} - plytka pobierze firmware w najblizszym cyklu, wynik w status.ota."""
    board = _get_or_404(Board, board_id, "płytka")
    url = get_str(get_json(), "url", 500, required=True)
    if not url.startswith("https://"):
        raise ApiError("Adres firmware musi zaczynać się od https://", 400, "validation")
    if not _mqtt().publish_command(board.id, "update", url):
        raise ApiError("Nie udało się wysłać komendy", 503, "mqtt_publish_failed")
    return jsonify({"message": "Płytka pobierze firmware w najbliższym cyklu; wynik pojawi się w statusie (OTA)"})
