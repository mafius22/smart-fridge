from app import db
from app.models.subscriber import PushSubscriber
from sqlalchemy.exc import SQLAlchemyError

class SubscriberService:
    @staticmethod
    def register_new_subscriber(endpoint, p256dh, auth):
        """
        Logika biznesowa: Sprawdza duplikat, zapisuje w bazie.
        Zwraca: (success: bool, message: str, status_code: int)
        """
        try:
            exists = PushSubscriber.query.filter_by(endpoint=endpoint).first()
            
            if exists:
                return True, "Użytkownik już zapisany", 200

            new_sub = PushSubscriber(
                endpoint=endpoint,
                p256dh=p256dh,
                auth=auth
            )
            
            db.session.add(new_sub)
            db.session.commit()
            
            return True, "Zapisano pomyślnie", 201

        except SQLAlchemyError as e:
            db.session.rollback()
            return False, f"Błąd bazy danych: {str(e)}", 500
        except Exception as e:
            return False, f"Nieoczekiwany błąd: {str(e)}", 500
    
    
    @staticmethod
    def update_subscriber_settings(endpoint, is_active, threshold):
        """
        Aktualizuje ustawienia subskrybenta.
        """
        sub = PushSubscriber.query.filter_by(endpoint=endpoint).first()
        
        if not sub:
            return False, "Nie znaleziono subskrybenta"

        try:
            # Aktualizujemy pola tylko jeśli podano nowe wartości
            if is_active is not None:
                sub.is_active = is_active
            if threshold is not None:
                sub.custom_threshold = threshold
            
            db.session.commit()
            return True, "Zaktualizowano ustawienia"
            
        except Exception as e:
            db.session.rollback()
            return False, str(e)