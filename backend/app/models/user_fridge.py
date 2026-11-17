from app.extensions import db
from app.utils import utcnow


class Folder(db.Model):
    """Prywatny folder uzytkownika do grupowania lodowek (bez zagniezdzania)."""
    __tablename__ = "folders"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    name = db.Column(db.String(50), nullable=False)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    user = db.relationship("User", back_populates="folders")

    __table_args__ = (
        db.UniqueConstraint("user_id", "name"),
    )


class UserFridge(db.Model):
    """
    Dostep uzytkownika do lodowki + jego wlasne ustawienia.
    Dla roli user wiersz = dostep. Admin widzi wszystko z roli, wiersz trzyma tylko jego ustawienia.
    """
    __tablename__ = "user_fridges"

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), primary_key=True)
    fridge_id = db.Column(db.Integer, db.ForeignKey("fridges.id"), primary_key=True)

    custom_name = db.Column(db.String(100), nullable=True)
    # Jedna kolumna = lodowka w co najwyzej jednym folderze uzytkownika
    folder_id = db.Column(db.Integer, db.ForeignKey("folders.id"), nullable=True)

    min_temp = db.Column(db.Float, nullable=True)
    max_temp = db.Column(db.Float, nullable=True)
    notify_low = db.Column(db.Boolean, nullable=False, default=True)
    notify_high = db.Column(db.Boolean, nullable=False, default=True)
    notify_fault = db.Column(db.Boolean, nullable=False, default=True)
    # Powiadomienie o temperaturze dopiero, gdy przekroczenie trwa tyle minut (odszranianie, otwarte drzwi); 0 = od razu
    alert_delay_min = db.Column(db.Integer, nullable=False, default=0, server_default="0")

    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    user = db.relationship("User", back_populates="fridge_links")
    fridge = db.relationship("Fridge", back_populates="user_links")
    folder = db.relationship("Folder")
