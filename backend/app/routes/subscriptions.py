from flask import request, jsonify
from app.services.subscriber_service import SubscriberService
from . import api_bp

@api_bp.route('/subscribe', methods=['POST'])
def subscribe():
    if not request.is_json:
        return jsonify({"error": "Format JSON wymagany"}), 415

    data = request.get_json()
    if not data or 'endpoint' not in data or 'keys' not in data:
        return jsonify({"error": "Brak endpoint lub keys"}), 400

    keys = data['keys']
    success, message, code = SubscriberService.register_new_subscriber(
        endpoint=data['endpoint'],
        p256dh=keys.get('p256dh'),
        auth=keys.get('auth')
    )
    return jsonify({"success": success, "message": message}), code

@api_bp.route('/subscribe', methods=['PUT'])
def update_subscription():
    data = request.json
    if 'endpoint' not in data:
        return jsonify({"error": "Brak endpoint"}), 400

    success, msg = SubscriberService.update_subscriber_settings(
        endpoint=data['endpoint'],
        is_active=data.get('is_active'),
        threshold=data.get('custom_threshold'),
        device_id=data.get('device_id')
    )

    if success:
        return jsonify({"message": msg}), 200
    return jsonify({"error": msg}), 400

@api_bp.route('/subscribe', methods=['GET'])
def get_subscription_settings():
    endpoint = request.args.get('endpoint')
    if not endpoint:
        return jsonify({"error": "Brak endpoint"}), 400

    data = SubscriberService.get_settings_by_endpoint(endpoint)
    if data:
        return jsonify(data), 200
    return jsonify({"error": "Subskrypcja nie znaleziona"}), 404