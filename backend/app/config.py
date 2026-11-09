import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()


def _database_url():
    url = os.getenv("DATABASE_URL", "sqlite:///smartfridge.db")
    # Heroku/Render podaja stary prefiks, ktorego SQLAlchemy 2 nie obsluguje
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


class Config:
    SQLALCHEMY_DATABASE_URI = _database_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }

    SECRET_KEY = os.getenv("SECRET_KEY")

    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
    JWT_TOKEN_LOCATION = ["cookies"]
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=7)
    JWT_COOKIE_CSRF_PROTECT = True
    JWT_COOKIE_SAMESITE = "Lax"
    # Na produkcji (HTTPS) ustawic JWT_COOKIE_SECURE=1
    JWT_COOKIE_SECURE = os.getenv("JWT_COOKIE_SECURE", "0") == "1"
    JWT_ACCESS_COOKIE_PATH = "/api/"
    JWT_REFRESH_COOKIE_PATH = "/api/auth/"

    RATELIMIT_STORAGE_URI = "memory://"
    RATELIMIT_HEADERS_ENABLED = True

    MQTT_BROKER = os.getenv("MQTT_BROKER", "127.0.0.1")
    MQTT_PORT = int(os.getenv("MQTT_PORT", 8883))
    MQTT_LOGIN = os.getenv("MQTT_LOGIN")
    MQTT_PASS = os.getenv("MQTT_PASS")
    MQTT_TLS = os.getenv("MQTT_TLS", "1") == "1"
    MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "sf-backend")

    VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
    VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
    VAPID_EMAIL = os.getenv("VAPID_EMAIL")

    ALERT_FRESH_S = 15 * 60
    ALERT_HYSTERESIS = 0.5
    OFFLINE_FACTOR = 3
    DEFAULT_INTERVAL_S = 300


class DevelopmentConfig(Config):
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-nie-uzywac-na-produkcji")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-only-jwt-secret-nie-uzywac-na-produkcji")


class TestingConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret"
    JWT_SECRET_KEY = "test-jwt-secret-o-dlugosci-co-najmniej-32-bajtow"
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    SQLALCHEMY_ENGINE_OPTIONS = {}
    RATELIMIT_ENABLED = False
    VAPID_PRIVATE_KEY = None


class ProductionConfig(Config):
    REQUIRED = ("SECRET_KEY", "JWT_SECRET_KEY")
    JWT_COOKIE_SECURE = os.getenv("JWT_COOKIE_SECURE", "1") == "1"


CONFIGS = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
}


def get_config(name=None):
    name = name or os.getenv("APP_ENV", "development")
    if name not in CONFIGS:
        raise RuntimeError(f"Nieznane APP_ENV: {name} (dozwolone: {', '.join(CONFIGS)})")
    return CONFIGS[name]
