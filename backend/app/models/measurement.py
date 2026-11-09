from app.extensions import db

# SQLite nadaje autoinkrementacje tylko kolumnie INTEGER
BigIntId = db.BigInteger().with_variant(db.Integer(), "sqlite")


class Measurement(db.Model):
    __tablename__ = "measurements"

    id = db.Column(BigIntId, primary_key=True)
    sensor_id = db.Column(db.String(16), db.ForeignKey("sensors.id"), nullable=False)
    # Lodowka z przypisania obowiazujacego w chwili pomiaru (NULL = czujnik nieprzypisany)
    fridge_id = db.Column(db.Integer, db.ForeignKey("fridges.id"), nullable=True)

    # Epoch UTC z plytki; czas serwera, gdy plytka nie miala czasu (ts_from_server = True)
    ts = db.Column(db.BigInteger, nullable=False)
    ts_from_server = db.Column(db.Boolean, nullable=False, default=False)
    temperature = db.Column(db.Float, nullable=False)
    received_at = db.Column(db.BigInteger, nullable=False)

    __table_args__ = (
        # Plytka moze wyslac paczke ponownie (restart w trakcie wysylki bufora)
        db.UniqueConstraint("sensor_id", "ts"),
        db.Index("ix_measurements_fridge_ts", "fridge_id", "ts"),
    )
