from app import db

class PushSubscriber(db.Model):
    __tablename__ = 'subscribers'
    
    id = db.Column(db.Integer, primary_key=True)
    endpoint = db.Column(db.Text, unique=True, nullable=False)
    p256dh = db.Column(db.String(255), nullable=False)
    auth = db.Column(db.String(255), nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    custom_threshold = db.Column(db.Float, default=8.0)