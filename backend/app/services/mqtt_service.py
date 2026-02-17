import os
import json
import logging
import time
import paho.mqtt.client as mqtt
from app.services.worker import save_measurement_direct, preload_cache

logger = logging.getLogger(__name__)

def start_mqtt_client(app):
    broker = os.getenv("MQTT_BROKER", "127.0.0.1")
    port = int(os.getenv("MQTT_PORT", 1883))
    
    topic = os.getenv("MQTT_TOPIC", "esp32/smartfridge/+/data")

    preload_cache(app)

    def on_connect(client, userdata, flags, rc, properties=None):
        if rc == 0:
            logger.info(f"✅ MQTT połączono: {broker}:{port}")
            client.subscribe(topic)
            logger.info(f"📡 Nasłuchiwanie na kanale: {topic}")
        else:
            logger.error(f"❌ Błąd połączenia MQTT: {rc}")

    def on_message(client, userdata, msg):
        """
        Callback obsługujący wiadomość.
        """
        application = userdata
        
        try:
            topic_parts = msg.topic.split('/')
            
            if len(topic_parts) < 3: 
                logger.warning(f"Ignorowanie dziwnego tematu: {msg.topic}")
                return

            device_id_from_topic = topic_parts[2]
            
            payload = msg.payload.decode()
            data = json.loads(payload)
            
            MIN_VALID_TIMESTAMP = 1704067200 

            esp_timestamp = data.get("ts")

            if esp_timestamp and int(esp_timestamp) > MIN_VALID_TIMESTAMP:
                ts = int(esp_timestamp)
            else:
                logger.warning(f"⚠️ Wykryto błędny czas z ESP ({esp_timestamp}). Nadpisuję czasem serwera.")
                ts = int(time.time())

            item = {
                'dev': device_id_from_topic,
                'ts': ts,
                'temp': float(data.get("temp", 0.0)),
                'press': float(data.get("press", 0.0))
            }

            logger.info(f"📥 Dane: {item}")
            save_measurement_direct(application, item)

        except json.JSONDecodeError:
            logger.error(f"Błąd: Odebrano niepoprawny JSON: {msg.payload}")
        except Exception as e:
            logger.error(f"Błąd przetwarzania wiadomości MQTT: {e}")

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    except AttributeError:
        client = mqtt.Client()

    client.tls_set() 
        
    user = os.getenv("MQTT_LOGIN")
    passwd = os.getenv("MQTT_PASS")
    if user and passwd:
        client.username_pw_set(user, passwd)

    client.user_data_set(app)
    
    client.on_connect = on_connect
    client.on_message = on_message

    try:
        logger.info(f"Łączenie z brokerem MQTT ({broker}:{port})...")
        client.connect(broker, port, 60)
        client.loop_start()
        
    except Exception as e:
        logger.critical(f"❌ Nie można połączyć z MQTT: {e}")