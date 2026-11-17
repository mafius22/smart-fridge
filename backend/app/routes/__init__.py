from flask import Blueprint

api_bp = Blueprint('api', __name__)

from . import health, auth, fridges, folders, push, admin  # noqa: E402,F401
