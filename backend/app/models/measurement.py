from app import db
from datetime import datetime, timezone

class Device(db.Model):
    __tablename__ = 'devices'

    id = db.Column(db.String(50), primary_key=True)
    
    name = db.Column(db.String(100), nullable=True) 
    location = db.Column(db.String(50), nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    measurements = db.relationship('Measurement', backref='device', lazy='dynamic')

    def __repr__(self):
        return f"<Device {self.id}>"


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
        return {
            "device": self.device_id,
            "temp": self.temperature,
            "press": self.pressure,
            "time": self.timestamp.isoformat() + 'Z'
        }