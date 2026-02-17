import threading
import logging
from app import create_app
from app.services.mqtt_service import start_mqtt_client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = create_app()

print("--- INICJALIZACJA WSGI (PRODUKCJA) ---")

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
