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

BASE_TOPIC = "esp32/smartfridge" 

DEVICES = ["lodowka_kuchnia", "zamrazarka_piwnica", "chlodziarka_wino"]

INTERVAL_S = 20

MQTT_USER = os.getenv("MQTT_LOGIN", "twoj_login")
MQTT_PASS = os.getenv("MQTT_PASS", "twoje_haslo")

def unix_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())

def make_payload(device_name) -> dict:
    if "zamrazarka" in device_name:
        temp = round(random.uniform(-25.0, -15.0), 1)
    else:
        temp = round(random.uniform(8.0, 10.0), 1)  
        
    press = random.randint(98000, 103000)
    return {"ts": unix_ts(), "temp": temp, "press": press}

def main():
    client = mqtt.Client()
    client.tls_set() 

    if MQTT_USER and MQTT_PASS:
        client.username_pw_set(MQTT_USER, MQTT_PASS)

    try:
        client.connect(BROKER, PORT, keepalive=60)
        client.loop_start()
        print(f"Połączono z brokerem {BROKER}:{PORT}")
        print(f"Symuluję urządzenia: {DEVICES}")

        while True:
            for device_id in DEVICES:
                topic = f"{BASE_TOPIC}/{device_id}/data"
                
                payload = make_payload(device_id)
                msg = json.dumps(payload, separators=(",", ":"))
                
                info = client.publish(topic, msg, qos=1)
                info.wait_for_publish()

                print(f"[{device_id}] Wysłano na {topic}: {msg}")
                
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