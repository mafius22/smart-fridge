import logging
from datetime import datetime
from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError
from app.extensions import db
from app.models import Device, Measurement, PushSubscriber, SubscriberDeviceSettings
from app.services.push_service import send_alert 

logger = logging.getLogger(__name__)

known_devices_cache = set()

class MeasurementService:
    
    @staticmethod
    def get_latest_for_device(device_id):
        """Pobiera ostatni pomiar dla urządzenia"""
        return Measurement.query.filter_by(device_id=device_id)\
            .order_by(Measurement.esp_timestamp.desc())\
            .first()

    @staticmethod
    def get_measurements_in_range(start_date, end_date, device_id=None):
        """Pobiera historię z opcjonalnym filtrem urządzenia"""
        
        start_ts = int(start_date.timestamp())
        end_ts = int(end_date.timestamp())

        query = Measurement.query.filter(
            Measurement.esp_timestamp >= start_ts,
            Measurement.esp_timestamp <= end_ts
        )
        
        if device_id and device_id != "ALL":
            query = query.filter(Measurement.device_id == device_id)
            
        return query.order_by(Measurement.esp_timestamp.asc()).all()

def preload_cache(app):
    """Wczytuje istniejące urządzenia do RAM przy starcie aplikacji."""
    with app.app_context():
        try:
            devices = db.session.query(Device.id).all()
            for d in devices:
                known_devices_cache.add(d[0])
            logger.info(f"Cache urządzeń załadowany: {len(known_devices_cache)} szt.")
        except Exception as e:
            logger.warning(f"Nie udało się załadować cache urządzeń: {e}")

def _get_or_create_device(app, device_id):
    """
    Sprawdza RAM -> DB -> Tworzy nowe urządzenie.
    Jeśli tworzy nowe, automatycznie przypisuje je do wszystkich subskrybentów.
    """
    if device_id in known_devices_cache:
        return

    with app.app_context():
        device = db.session.get(Device, device_id)
        if device:
            known_devices_cache.add(device_id)
            return

        try:
            logger.info(f"Wykryto nowe urządzenie: {device_id} - Rejestracja...")
            
            new_dev = Device(
                id=device_id,
                name=f"{device_id}",
                location="Nieznana"
            )
            db.session.add(new_dev)
            
            all_subscribers = db.session.query(PushSubscriber).all()
            DEFAULT_THRESHOLD = 8.0 
            
            for sub in all_subscribers:
                settings = SubscriberDeviceSettings(
                    subscriber_id=sub.id,
                    device_id=new_dev.id,
                    custom_threshold=DEFAULT_THRESHOLD
                )
                db.session.add(settings)
                logger.info(f"Przypisano nowe urządzenie {device_id} do subskrybenta {sub.id}")

            db.session.commit()
            known_devices_cache.add(device_id)

        except IntegrityError:
            db.session.rollback()
            known_devices_cache.add(device_id)
        except Exception as e:
            logger.error(f"Błąd tworzenia urządzenia {device_id}: {e}")
            db.session.rollback()

def save_measurement_direct(app, item):
    """
    Zapisuje pomiar i uruchamia sprawdzanie alertów.
    """
    try:
        _get_or_create_device(app, item['dev'])

        with app.app_context():
            stmt = insert(Measurement).values(
                device_id=item['dev'],
                esp_timestamp=item['ts'],
                temperature=item['temp'],
                pressure=item['press']
            )
            db.session.execute(stmt)
            
            db.session.commit()
            
            device_obj = db.session.get(Device, item['dev'])
            
            if device_obj:
                send_alert(item['temp'], device_obj, app)

    except Exception as e:
        logger.error(f"Błąd zapisu bezpośredniego: {e}")