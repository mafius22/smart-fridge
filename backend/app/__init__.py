from flask import Flask
from flask_cors import CORS
from flask_migrate import Migrate
from dotenv import load_dotenv
import os

from app.extensions import db

migrate = Migrate()

def create_app():
    load_dotenv()

    app = Flask(__name__)
    
    database_url = os.getenv("DATABASE_URL", "sqlite:///smartfridge.db")

    if database_url and database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }

    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.getenv("SECRET_KEY", "dev-secret-key-zmien-to-na-produkcji")
    
    db.init_app(app)
    migrate.init_app(app, db)
    
    CORS(app)

    from app import models 

    from app.routes import api_bp
    app.register_blueprint(api_bp, url_prefix='/api')

    return app