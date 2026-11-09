from flask import jsonify
from flask_jwt_extended import current_user

from app.api_utils import ApiError, get_bool, get_int_arg, get_float, get_json, get_str, not_found
from app.auth import login_required
from app.extensions import db
from app.models import Alert, Fridge, Folder
from app.services import access_service, alert_service, fridge_service
from app.utils import now_ts
from . import api_bp

TEMP_LIMITS = (-60.0, 60.0)


@api_bp.route("/fridges", methods=["GET"])
@login_required
def list_fridges():
    fridges = access_service.accessible_fridges_query(current_user).order_by(Fridge.name).all()
    return jsonify({"fridges": fridge_service.fridge_summaries(current_user, fridges)})


@api_bp.route("/fridges/<int:fridge_id>", methods=["GET"])
@login_required
def get_fridge(fridge_id):
    fridge = access_service.get_accessible_fridge(current_user, fridge_id)
    return jsonify({"fridge": fridge_service.fridge_summaries(current_user, [fridge])[0]})


@api_bp.route("/fridges/<int:fridge_id>/prefs", methods=["PATCH"])
@login_required
def update_prefs(fridge_id):
    """Wlasne ustawienia uzytkownika: nazwa, folder, progi, powiadomienia."""
    fridge = access_service.get_accessible_fridge(current_user, fridge_id)
    data = get_json()
    prefs = access_service.get_or_create_prefs(current_user, fridge.id)

    if "custom_name" in data:
        prefs.custom_name = get_str(data, "custom_name", 100, allow_none=True)
    if "folder_id" in data:
        folder_id = data["folder_id"]
        if folder_id is not None:
            valid_id = isinstance(folder_id, int) and not isinstance(folder_id, bool)
            folder = db.session.get(Folder, folder_id) if valid_id else None
            if folder is None or folder.user_id != current_user.id:
                raise not_found("Nie znaleziono folderu")
        prefs.folder_id = folder_id
    for key in ("min_temp", "max_temp"):
        if key in data:
            setattr(prefs, key, get_float(data, key, *TEMP_LIMITS))
    for key in ("notify_low", "notify_high", "notify_fault"):
        if key in data:
            setattr(prefs, key, get_bool(data, key))
    if prefs.min_temp is not None and prefs.max_temp is not None and prefs.min_temp >= prefs.max_temp:
        raise ApiError("Próg minimalny musi być niższy od maksymalnego", 400, "validation")

    db.session.flush()
    alert_service.reconcile_prefs(prefs, now_ts())
    db.session.commit()
    return jsonify({"fridge": fridge_service.fridge_summaries(current_user, [fridge])[0]})


@api_bp.route("/fridges/<int:fridge_id>/measurements", methods=["GET"])
@login_required
def get_measurements(fridge_id):
    """?from=&to= (epoch s). Domyslnie ostatnie 24 h."""
    fridge = access_service.get_accessible_fridge(current_user, fridge_id)
    now = now_ts()
    end = get_int_arg("to", default=now, lo=0)
    start = get_int_arg("from", default=end - 86400, lo=0)
    if start >= end:
        raise ApiError("Parametr from musi być mniejszy od to", 400, "validation")
    if end - start > fridge_service.MAX_RANGE_S:
        raise ApiError("Zakres może mieć maks. 400 dni", 400, "validation")
    return jsonify(fridge_service.history(fridge.id, start, end))


@api_bp.route("/fridges/<int:fridge_id>/alerts", methods=["GET"])
@login_required
def get_alerts(fridge_id):
    """Ostatnie alarmy lodowki widoczne dla uzytkownika (awarie + jego alarmy temperatury)."""
    fridge = access_service.get_accessible_fridge(current_user, fridge_id)
    limit = get_int_arg("limit", default=20, lo=1, hi=100)
    alerts = (
        Alert.query.filter(
            Alert.fridge_id == fridge.id,
            (Alert.user_id.is_(None)) | (Alert.user_id == current_user.id),
        )
        .order_by(Alert.started_at.desc())
        .limit(limit)
        .all()
    )
    return jsonify({"alerts": [alert_service.alert_to_dict(a) for a in alerts]})
