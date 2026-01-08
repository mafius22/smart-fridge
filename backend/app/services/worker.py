import logging
from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError
from app import db

from app.models.measurement import Measurement, Device 
from app.services.push_service import send_alert

logger = logging.getLogger(__name__)

# RAM CACHE - Nadal przydatny, by nie pytać bazy o ID urządzenia przy każdym zapisie
known_devices_cache = set()

def preload_cache(app):
    """Wczytuje istniejące urządzenia do RAM. Wywołaj to raz przy starcie aplikacji."""
    with app.app_context():
        try:
            devices = db.session.query(Device.id).all()
            for d in devices:
                known_devices_cache.add(d[0])
            logger.info(f"Cache urządzeń załadowany: {len(known_devices_cache)} szt.")
        except Exception as e:
            logger.warning(f"Nie udało się załadować cache urządzeń: {e}")

def _get_or_create_device(app, device_id):
    """Sprawdza RAM -> DB -> Tworzy nowe urządzenie (Auto-Provisioning)"""
    if device_id in known_devices_cache:
        return

    with app.app_context():
        # Sprawdzamy w bazie
        device = db.session.get(Device, device_id)
        if device:
            known_devices_cache.add(device_id)
            return

        # Tworzymy nowe
        try:
            logger.info(f"🆕 Wykryto nowe urządzenie: {device_id} - Rejestracja...")
            new_dev = Device(
                id=device_id,
                name=f"{device_id}",
                location="Do ustawienia"
            )
            db.session.add(new_dev)
            db.session.commit()
            known_devices_cache.add(device_id)
        except IntegrityError:
            db.session.rollback()
            known_devices_cache.add(device_id)
        except Exception as e:
            logger.error(f"Błąd tworzenia urządzenia {device_id}: {e}")

def save_measurement_direct(app, item):
    """
    Zapisuje pomiar natychmiastowo (bez kolejki).
    Wymaga przekazania obiektu 'app' dla kontekstu bazy danych.
    """
    try:
        # 1. Auto-Discovery (czy urządzenie istnieje?)
        _get_or_create_device(app, item['dev'])

        # 2. Bezpośredni zapis do bazy
        with app.app_context():
            stmt = insert(Measurement).values(
                device_id=item['dev'],
                esp_timestamp=item['ts'],
                temperature=item['temp'],
                pressure=item['press']
            )
            db.session.execute(stmt)
            db.session.commit()
            
            print(f"[{item['dev']}] Zapisano bezpośrednio: {item['temp']}°C")

            # 3. Sprawdzenie alertów (synchronicznie)
            send_alert(item['temp'], item['dev'], app)

    except Exception as e:
        logger.error(f"Błąd zapisu bezpośredniego: {e}")