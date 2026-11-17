from app.extensions import db
from app.models import User
from app.models.user import ROLES, ROLE_USER

MIN_PASSWORD_LENGTH = 10


def normalize_email(email):
    return (email or "").strip().lower()


def validate_password(password):
    """Zwraca komunikat bledu albo None."""
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        return f"Hasło musi mieć co najmniej {MIN_PASSWORD_LENGTH} znaków"
    return None


def create_user(email, password, role=ROLE_USER, display_name=None, must_change_password=True):
    """Tworzy konto. ValueError z komunikatem dla uzytkownika przy blednych danych."""
    email = normalize_email(email)
    if "@" not in email:
        raise ValueError("Niepoprawny adres e-mail")
    if role not in ROLES:
        raise ValueError(f"Nieznana rola: {role}")
    error = validate_password(password)
    if error:
        raise ValueError(error)
    if db.session.query(User.id).filter_by(email=email).first():
        raise ValueError("Konto z tym adresem już istnieje")

    user = User(
        email=email,
        role=role,
        display_name=display_name,
        must_change_password=must_change_password,
    )
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return user
