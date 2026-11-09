from flask import current_app, jsonify, request
from flask_jwt_extended import current_user

from app.api_utils import ApiError, get_json, get_str
from app.auth import login_required
from app.extensions import db
from app.models import PushSubscription
from app.services import push_service
from . import api_bp


@api_bp.route("/push/vapid-key", methods=["GET"])
@login_required
def vapid_key():
    return jsonify({"public_key": current_app.config.get("VAPID_PUBLIC_KEY")})


@api_bp.route("/push/subscriptions", methods=["POST"])
@login_required
def subscribe():
    """Body = PushSubscription.toJSON() z przegladarki: {endpoint, keys: {p256dh, auth}}."""
    data = get_json()
    endpoint = get_str(data, "endpoint", 2000, required=True)
    if not endpoint.startswith("https://"):
        raise ApiError("Niepoprawny endpoint", 400, "validation")
    keys = data.get("keys") if isinstance(data.get("keys"), dict) else {}
    p256dh = get_str(keys, "p256dh", 255, required=True)
    auth = get_str(keys, "auth", 255, required=True)

    sub = PushSubscription.query.filter_by(endpoint=endpoint).first()
    if sub is None:
        sub = PushSubscription(endpoint=endpoint)
        db.session.add(sub)
    # Ta sama przegladarka po zalogowaniu na inne konto - subskrypcja przechodzi na nowe konto
    sub.user_id = current_user.id
    sub.p256dh = p256dh
    sub.auth = auth
    sub.user_agent = (request.headers.get("User-Agent") or "")[:255]
    db.session.commit()
    return jsonify({"message": "Powiadomienia włączone"}), 201


@api_bp.route("/push/subscriptions", methods=["DELETE"])
@login_required
def unsubscribe():
    data = get_json()
    endpoint = get_str(data, "endpoint", 2000, required=True)
    PushSubscription.query.filter_by(endpoint=endpoint, user_id=current_user.id).delete()
    db.session.commit()
    return jsonify({"message": "Powiadomienia wyłączone"})


@api_bp.route("/push/test", methods=["POST"])
@login_required
def test_push():
    if not PushSubscription.query.filter_by(user_id=current_user.id).first():
        raise ApiError("Brak włączonych powiadomień w żadnej przeglądarce", 400, "no_subscription")
    push_service.queue(current_user.id, "Smart Fridge", "Powiadomienia działają ✔", url="/settings", tag="test")
    push_service.send_pending()
    return jsonify({"message": "Wysłano powiadomienie testowe"})
