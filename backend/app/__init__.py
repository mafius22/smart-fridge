from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from dotenv import load_dotenv
import os
from flask_migrate import Migrate

db = SQLAlchemy()
migrate = Migrate()

def create_app():
    load_dotenv()

    app = Flask(__name__)
    
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv("DATABASE_URL", "sqlite:///smartfridge.db")
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.getenv("SECRET_KEY", "dev-secret-key")
    
    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app)

    from app.models import measurement, subscriber

    from app.routes.api import api_bp
    app.register_blueprint(api_bp, url_prefix='/api')

    return app