"""
Sterowany symulator plytki do testow recznych: wysyla dokladnie to, co trzeba (temperatura, -127, status, bufor).
Uruchomienie z katalogu backend (bierze MQTT_* z .env):

  python utils/scenario.py data 9.5                 # jeden pomiar 9.5 C (teraz)
  python utils/scenario.py data -127                # awaria sondy
  python utils/scenario.py data 9.5 --ago 1200      # pomiar sprzed 20 min (stary - bez alarmu)
  python utils/scenario.py loop 9.5 --every 20      # pomiar co 20 s do Ctrl+C
  python utils/scenario.py flap --every 20          # na zmiane -127 i 5.0 (migajacy czujnik)
  python utils/scenario.py status --interval 20     # status z sonda, offline juz po 3 x 20 s ciszy
  python utils/scenario.py status --no-sensors      # status bez sondy -> sensor_missing
  python utils/scenario.py buffer 12 --minutes 10   # bufor po przerwie: 10 min pomiarow 12 C + biezacy 5 C
"""
import argparse
import json
import os
import time

import paho.mqtt.client as mqtt
from dotenv import load_dotenv

load_dotenv()

BOARD = "sf-0000000000aa"
SID = "28aa0000000000a1"


def connect():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    if os.getenv("MQTT_TLS", "1") == "1":
        client.tls_set()
    if os.getenv("MQTT_LOGIN") and os.getenv("MQTT_PASS"):
        client.username_pw_set(os.getenv("MQTT_LOGIN"), os.getenv("MQTT_PASS"))
    client.connect(os.getenv("MQTT_BROKER", "localhost"), int(os.getenv("MQTT_PORT", 8883)), keepalive=60)
    client.loop_start()
    return client


def publish(client, board, kind, payload, retain=False):
    topic = f"sf/v1/{board}/{kind}"
    msg = json.dumps(payload, separators=(",", ":"))
    client.publish(topic, msg, qos=1, retain=retain).wait_for_publish()
    print(f"{time.strftime('%H:%M:%S')} {topic}: {msg[:160]}{'...' if len(msg) > 160 else ''}")


def readings(sid, items):
    return {"readings": [{"sid": sid, "ts": ts, "temp": temp} for ts, temp in items]}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--board", default=BOARD)
    p.add_argument("--sid", default=SID)
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("data", help="jeden pomiar")
    d.add_argument("temp", type=float)
    d.add_argument("--ago", type=int, default=0, help="ile sekund temu wykonany")

    lp = sub.add_parser("loop", help="pomiar co --every s do Ctrl+C")
    lp.add_argument("temp", type=float)
    lp.add_argument("--every", type=int, default=20)

    fl = sub.add_parser("flap", help="na zmiane -127 i --ok do Ctrl+C")
    fl.add_argument("--ok", type=float, default=5.0)
    fl.add_argument("--every", type=int, default=20)

    st = sub.add_parser("status", help="status plytki (retained, jak firmware)")
    st.add_argument("--interval", type=int, default=20, help="interval_s - offline po 3 x tyle ciszy")
    st.add_argument("--no-sensors", action="store_true", help="sonda nie wykryta")

    bf = sub.add_parser("buffer", help="zaleglosci z bufora + biezacy pomiar")
    bf.add_argument("temp", type=float, help="temperatura w czasie przerwy")
    bf.add_argument("--minutes", type=int, default=10, help="dlugosc przerwy")
    bf.add_argument("--step", type=int, default=60, help="odstep pomiarow w buforze [s]")
    bf.add_argument("--now-temp", type=float, default=5.0, help="biezacy pomiar po powrocie")

    a = p.parse_args()
    client = connect()
    try:
        if a.cmd == "data":
            publish(client, a.board, "data", readings(a.sid, [(int(time.time()) - a.ago, a.temp)]))
        elif a.cmd == "loop":
            while True:
                publish(client, a.board, "data", readings(a.sid, [(int(time.time()), a.temp)]))
                time.sleep(a.every)
        elif a.cmd == "flap":
            temps = (-127.0, a.ok)
            i = 0
            while True:
                publish(client, a.board, "data", readings(a.sid, [(int(time.time()), temps[i % 2])]))
                i += 1
                time.sleep(a.every)
        elif a.cmd == "status":
            publish(client, a.board, "status", {
                "fw": "test", "ts": int(time.time()), "rssi": -55, "buffered": 0, "ota": "none",
                "interval_s": a.interval, "status_interval_s": 600,
                "sensors": [] if a.no_sensors else [a.sid],
            }, retain=True)
        elif a.cmd == "buffer":
            now = int(time.time())
            items = [(ts, a.temp) for ts in range(now - a.minutes * 60, now, a.step)] + [(now, a.now_temp)]
            publish(client, a.board, "data", readings(a.sid, items))
    except KeyboardInterrupt:
        print("\nStop.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
