from app.extensions import db
from app.models import PushSubscriber, Device, SubscriberDeviceSettings

class SubscriberService:
    
    @staticmethod
    def register_new_subscriber(endpoint, p256dh, auth):
        """Rejestruje nowego subskrybenta i przypisuje mu wszystkie istniejące urządzenia."""
        existing = PushSubscriber.query.filter_by(endpoint=endpoint).first()
        if existing:
            # Aktualizujemy klucze jeśli się zmieniły
            existing.p256dh = p256dh
            existing.auth = auth
            existing.is_active = True
            db.session.commit()
            return True, "Zaktualizowano subskrypcję", 200

        # Tworzymy nowego usera
        new_sub = PushSubscriber(
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            is_active=True
        )
        db.session.add(new_sub)
        db.session.flush()  # Nadaje ID nowemu obiektowi przed commitem

        # --- PRZYPISANIE ISTNIEJĄCYCH URZĄDZEŃ ---
        existing_devices = Device.query.all()
        DEFAULT_THRESHOLD = 8.0

        for dev in existing_devices:
            settings = SubscriberDeviceSettings(
                subscriber_id=new_sub.id,
                device_id=dev.id,
                custom_threshold=DEFAULT_THRESHOLD
            )
            db.session.add(settings)
        
        db.session.commit()
        return True, "Zarejestrowano pomyślnie", 201

    @staticmethod
    def update_subscriber_settings(endpoint, is_active=None, threshold=None, device_id=None):
        """Aktualizuje ustawienia globalne lub per urządzenie."""
        sub = PushSubscriber.query.filter_by(endpoint=endpoint).first()
        if not sub:
            return False, "Nie znaleziono subskrybenta"

        # 1. Aktualizacja globalna (włącz/wyłącz powiadomienia w ogóle)
        if is_active is not None:
            sub.is_active = is_active

        # 2. Aktualizacja per urządzenie (zmiana progu)
        if device_id and threshold is not None:
            # Szukamy ustawień dla tego konkretnego urządzenia
            settings = SubscriberDeviceSettings.query.filter_by(
                subscriber_id=sub.id, 
                device_id=device_id
            ).first()
            
            if settings:
                settings.custom_threshold = float(threshold)
            else:
                # Jeśli z jakiegoś powodu brak ustawień, tworzymy je
                new_settings = SubscriberDeviceSettings(
                    subscriber_id=sub.id,
                    device_id=device_id,
                    custom_threshold=float(threshold)
                )
                db.session.add(new_settings)

        db.session.commit()
        return True, "Zaktualizowano ustawienia"

    @staticmethod
    def get_settings_by_endpoint(endpoint):
        """Pobiera ustawienia globalne i listę urządzeń z progami."""
        sub = PushSubscriber.query.filter_by(endpoint=endpoint).first()
        if not sub:
            return None

        # Pobieramy ustawienia dla urządzeń
        devices_settings = []
        for setting in sub.device_settings:
            # setting.device to relacja do obiektu Device
            devices_settings.append({
                "device_id": setting.device.id,
                "device_name": setting.device.name,
                "custom_threshold": setting.custom_threshold
            })

        return {
            "is_active": sub.is_active,
            "devices": devices_settings
        }