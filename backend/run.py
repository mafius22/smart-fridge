import threading
import logging # <--- 1. Dodaj import
from app import create_app
from app.services.mqtt_service import start_mqtt_client

# 2. Skonfiguruj logowanie PRZED wszystkim innym
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = create_app()

if __name__ == "__main__":
    print("--- START SYSTEMU ---") # Zwykły print dla pewności

    # Przekazujemy app do wątku MQTT
    mqtt_thread = threading.Thread(target=start_mqtt_client, args=(app,))
    mqtt_thread.daemon = True
    mqtt_thread.start()
    
    # Sprawdź czy wątek ruszył
    if mqtt_thread.is_alive():
        print("--- Wątek MQTT uruchomiony ---")
    else:
        print("!!! BŁĄD: Wątek MQTT nie wystartował !!!")

    app.run(host='0.0.0.0', port=5000, debug=False)