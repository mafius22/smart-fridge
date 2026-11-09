from app.api_utils import not_found
from app.extensions import db
from app.models import Fridge, UserFridge


def accessible_fridges_query(user):
    """Admin: wszystkie lodowki. Uzytkownik: aktywne lodowki z nadanym dostepem."""
    query = db.session.query(Fridge)
    if not user.is_admin:
        query = query.join(UserFridge, UserFridge.fridge_id == Fridge.id).filter(
            UserFridge.user_id == user.id, Fridge.is_active.is_(True)
        )
    return query


def get_accessible_fridge(user, fridge_id):
    """Lodowka albo 404 - cudza lodowka wyglada tak samo jak nieistniejaca."""
    fridge = accessible_fridges_query(user).filter(Fridge.id == fridge_id).first()
    if fridge is None:
        raise not_found("Nie znaleziono lodówki")
    return fridge


def get_prefs(user_id, fridge_id):
    return db.session.get(UserFridge, (user_id, fridge_id))


def get_or_create_prefs(user, fridge_id):
    prefs = get_prefs(user.id, fridge_id)
    if prefs is None:
        # Dla roli user wiersz zawsze istnieje (= dostep); tu trafia tylko admin
        prefs = UserFridge(user_id=user.id, fridge_id=fridge_id)
        db.session.add(prefs)
    return prefs
