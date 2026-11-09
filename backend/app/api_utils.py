import math

from flask import jsonify, request


class ApiError(Exception):
    """Blad zwracany klientowi jako JSON {"error": ..., "code": ...}."""

    def __init__(self, message, status=400, code=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def error_response(message, status, code=None):
    body = {"error": message}
    if code:
        body["code"] = code
    return jsonify(body), status


def not_found(what="Nie znaleziono"):
    return ApiError(what, 404, "not_found")


def get_json():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Wymagany obiekt JSON", 400, "invalid_json")
    return data


def get_str(data, key, max_len, required=False, allow_none=False):
    """Tekst przyciety ze spacji. Brak klucza -> None (dla PATCH: pole bez zmian)."""
    if key not in data:
        if required:
            raise ApiError(f"Brak pola: {key}", 400, "validation")
        return None
    value = data[key]
    if value is None and allow_none:
        return None
    if not isinstance(value, str):
        raise ApiError(f"Pole {key} musi być tekstem", 400, "validation")
    value = value.strip()
    if not value and not allow_none:
        raise ApiError(f"Pole {key} nie może być puste", 400, "validation")
    if len(value) > max_len:
        raise ApiError(f"Pole {key} może mieć maks. {max_len} znaków", 400, "validation")
    return value or None


def get_float(data, key, lo, hi):
    """Liczba albo null. Wywolywac tylko, gdy key in data."""
    value = data[key]
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ApiError(f"Pole {key} musi być liczbą", 400, "validation")
    if not lo <= value <= hi:
        raise ApiError(f"Pole {key} musi być w zakresie {lo}..{hi}", 400, "validation")
    return float(value)


def get_int(data, key, lo, hi):
    """Liczba calkowita z body. Wywolywac tylko, gdy key in data."""
    value = data[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise ApiError(f"Pole {key} musi być liczbą całkowitą", 400, "validation")
    if not lo <= value <= hi:
        raise ApiError(f"Pole {key} musi być w zakresie {lo}..{hi}", 400, "validation")
    return value


def get_bool(data, key):
    value = data[key]
    if not isinstance(value, bool):
        raise ApiError(f"Pole {key} musi być true/false", 400, "validation")
    return value


def get_int_arg(name, default=None, lo=None, hi=None):
    raw = request.args.get(name)
    if raw is None or raw == "":
        if default is None:
            raise ApiError(f"Brak parametru: {name}", 400, "validation")
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ApiError(f"Parametr {name} musi być liczbą całkowitą", 400, "validation")
    if (lo is not None and value < lo) or (hi is not None and value > hi):
        raise ApiError(f"Parametr {name} poza zakresem", 400, "validation")
    return value


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def handle_api_error(e):
        from app.extensions import db
        db.session.rollback()
        return error_response(e.message, e.status, e.code)

    @app.errorhandler(404)
    def handle_404(e):
        return error_response("Nie znaleziono", 404, "not_found")

    @app.errorhandler(405)
    def handle_405(e):
        return error_response("Metoda niedozwolona", 405, "method_not_allowed")

    @app.errorhandler(429)
    def handle_429(e):
        return error_response("Za dużo prób. Spróbuj ponownie później.", 429, "rate_limited")

    @app.errorhandler(500)
    def handle_500(e):
        return error_response("Błąd serwera", 500, "server_error")
