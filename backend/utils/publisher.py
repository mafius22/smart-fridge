import json
import time
import random
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import os
from dotenv import load_dotenv

load_dotenv()

BROKER = os.getenv("MQTT_BROKER", "localhost")
PORT = int(os.getenv("MQTT_PORT", 8883))
TOPIC = "esp32/smartfridge/data"
INTERVAL_S = 20

MQTT_USER = os.getenv("MQTT_LOGIN", 8883)
MQTT_PASS = os.getenv("MQTT_PASS", 8883)

def unix_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())

def make_payload() -> dict:
    temp = round(random.uniform(30.0, 38.0), 1)          # przykładowa temp lodówki
    press = random.randint(98000, 103000)              # przykładowe ciśnienie w Pa
    return {"ts": unix_ts(), "temp": temp, "press": press}

def main():
    client = mqtt.Client()
    client.tls_set()

    if MQTT_USER and MQTT_PASS:
        client.username_pw_set(MQTT_USER, MQTT_PASS)

    client.connect(BROKER, PORT, keepalive=60)
    client.loop_start()

    try:
        while True:
            payload = make_payload()
            msg = json.dumps(payload, separators=(",", ":"))
            info = client.publish(TOPIC, msg, qos=1)
            info.wait_for_publish()

            print("Wysłano:", msg)
            time.sleep(INTERVAL_S)
    except KeyboardInterrupt:
        print("\nStop")
    finally:
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()
