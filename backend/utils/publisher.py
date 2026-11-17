"""
Symulator plytek: wysyla paczki w formacie firmware na sf/v1/{device_id}/data.
Uruchomienie z katalogu backend: python utils/publisher.py
"""
import json
import os
import random
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
from dotenv import load_dotenv

load_dotenv()

BROKER = os.getenv("MQTT_BROKER", "localhost")
PORT = int(os.getenv("MQTT_PORT", 8883))
MQTT_USER = os.getenv("MQTT_LOGIN")
MQTT_PASS = os.getenv("MQTT_PASS")

BASE_TOPIC = "sf/v1"

# device_id plytki -> {sid czujnika: (min, max) temperatury}
BOARDS = {
    "sf-000000000001": {
        "28aa000000000001": (2.0, 6.0),    # lodowka
        "28aa000000000002": (-22.0, -16.0),  # zamrazarka
    },
    "sf-000000000002": {
        "28aa000000000003": (8.0, 12.0),   # chlodziarka do wina
    },
}

INTERVAL_S = 20
# Szansa na odczyt -127 (awaria sondy), do testow alarmow
SENSOR_ERROR_CHANCE = 0.0


def unix_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def make_payload(sensors) -> dict:
    ts = unix_ts()
    readings = []
    for sid, (lo, hi) in sensors.items():
        temp = -127.0 if random.random() < SENSOR_ERROR_CHANCE else round(random.uniform(lo, hi), 2)
        readings.append({"sid": sid, "ts": ts, "temp": temp})
    return {"readings": readings}


def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.tls_set()
    if MQTT_USER and MQTT_PASS:
        client.username_pw_set(MQTT_USER, MQTT_PASS)

    try:
        client.connect(BROKER, PORT, keepalive=60)
        client.loop_start()
        print(f"Połączono z brokerem {BROKER}:{PORT}")
        print(f"Symuluję płytki: {list(BOARDS)}")

        while True:
            for device_id, sensors in BOARDS.items():
                topic = f"{BASE_TOPIC}/{device_id}/data"
                msg = json.dumps(make_payload(sensors), separators=(",", ":"))
                client.publish(topic, msg, qos=1).wait_for_publish()
                print(f"[{device_id}] {topic}: {msg}")

            print("-" * 40)
            time.sleep(INTERVAL_S)

    except KeyboardInterrupt:
        print("\nZatrzymano symulator.")
    except Exception as e:
        print(f"\nBłąd: {e}")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
