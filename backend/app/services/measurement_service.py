from app.models.measurement import Measurement
from sqlalchemy import desc

class MeasurementService:
    
    @staticmethod
    def get_latest_for_device(device_id):
        """Pobiera ostatni pomiar dla KONKRETNEGO urządzenia"""
        return Measurement.query.filter_by(device_id=device_id)\
            .order_by(desc(Measurement.timestamp))\
            .first()

    @staticmethod
    def get_measurements_in_range(start_date, end_date, device_id=None):
        """Pobiera historię z opcjonalnym filtrowaniem po ID"""
        query = Measurement.query.filter(
            Measurement.timestamp >= start_date,
            Measurement.timestamp <= end_date
        )
        
        # Jeśli podano device_id, dodajemy filtr
        if device_id:
            query = query.filter(Measurement.device_id == device_id)
            
        return query.order_by(Measurement.timestamp.asc()).all()