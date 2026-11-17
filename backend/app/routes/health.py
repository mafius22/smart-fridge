from flask import jsonify
from sqlalchemy import text

from app.extensions import db
from . import api_bp


@api_bp.route("/health", methods=["GET"])
def health():
    db.session.execute(text("SELECT 1"))
    return jsonify({"status": "ok"})
