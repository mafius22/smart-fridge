from flask import Flask
from flask_cors import CORS
from flask_migrate import Migrate
from dotenv import load_dotenv
import os

# Importujemy db z extensions, żeby uniknąć błędów "circular import"
from app.extensions import db

# Inicjalizacja obiektu migracji
migrate = Migrate()

def create_app():
    # 1. Ładowanie zmiennych środowiskowych (.env) dla środowiska lokalnego
    load_dotenv()

    app = Flask(__name__)
    
    # 2. KONFIGURACJA BAZY DANYCH
    # Pobieramy adres z systemu (produkcja) lub domyślny lokalny (SQLite)
    database_url = os.getenv("DATABASE_URL", "sqlite:///smartfridge.db")

    # --- FIX DLA RENDER / RAILWAY / HEROKU ---
    # Nowe SQLAlchemy wymaga protokołu "postgresql://", a chmury często dają "postgres://"
    if database_url and database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.getenv("SECRET_KEY", "dev-secret-key-zmien-to-na-produkcji")
    
    # 3. INICJALIZACJA ROZSZERZEŃ
    db.init_app(app)
    migrate.init_app(app, db)
    
    # Konfiguracja CORS 
    # (lokalnie pozwala na wszystko, na produkcji warto tu potem dodać domenę frontu)
    CORS(app)

    # 4. IMPORT MODELI I REJESTRACJA BLUEPRINTÓW
    # Importujemy modele wewnątrz kontekstu aplikacji lub fabryki, 
    # aby Flask-Migrate na pewno je "widział" przy generowaniu migracji.
    from app import models 

    from app.routes import api_bp
    app.register_blueprint(api_bp, url_prefix='/api')

    return app