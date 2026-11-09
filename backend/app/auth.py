from functools import wraps

from flask_jwt_extended import current_user, verify_jwt_in_request

from app.api_utils import ApiError, error_response
from app.extensions import db, jwt
from app.models import User


@jwt.user_lookup_loader
def _load_user(jwt_header, jwt_data):
    user = db.session.get(User, int(jwt_data["sub"]))
    # Dezaktywowane konto albo token sprzed zmiany hasla -> 401
    if user is None or not user.is_active or jwt_data.get("ver") != user.token_version:
        return None
    return user


@jwt.additional_claims_loader
def _claims(user):
    return {"ver": user.token_version}


@jwt.user_identity_loader
def _identity(user):
    return str(user.id)


@jwt.unauthorized_loader
def _unauthorized(reason):
    return error_response("Wymagane logowanie", 401, "unauthorized")


@jwt.expired_token_loader
def _expired(jwt_header, jwt_data):
    return error_response("Sesja wygasła", 401, "token_expired")


@jwt.invalid_token_loader
def _invalid(reason):
    return error_response("Nieprawidłowa sesja", 401, "invalid_token")


@jwt.user_lookup_error_loader
def _lookup_error(jwt_header, jwt_data):
    return error_response("Sesja nieważna - zaloguj się ponownie", 401, "invalid_token")


def login_required(fn=None, *, allow_pending_password=False):
    """
    Wymaga zalogowania. Konto z haslem startowym (must_change_password) ma dostep tylko do
    endpointow oznaczonych allow_pending_password=True.
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            if current_user.must_change_password and not allow_pending_password:
                raise ApiError("Najpierw zmień hasło startowe", 403, "password_change_required")
            return f(*args, **kwargs)
        return wrapper

    return decorator(fn) if fn else decorator


def admin_required(f):
    @wraps(f)
    @login_required
    def wrapper(*args, **kwargs):
        if not current_user.is_admin:
            raise ApiError("Brak uprawnień", 403, "forbidden")
        return f(*args, **kwargs)
    return wrapper
