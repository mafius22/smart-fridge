from flask import Blueprint, jsonify, request
import os
from datetime import datetime
from app.services.subscriber_service import SubscriberService
from app.services.measurement_service import MeasurementService
from app.models.measurement import Device

api_bp = Blueprint('api', __name__)

# --- STATUS I KLUCZ VAPID ---
@api_bp.route('/status', methods=['GET'])
def get_status():
    """
    Zwraca listę WSZYSTKICH urządzeń wraz z ich ostatnim pomiarem
    oraz klucz VAPID.
    """
    # 1. Pobieramy wszystkie zarejestrowane urządzenia
    devices = Device.query.all()
    
    devices_data = []
    
    for dev in devices:
        # 2. Dla każdego urządzenia pobieramy ostatni pomiar
        # (Musimy upewnić się, że MeasurementService ma taką metodę - patrz niżej)
        last_meas = MeasurementService.get_latest_for_device(dev.id)
        
        devices_data.append({
            "device_id": dev.id,
            "name": dev.name,
            "location": dev.location,
            "last_reading": last_meas.to_dict() if last_meas else None
        })

    return jsonify({
        "vapid_public_key": os.getenv("VAPID_PUBLIC_KEY"),
        "devices": devices_data  # Teraz zwracamy listę urządzeń
    })

# --- ZARZĄDZANIE SUBSKRYPCJAMI ---

@api_bp.route('/subscribe', methods=['POST'])
def subscribe():
    """Tworzy nową subskrypcję"""
    if not request.is_json:
        return jsonify({"error": "Format danych musi być JSON"}), 415

    data = request.get_json()
    
    if not data or 'endpoint' not in data or 'keys' not in data:
        return jsonify({"error": "Brak pola 'endpoint' lub 'keys'"}), 400

    keys = data['keys']
    if 'p256dh' not in keys or 'auth' not in keys:
        return jsonify({"error": "Brak kluczy autoryzacji"}), 400

    success, message, status_code = SubscriberService.register_new_subscriber(
        endpoint=data['endpoint'],
        p256dh=keys['p256dh'],
        auth=keys['auth']
    )

    return jsonify({"success": success, "message": message}), status_code


@api_bp.route('/subscribe', methods=['PUT'])
def update_subscription():
    """Aktualizuje ustawienia istniejącej subskrypcji"""
    data = request.json
    if 'endpoint' not in data:
        return jsonify({"error": "Brak endpointu identyfikującego"}), 400

    success, msg = SubscriberService.update_subscriber_settings(
        endpoint=data['endpoint'],
        is_active=data.get('is_active'),
        threshold=data.get('custom_threshold')
    )

    if success:
        return jsonify({"message": msg}), 200
    return jsonify({"error": msg}), 404


@api_bp.route('/subscribe', methods=['GET'])
def get_subscription_settings():
    endpoint = request.args.get('endpoint')
    if not endpoint:
        return jsonify({"error": "Brak parametru 'endpoint'"}), 400

    subscriber_data = SubscriberService.get_settings_by_endpoint(endpoint)
    if subscriber_data:
        return jsonify(subscriber_data), 200
    return jsonify({"error": "Nie znaleziono subskrypcji"}), 404


# --- HISTORIA POMIARÓW ---

@api_bp.route('/measurements', methods=['GET'])
def get_measurements_history():
    """
    Pobiera historię. 
    Obsługuje filtry: start, end ORAZ device_id (opcjonalnie)
    """
    start_str = request.args.get('start')
    end_str = request.args.get('end')
    device_id = request.args.get('device_id')  # <--- Nowy parametr

    if not start_str or not end_str:
        return jsonify({"error": "Podaj parametry 'start' i 'end' (format YYYY-MM-DD)"}), 400

    try:
        # Obsługa daty z czasem lub samej daty
        # Jeśli przyjdzie "2024-01-01", dodajemy godziny dla pewności
        if len(start_str) == 10: start_str += "T00:00:00"
        if len(end_str) == 10: end_str += "T23:59:59"

        start_date = datetime.fromisoformat(start_str)
        end_date = datetime.fromisoformat(end_str)

        # Przekazujemy device_id do serwisu
        measurements = MeasurementService.get_measurements_in_range(
            start_date, end_date, device_id
        )

        data = [m.to_dict() for m in measurements]

        return jsonify({
            "count": len(data),
            "range": {"start": start_str, "end": end_str},
            "device_filter": device_id if device_id else "ALL",
            "data": data
        })

    except ValueError:
        return jsonify({"error": "Niepoprawny format daty. Użyj ISO (YYYY-MM-DD)"}), 400