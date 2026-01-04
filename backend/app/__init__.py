from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from dotenv import load_dotenv
import os

# 1. Inicjalizacja globalna (bez przypisania do konkretnej apki jeszcze)
db = SQLAlchemy()

def create_app():
    # Ładujemy zmienne .env
    load_dotenv()

    app = Flask(__name__)
    
    # 2. Konfiguracja
    # check_same_thread=False jest potrzebne dla SQLite przy pracy z MQTT
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv("DATABASE_URL", "sqlite:///smartfridge.db")
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    # 3. Podpięcie wtyczek do aplikacji
    db.init_app(app)
    CORS(app)

    # 4. Import i rejestracja Blueprintów (Tras)
    from app.routes.api import api_bp
    app.register_blueprint(api_bp, url_prefix='/api')

    # 5. Tworzenie tabel (tylko jeśli nie istnieją)
    with app.app_context():
        from app.models import measurement, subscriber  # Importujemy, żeby SQLAlchemy je widziało
        db.create_all()

    return app