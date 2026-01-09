from app.extensions import db

class SubscriberDeviceSettings(db.Model):
    __tablename__ = 'subscriber_device_settings'

    subscriber_id = db.Column(db.Integer, db.ForeignKey('subscribers.id'), primary_key=True)
    device_id = db.Column(db.String(50), db.ForeignKey('devices.id'), primary_key=True)
    
    custom_threshold = db.Column(db.Float, default=8.0)

    # Używamy stringów 'PushSubscriber' i 'Device' w relacjach, by uniknąć importów tutaj
    subscriber = db.relationship('PushSubscriber', back_populates='device_settings')
    device = db.relationship('Device', back_populates='subscriber_settings')