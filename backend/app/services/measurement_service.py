import logging
from datetime import datetime
from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError
from app.extensions import db
from app.models import Device, Measurement, PushSubscriber, SubscriberDeviceSettings
from app.services.push_service import send_alert 

logger = logging.getLogger(__name__)

# Cache w RAM, żeby nie pytać bazy o ID urządzenia przy każdym requescie
known_devices_cache = set()

class MeasurementService:
    
    @staticmethod
    def get_latest_for_device(device_id):
        """Pobiera ostatni pomiar dla urządzenia (wg czasu ESP)"""
        # ZMIANA: Sortujemy po esp_timestamp zamiast timestamp
        return Measurement.query.filter_by(device_id=device_id)\
            .order_by(Measurement.esp_timestamp.desc())\
            .first()

    @staticmethod
    def get_measurements_in_range(start_date, end_date, device_id=None):
        """Pobiera historię z opcjonalnym filtrem urządzenia (wg czasu ESP)"""
        
        # ZMIANA: Konwersja obiektu datetime na Unix Timestamp (int), 
        # ponieważ kolumna esp_timestamp w bazie to BigInteger.
        start_ts = int(start_date.timestamp())
        end_ts = int(end_date.timestamp())

        query = Measurement.query.filter(
            Measurement.esp_timestamp >= start_ts,
            Measurement.esp_timestamp <= end_ts
        )
        
        if device_id and device_id != "ALL":
            query = query.filter(Measurement.device_id == device_id)
            
        # ZMIANA: Sortowanie rosnąco po czasie ESP
        # Zwraca listę obiektów Measurement, więc frontend dostanie to samo co wcześniej (przez to_dict)
        return query.order_by(Measurement.esp_timestamp.asc()).all()

# --- Funkcje pomocnicze dla MQTT/HTTP POST ---

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
        # 1. Sprawdzenie w bazie (dla pewności, jeśli cache jest pusty po restarcie)
        device = db.session.get(Device, device_id)
        if device:
            known_devices_cache.add(device_id)
            return

        # 2. Tworzenie nowego urządzenia
        try:
            logger.info(f"🆕 Wykryto nowe urządzenie: {device_id} - Rejestracja...")
            
            new_dev = Device(
                id=device_id,
                name=f"{device_id}",
                location="Nieznana"
            )
            db.session.add(new_dev)
            
            # --- AUTOMATYCZNE PRZYPISANIE DO SUBSKRYBENTÓW ---
            all_subscribers = db.session.query(PushSubscriber).all()
            DEFAULT_THRESHOLD = 8.0 
            
            for sub in all_subscribers:
                settings = SubscriberDeviceSettings(
                    subscriber_id=sub.id,
                    device_id=new_dev.id,
                    custom_threshold=DEFAULT_THRESHOLD
                )
                db.session.add(settings)
                logger.info(f"➕ Przypisano nowe urządzenie {device_id} do subskrybenta {sub.id}")

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
        # 1. Auto-Discovery
        _get_or_create_device(app, item['dev'])

        # 2. Zapis i Alert
        with app.app_context():
            # ZMIANA: Zapisujemy esp_timestamp (item['ts']) do kolumny esp_timestamp
            stmt = insert(Measurement).values(
                device_id=item['dev'],
                esp_timestamp=item['ts'],  # <--- Unix Timestamp z ESP32
                temperature=item['temp'],
                pressure=item['press']
            )
            db.session.execute(stmt)
            
            db.session.commit()
            
            # 3. Sprawdzenie alertów (jeśli urządzenie istnieje)
            device_obj = db.session.get(Device, item['dev'])
            
            if device_obj:
                send_alert(item['temp'], device_obj, app)

    except Exception as e:
        logger.error(f"Błąd zapisu bezpośredniego: {e}")