from flask import jsonify
from flask_jwt_extended import (
    create_access_token, create_refresh_token, current_user, jwt_required,
    set_access_cookies, set_refresh_cookies, unset_jwt_cookies,
)
from werkzeug.security import check_password_hash, generate_password_hash

from app.api_utils import ApiError, get_bool, get_json, get_str
from app.auth import login_required
from app.extensions import db, limiter
from app.models import User
from app.services.user_service import normalize_email, validate_password
from . import api_bp

# Porownanie z hashem takze dla nieistniejacego konta - czas odpowiedzi nie zdradza, czy e-mail jest w bazie
_DUMMY_HASH = generate_password_hash("dummy-password-for-timing")


def user_to_dict(user):
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "display_name": user.display_name,
        "must_change_password": user.must_change_password,
        "notifications_enabled": user.notifications_enabled,
        "show_short_alerts": user.show_short_alerts,
    }


def _session_response(user, status=200):
    response = jsonify({"user": user_to_dict(user)})
    set_access_cookies(response, create_access_token(identity=user))
    set_refresh_cookies(response, create_refresh_token(identity=user))
    return response, status


@api_bp.route("/auth/login", methods=["POST"])
@limiter.limit("10 per 15 minutes")
def login():
    data = get_json()
    email = normalize_email(data.get("email") if isinstance(data.get("email"), str) else "")
    password = data.get("password") if isinstance(data.get("password"), str) else ""

    user = User.query.filter_by(email=email).first() if email else None
    if user is None:
        check_password_hash(_DUMMY_HASH, password)
        raise ApiError("Nieprawidłowy e-mail lub hasło", 401, "invalid_credentials")
    if not user.check_password(password):
        raise ApiError("Nieprawidłowy e-mail lub hasło", 401, "invalid_credentials")
    if not user.is_active:
        raise ApiError("Konto jest zablokowane", 403, "account_disabled")
    return _session_response(user)


@api_bp.route("/auth/refresh", methods=["POST"])
@jwt_required(refresh=True)
def refresh():
    response = jsonify({"user": user_to_dict(current_user)})
    set_access_cookies(response, create_access_token(identity=current_user))
    return response


@api_bp.route("/auth/logout", methods=["POST"])
def logout():
    # Bez wymogu waznego tokenu - wylogowanie ma dzialac takze po wygasnieciu sesji
    response = jsonify({"message": "Wylogowano"})
    unset_jwt_cookies(response)
    return response


@api_bp.route("/auth/me", methods=["GET"])
@login_required(allow_pending_password=True)
def get_me():
    return jsonify({"user": user_to_dict(current_user)})


@api_bp.route("/auth/me", methods=["PATCH"])
@login_required
def update_me():
    data = get_json()
    if "display_name" in data:
        current_user.display_name = get_str(data, "display_name", 100, allow_none=True)
    if "notifications_enabled" in data:
        current_user.notifications_enabled = get_bool(data, "notifications_enabled")
    if "show_short_alerts" in data:
        current_user.show_short_alerts = get_bool(data, "show_short_alerts")
    db.session.commit()
    return jsonify({"user": user_to_dict(current_user)})


@api_bp.route("/auth/change-password", methods=["POST"])
@login_required(allow_pending_password=True)
@limiter.limit("10 per 15 minutes")
def change_password():
    data = get_json()
    current_password = data.get("current_password") if isinstance(data.get("current_password"), str) else ""
    new_password = data.get("new_password") if isinstance(data.get("new_password"), str) else ""

    if not current_user.check_password(current_password):
        raise ApiError("Obecne hasło jest nieprawidłowe", 400, "invalid_password")
    error = validate_password(new_password)
    if error:
        raise ApiError(error, 400, "weak_password")
    if new_password == current_password:
        raise ApiError("Nowe hasło musi się różnić od obecnego", 400, "same_password")

    current_user.set_password(new_password)
    current_user.must_change_password = False
    # Wylogowuje inne urzadzenia; biezace dostaje nowe ciasteczka ponizej
    current_user.token_version += 1
    db.session.commit()
    return _session_response(current_user)
