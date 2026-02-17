from app.extensions import db
from datetime import datetime, timezone

class Device(db.Model):
    __tablename__ = 'devices'

    id = db.Column(db.String(50), primary_key=True)
    
    name = db.Column(db.String(100), nullable=True) 
    location = db.Column(db.String(50), nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    measurements = db.relationship('Measurement', backref='device', lazy='dynamic')
    subscriber_settings = db.relationship('SubscriberDeviceSettings', back_populates='device', cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Device {self.id}>"