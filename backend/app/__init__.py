from flask import Flask
from flask_cors import CORS

from app.api_utils import register_error_handlers
from app.config import get_config
from app.extensions import db, jwt, limiter, migrate


def create_app(config_name=None):
    config = get_config(config_name)

    for key in getattr(config, "REQUIRED", ()):
        if not getattr(config, key, None):
            raise RuntimeError(f"Brak wymaganej zmiennej srodowiskowej: {key}")

    app = Flask(__name__)
    app.config.from_object(config)

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    limiter.init_app(app)

    # Tylko znane adresy frontendu; ciasteczka sesji wymagaja supports_credentials
    CORS(app, origins=app.config["CORS_ORIGINS"], supports_credentials=True)

    from app import models  # noqa: F401 - rejestracja modeli dla migracji
    from app import auth  # noqa: F401 - rejestracja callbackow JWT

    from app.routes import api_bp
    app.register_blueprint(api_bp, url_prefix='/api')
    register_error_handlers(app)

    from app.cli import register_cli
    register_cli(app)

    return app
