from app.extensions import db
from app.utils import utcnow


class Sensor(db.Model):
    """Sonda DS18B20. id = sid z firmware: ROM 16 znakow hex (np. 2860107000000009)."""
    __tablename__ = "sensors"

    id = db.Column(db.String(16), primary_key=True)
    board_id = db.Column(db.String(20), db.ForeignKey("boards.id"), nullable=False, index=True)

    # False, gdy plytka nie zglosila sondy w status.sensors
    present = db.Column(db.Boolean, nullable=False, default=True)

    # Najnowszy pomiar (po ts z plytki) - starszy pomiar z bufora nie zmienia stanu alarmow
    last_ts = db.Column(db.BigInteger, nullable=True)
    last_temp = db.Column(db.Float, nullable=True)
    # Epoch UTC odebrania ostatniego pomiaru przez backend
    last_seen_at = db.Column(db.BigInteger, nullable=True)
    # ts ostatniego swiezego -127 - awaria zamyka sie po SENSOR_RECOVERY_S poprawnych odczytow
    last_error_at = db.Column(db.BigInteger, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    board = db.relationship("Board", back_populates="sensors")
    assignments = db.relationship("SensorAssignment", back_populates="sensor")

    def __repr__(self):
        return f"<Sensor {self.id} @ {self.board_id}>"
