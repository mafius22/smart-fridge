from app.extensions import db
from datetime import datetime, timezone
from datetime import datetime, timezone

class Measurement(db.Model):
    __tablename__ = 'measurements'

    id = db.Column(db.Integer, primary_key=True)
    device_id = db.Column(db.String(50), db.ForeignKey('devices.id'), nullable=False, index=True)
    
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    esp_timestamp = db.Column(db.BigInteger)
    
    temperature = db.Column(db.Float)
    pressure = db.Column(db.Float)

    __table_args__ = (
        db.Index('idx_device_time', 'device_id', 'timestamp'),
    )

    def to_dict(self):
        dt_object = datetime.fromtimestamp(self.esp_timestamp, timezone.utc)
        
        return {
            "device": self.device_id,
            "temp": self.temperature,
            "press": self.pressure,
            "time": dt_object.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
        }