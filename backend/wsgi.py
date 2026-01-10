import threading
import logging
from app import create_app
from app.services.mqtt_service import start_mqtt_client

# Konfiguracja logowania (ważne na produkcji, żeby widzieć co się dzieje w logach)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = create_app()

# --- START MQTT DLA PRODUKCJI ---
# Kod tutaj wykonuje się przy imporcie pliku przez Gunicorn.
# UWAGA: To zadziała poprawnie tylko przy 1 workerze Gunicorna (wyjaśnienie niżej).

print("--- INICJALIZACJA WSGI (PRODUKCJA) ---")

# Sprawdzamy, czy wątek już nie działa (zabezpieczenie przed reloadem)
already_running = False
for thread in threading.enumerate():
    if thread.name == "MQTT_Thread":
        already_running = True
        break

if not already_running:
    print("--- Startowanie wątku MQTT... ---")
    mqtt_thread = threading.Thread(target=start_mqtt_client, args=(app,), name="MQTT_Thread")
    mqtt_thread.daemon = True
    mqtt_thread.start()
else:
    print("--- Wątek MQTT już działa, pomijam start ---")

# Gunicorn szuka zmiennej 'app' w tym pliku