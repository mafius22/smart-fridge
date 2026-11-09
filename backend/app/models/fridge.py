from app.extensions import db
from app.utils import utcnow


class Fridge(db.Model):
    """Lodowka - punkt pomiarowy widoczny dla uzytkownikow. Czujnik przypina sie przez SensorAssignment."""
    __tablename__ = "fridges"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    location = db.Column(db.String(100), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    assignments = db.relationship("SensorAssignment", back_populates="fridge")
    user_links = db.relationship("UserFridge", back_populates="fridge", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Fridge {self.id} {self.name}>"


class SensorAssignment(db.Model):
    """Czujnik w lodowce od valid_from do valid_to (NULL = nadal). Wymiana sondy nie gubi historii lodowki."""
    __tablename__ = "sensor_assignments"

    id = db.Column(db.Integer, primary_key=True)
    sensor_id = db.Column(db.String(16), db.ForeignKey("sensors.id"), nullable=False)
    fridge_id = db.Column(db.Integer, db.ForeignKey("fridges.id"), nullable=False, index=True)
    # Epoch UTC - porownywane z ts pomiaru (pomiary z bufora trafiaja do lodowki z chwili pomiaru)
    valid_from = db.Column(db.BigInteger, nullable=False)
    valid_to = db.Column(db.BigInteger, nullable=True)

    sensor = db.relationship("Sensor", back_populates="assignments")
    fridge = db.relationship("Fridge", back_populates="assignments")

    __table_args__ = (
        db.Index("ix_sensor_assignments_sensor_from", "sensor_id", "valid_from"),
    )
