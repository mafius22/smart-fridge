from flask import Blueprint, jsonify, request
from app import db
from app.models.measurement import Measurement
from app.models.subscriber import PushSubscriber
import os

api_bp = Blueprint('api', __name__)

@api_bp.route('/status', methods=['GET'])
def get_status():
    """Zwraca ostatni pomiar + klucz VAPID"""
    last = Measurement.query.order_by(Measurement.id.desc()).first()
    
    data = None
    if last:
        data = last.to_dict()

    return jsonify({
        "vapid_public_key": os.getenv("VAPID_PUBLIC_KEY"),
        "data": data
    })

@api_bp.route('/subscribe', methods=['POST'])
def subscribe():
    """Rejestruje użytkownika do powiadomień"""
    data = request.json
    if not data or 'endpoint' not in data:
        return jsonify({"error": "Brak danych"}), 400

    # Sprawdzamy czy już jest w bazie
    exists = PushSubscriber.query.filter_by(endpoint=data['endpoint']).first()
    
    if not exists:
        new_sub = PushSubscriber(
            endpoint=data['endpoint'],
            p256dh=data['keys']['p256dh'],
            auth=data['keys']['auth']
        )
        db.session.add(new_sub)
        db.session.commit()
        return jsonify({"success": True, "message": "Zapisano"})
    
    return jsonify({"success": True, "message": "Już zapisany"})