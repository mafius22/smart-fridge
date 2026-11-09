from app.extensions import db

# Alarmy temperatury - osobno dla kazdego uzytkownika (wlasne progi)
KIND_HIGH = "high"
KIND_LOW = "low"
# Awarie - wspolne dla lodowki (user_id = NULL)
KIND_SENSOR_ERROR = "sensor_error"      # odczyt -127
KIND_SENSOR_MISSING = "sensor_missing"  # sonda zniknela ze status.sensors
KIND_OFFLINE = "offline"                # brak wiadomosci od plytki

TEMPERATURE_KINDS = (KIND_HIGH, KIND_LOW)
FAULT_KINDS = (KIND_SENSOR_ERROR, KIND_SENSOR_MISSING, KIND_OFFLINE)

# Powod zamkniecia - historia odroznia powrot do normy od zamkniecia "administracyjnego"
END_NORMAL = "normal"                   # temperatura wrocila do normy / awaria minela
END_PREFS = "prefs_changed"             # uzytkownik wylaczyl powiadomienie albo usunal prog
END_ACCESS = "access_removed"           # odebrany dostep do lodowki
END_SENSOR = "sensor_changed"           # przepiety lub odpiety czujnik
END_FRIDGE = "fridge_disabled"          # lodowka wylaczona
END_BOARD = "board_disabled"            # plytka wylaczona
END_USER = "user_blocked"               # konto zablokowane
END_OUTAGE = "outage"                   # przekroczenie odtworzone z bufora po przerwie w lacznosci


class Alert(db.Model):
    """
    Okres alarmu. Aktywny = ended_at NULL.
    notified_at NULL przy aktywnym alarmie = przekroczenie trwa krocej niz opoznienie uzytkownika (bez push).
    """
    __tablename__ = "alerts"

    id = db.Column(db.Integer, primary_key=True)
    fridge_id = db.Column(db.Integer, db.ForeignKey("fridges.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True, index=True)
    kind = db.Column(db.String(20), nullable=False)
    # Temperatura, ktora otworzyla alarm (dla awarii NULL) i prog uzytkownika w tej chwili
    value = db.Column(db.Float, nullable=True)
    threshold = db.Column(db.Float, nullable=True)
    # Epoch UTC
    started_at = db.Column(db.BigInteger, nullable=False)
    notified_at = db.Column(db.BigInteger, nullable=True)
    ended_at = db.Column(db.BigInteger, nullable=True)
    end_reason = db.Column(db.String(20), nullable=True)
    # Tylko offline: kiedy sprawdzono pomiary z bufora z czasu przerwy
    summary_at = db.Column(db.BigInteger, nullable=True)

    __table_args__ = (
        db.Index("ix_alerts_fridge_kind_active", "fridge_id", "kind", "ended_at"),
        db.Index("ix_alerts_fridge_started", "fridge_id", "started_at"),
    )


# Najwyzej jeden aktywny alarm danego rodzaju na lodowke i uzytkownika (awarie: user_id NULL -> 0)
db.Index(
    "uq_alerts_one_active",
    Alert.fridge_id, Alert.kind, db.func.coalesce(Alert.user_id, 0),
    unique=True,
    sqlite_where=Alert.ended_at.is_(None),
    postgresql_where=Alert.ended_at.is_(None),
)
