import threading
import logging
from app import create_app
from app.services.mqtt_service import start_mqtt_client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = create_app()

if __name__ == "__main__":
    print("--- START SYSTEMU ---")

    mqtt_thread = threading.Thread(target=start_mqtt_client, args=(app,))
    mqtt_thread.daemon = True
    mqtt_thread.start()
    
    if mqtt_thread.is_alive():
        print("--- Wątek MQTT uruchomiony ---")
    else:
        print("!!! BŁĄD: Wątek MQTT nie wystartował !!!")

    PORT = 5000
    
    app.run(host='0.0.0.0', port=PORT, debug=False)