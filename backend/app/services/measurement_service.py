from app.models.measurement import Measurement

class MeasurementService:
    @staticmethod
    def get_latest_measurement():
        """
        Pobiera najnowszy wpis z bazy.
        Zwraca: Obiekt Measurement lub None.
        """
        return Measurement.query.order_by(Measurement.id.desc()).first()
    
    def get_measurements_in_range(start_date, end_date):
        """
        Pobiera listę pomiarów z podanego zakresu czasowego.
        start_date, end_date: obiekty datetime
        """
        
        return Measurement.query.filter(
            Measurement.timestamp.between(start_date, end_date)
        ).order_by(Measurement.timestamp.asc()).all()