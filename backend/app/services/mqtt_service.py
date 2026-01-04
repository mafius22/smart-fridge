import os
import json
import logging
import paho.mqtt.client as mqtt
from app import db
from app.models.measurement import Measurement
from app.services.push_service import send_alert_to_all

logger = logging.getLogger(__name__)

ALARM_THRESHOLD = 30.0

def start_mqtt_client(app):
    broker = os.getenv("MQTT_BROKER", "localhost")
    port = int(os.getenv("MQTT_PORT", 1883))
    topic = os.getenv("MQTT_TOPIC", "esp32/smartfridge/data")

    def on_connect(client, userdata, flags, rc, properties=None):
        if rc == 0:
            logger.info(f"MQTT połączono: {broker}")
            client.subscribe(topic)
        else:
            logger.error(f"Błąd MQTT: {rc}")

    def on_message(client, userdata, msg):
        try:
            payload = msg.payload.decode()
            data = json.loads(payload)
            
            temp = float(data.get("temp", 0))
            press = float(data.get("press", 0))
            ts = int(data.get("ts", 0))

            with app.app_context():
                new_m = Measurement(esp_timestamp=ts, temperature=temp, pressure=press)
                db.session.add(new_m)
                db.session.commit()
                print(f"Zapisano: {temp}")

                if temp > ALARM_THRESHOLD:
                    send_alert_to_all(temp, app)

        except Exception as e:
            logger.error(f"Błąd w on_message: {e}")

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    except AttributeError:
        client = mqtt.Client()

    user = os.getenv("MQTT_USER")
    passwd = os.getenv("MQTT_PASS")
    if user and passwd:
        client.username_pw_set(user, passwd)

    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(broker, port, 60)
        client.loop_forever()
    except Exception as e:
        logger.critical(f"Nie można połączyć z MQTT: {e}")