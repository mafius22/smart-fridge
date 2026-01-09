import os
from flask import jsonify
from app.models import Device
from app.services.measurement_service import MeasurementService
from . import api_bp

@api_bp.route('/status', methods=['GET'])
def get_status():
    devices = Device.query.all()
    devices_data = []
    
    for dev in devices:
        last_meas = MeasurementService.get_latest_for_device(dev.id)
        devices_data.append({
            "device_id": dev.id,
            "name": dev.name,
            "location": dev.location,
            "last_reading": last_meas.to_dict() if last_meas else None
        })

    return jsonify({
        "vapid_public_key": os.getenv("VAPID_PUBLIC_KEY"),
        "devices": devices_data
    })