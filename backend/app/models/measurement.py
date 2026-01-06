from app import db
from datetime import datetime

class Measurement(db.Model):
    __tablename__ = 'measurements'
    
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=datetime.now) # Czas serwera
    esp_timestamp = db.Column(db.Integer)                    # Czas z ESP32
    temperature = db.Column(db.Float)
    pressure = db.Column(db.Float)

    def to_dict(self):
        """Pomocnicza metoda do zwracania JSON"""
        return {
            "temp": self.temperature,
            "press": self.pressure,
            "time": self.timestamp.isoformat()
        }