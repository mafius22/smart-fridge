from werkzeug.security import check_password_hash, generate_password_hash

from app.extensions import db
from app.utils import utcnow

ROLE_ADMIN = "admin"
ROLE_USER = "user"
ROLES = (ROLE_ADMIN, ROLE_USER)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(10), nullable=False, default=ROLE_USER)
    display_name = db.Column(db.String(100), nullable=True)

    is_active = db.Column(db.Boolean, nullable=False, default=True)
    # Konto zalozone przez admina: haslo startowe trzeba zmienic przy pierwszym logowaniu
    must_change_password = db.Column(db.Boolean, nullable=False, default=True)
    # Glowny wylacznik push dla konta (alarmy i tak zapisuja sie w bazie)
    notifications_enabled = db.Column(db.Boolean, nullable=False, default=True)
    # Zmiana hasla / dezaktywacja podbija wersje - stare tokeny przestaja dzialac
    token_version = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    folders = db.relationship("Folder", back_populates="user", cascade="all, delete-orphan")
    fridge_links = db.relationship("UserFridge", back_populates="user", cascade="all, delete-orphan")
    push_subscriptions = db.relationship("PushSubscription", back_populates="user", cascade="all, delete-orphan")

    @property
    def is_admin(self):
        return self.role == ROLE_ADMIN

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f"<User {self.email} ({self.role})>"
