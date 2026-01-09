import logging
from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError
from app.extensions import db
from app.models import Device, Measurement
from app.services.push_service import send_alert
from app.services.measurement_service import _get_or_create_device 

logger = logging.getLogger(__name__)

# RAM CACHE
known_devices_cache = set()

def preload_cache(app):
    """Wczytuje istniejące urządzenia do RAM."""
    with app.app_context():
        try:
            devices = db.session.query(Device.id).all()
            for d in devices:
                known_devices_cache.add(d[0])
            logger.info(f"Cache urządzeń załadowany: {len(known_devices_cache)} szt.")
        except Exception as e:
            logger.warning(f"Nie udało się załadować cache urządzeń: {e}")


def save_measurement_direct(app, item):
    """
    Zapisuje pomiar i uruchamia sprawdzanie alertów dla konkretnych subskrybentów.
    """
    try:
        # 1. Auto-Discovery (czy urządzenie istnieje w tabeli Devices?)
        _get_or_create_device(app, item['dev'])

        # 2. Bezpośredni zapis do bazy + Alerting
        with app.app_context():
            # A. Zapis pomiaru
            stmt = insert(Measurement).values(
                device_id=item['dev'],
                esp_timestamp=item['ts'],
                temperature=item['temp'],
                pressure=item['press']
            )
            db.session.execute(stmt)
            
            # B. Pobranie OBIEKTU urządzenia
            # Musimy to zrobić w tej samej sesji, żeby przekazać obiekt do send_alert
            # item['dev'] to string (np. "esp32_01"), a my potrzebujemy obiektu Device
            device_obj = db.session.get(Device, item['dev'])
            
            db.session.commit()
            
            print(f"[{item['dev']}] Zapisano: {item['temp']}°C")

            # 3. Sprawdzenie alertów
            # Przekazujemy teraz device_obj (obiekt SQLAlchem), a nie stringa
            if device_obj:
                send_alert(item['temp'], device_obj, app)
            else:
                logger.warning(f"Nie znaleziono urządzenia {item['dev']} podczas wysyłania alertu")

    except Exception as e:
        logger.error(f"Błąd zapisu bezpośredniego: {e}")