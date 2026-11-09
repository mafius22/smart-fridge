from app.extensions import db
from app.utils import utcnow


class Board(db.Model):
    """Plytka ESP32. id = device_id z firmware: "sf-" + MAC."""
    __tablename__ = "boards"

    id = db.Column(db.String(20), primary_key=True)
    name = db.Column(db.String(100), nullable=True)

    # Pola z ostatniego statusu
    fw = db.Column(db.String(32), nullable=True)
    rssi = db.Column(db.Integer, nullable=True)
    buffered = db.Column(db.Integer, nullable=True)
    ota = db.Column(db.String(16), nullable=True)
    interval_s = db.Column(db.Integer, nullable=True)
    status_interval_s = db.Column(db.Integer, nullable=True)

    # Epoch UTC: dowolna wiadomosc od plytki i ostatni status
    last_seen_at = db.Column(db.BigInteger, nullable=True)
    last_status_at = db.Column(db.BigInteger, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    sensors = db.relationship("Sensor", back_populates="board")

    def __repr__(self):
        return f"<Board {self.id}>"
