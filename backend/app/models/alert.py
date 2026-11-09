from app.extensions import db

# Alarmy temperatury - osobno dla kazdego uzytkownika
KIND_HIGH = "high"
KIND_LOW = "low"
# Awarie - wspolne dla lodowki (user_id = NULL)
KIND_SENSOR_ERROR = "sensor_error"      # odczyt -127
KIND_SENSOR_MISSING = "sensor_missing"  # sonda zniknela ze status.sensors
KIND_OFFLINE = "offline"                # brak wiadomosci od plytki

TEMPERATURE_KINDS = (KIND_HIGH, KIND_LOW)
FAULT_KINDS = (KIND_SENSOR_ERROR, KIND_SENSOR_MISSING, KIND_OFFLINE)


class Alert(db.Model):
    """Okres alarmu. Aktywny = ended_at NULL. Push tylko przy otwarciu i zamknieciu."""
    __tablename__ = "alerts"

    id = db.Column(db.Integer, primary_key=True)
    fridge_id = db.Column(db.Integer, db.ForeignKey("fridges.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    kind = db.Column(db.String(20), nullable=False)
    # Temperatura, ktora otworzyla alarm (dla awarii NULL)
    value = db.Column(db.Float, nullable=True)
    # Epoch UTC
    started_at = db.Column(db.BigInteger, nullable=False)
    ended_at = db.Column(db.BigInteger, nullable=True)

    __table_args__ = (
        db.Index("ix_alerts_fridge_kind_active", "fridge_id", "kind", "ended_at"),
    )
