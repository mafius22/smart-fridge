from datetime import datetime
from flask import request, jsonify
from app.services.measurement_service import MeasurementService
from . import api_bp

@api_bp.route('/measurements', methods=['GET'])
def get_measurements_history():
    start_str = request.args.get('start')
    end_str = request.args.get('end')
    device_id = request.args.get('device_id')

    if not start_str or not end_str:
        return jsonify({"error": "Wymagane parametry start i end"}), 400

    try:
        if len(start_str) == 10: start_str += "T00:00:00"
        if len(end_str) == 10: end_str += "T23:59:59"

        start_date = datetime.fromisoformat(start_str)
        end_date = datetime.fromisoformat(end_str)

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
        return jsonify({"error": "Błędny format daty"}), 400