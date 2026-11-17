from flask import jsonify
from flask_jwt_extended import current_user
from sqlalchemy import func

from app.api_utils import ApiError, get_json, get_str, not_found
from app.auth import login_required
from app.extensions import db
from app.models import Folder, UserFridge
from . import api_bp


def folder_to_dict(folder):
    return {"id": folder.id, "name": folder.name, "sort_order": folder.sort_order}


def _own_folder(folder_id):
    folder = db.session.get(Folder, folder_id)
    # Cudzy folder wyglada jak nieistniejacy
    if folder is None or folder.user_id != current_user.id:
        raise not_found("Nie znaleziono folderu")
    return folder


def _ensure_unique(name, exclude_id=None):
    query = Folder.query.filter(Folder.user_id == current_user.id, func.lower(Folder.name) == name.lower())
    if exclude_id is not None:
        query = query.filter(Folder.id != exclude_id)
    if query.first():
        raise ApiError("Folder o tej nazwie już istnieje", 409, "duplicate")


@api_bp.route("/folders", methods=["GET"])
@login_required
def list_folders():
    folders = Folder.query.filter_by(user_id=current_user.id).order_by(Folder.sort_order, Folder.name).all()
    return jsonify({"folders": [folder_to_dict(f) for f in folders]})


@api_bp.route("/folders", methods=["POST"])
@login_required
def create_folder():
    data = get_json()
    name = get_str(data, "name", 50, required=True)
    _ensure_unique(name)
    max_order = db.session.query(func.max(Folder.sort_order)).filter_by(user_id=current_user.id).scalar()
    folder = Folder(user_id=current_user.id, name=name, sort_order=(max_order or 0) + 1)
    db.session.add(folder)
    db.session.commit()
    return jsonify({"folder": folder_to_dict(folder)}), 201


@api_bp.route("/folders/<int:folder_id>", methods=["PATCH"])
@login_required
def update_folder(folder_id):
    folder = _own_folder(folder_id)
    data = get_json()
    if "name" in data:
        name = get_str(data, "name", 50, required=True)
        _ensure_unique(name, exclude_id=folder.id)
        folder.name = name
    if "sort_order" in data:
        if not isinstance(data["sort_order"], int) or isinstance(data["sort_order"], bool):
            raise ApiError("Pole sort_order musi być liczbą całkowitą", 400, "validation")
        folder.sort_order = data["sort_order"]
    db.session.commit()
    return jsonify({"folder": folder_to_dict(folder)})


@api_bp.route("/folders/<int:folder_id>", methods=["DELETE"])
@login_required
def delete_folder(folder_id):
    folder = _own_folder(folder_id)
    # Lodowki z folderu trafiaja do "Bez folderu"
    UserFridge.query.filter_by(user_id=current_user.id, folder_id=folder.id).update({"folder_id": None})
    db.session.delete(folder)
    db.session.commit()
    return jsonify({"message": "Usunięto folder"})
