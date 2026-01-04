import paho.mqtt.client as mqtt
import json
import time
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, Float, String, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker

import os
from dotenv import load_dotenv

load_dotenv()

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_TOPIC = "esp32/smartfridge/data"

MQTT_USER = os.getenv("MQTT_USER")
MQTT_PASS = os.getenv("MQTT_PASS")


DATABASE_FILE = os.getenv("DATABASE_FILE")
CONN_STRING = f"sqlite:///{DATABASE_FILE}"

# Dalej Twój kod wygląda tak samo, ale zmienne są już bezpieczne...
# Np. w funkcji on_connect:
# if MQTT_USER and MQTT_PASS:
#     client.username_pw_set(MQTT_USER, MQTT_PASS)

# 3. Logika Alarmowa
ALARM_TEMP = 30.0

# --- MODEL DANYCH (SQLAlchemy ORM) ---
Base = declarative_base()

class Pomiar(Base):
    """
    Klasa odwzorowująca tabelę 'pomiary' w bazie danych.
    """
    __tablename__ = 'pomiary'

    id = Column(Integer, primary_key=True)
    timestamp_esp = Column(Integer)      # Czas z ESP32 (ts)
    data_zapisu = Column(DateTime)       # Czas odebrania przez serwer
    temp = Column(Float)
    press = Column(Integer)

    def __repr__(self):
        return f"<Pomiar(temp={self.temp}, press={self.press})>"

# --- INICJALIZACJA BAZY ---
# Tworzymy silnik (engine) i sesję
engine = create_engine(CONN_STRING, echo=False) # echo=True pokaże logi SQL w konsoli
Base.metadata.create_all(engine) # Tworzy tabelę, jeśli nie istnieje
Session = sessionmaker(bind=engine)

def save_to_db_orm(data):
    """Zapisuje obiekt Pomiar do bazy używając sesji SQLAlchemy"""
    session = Session()
    try:
        # Tworzymy nowy obiekt (wiersz w tabeli)
        nowy_pomiar = Pomiar(
            timestamp_esp=data.get('ts', 0),
            data_zapisu=datetime.now(),
            temp=data.get('temp', 0.0),
            press=data.get('press', 0)
        )
        
        # Dodajemy i zatwierdzamy
        session.add(nowy_pomiar)
        session.commit()
        print(f"[ORM] Zapisano: {nowy_pomiar.temp}°C | {nowy_pomiar.press} Pa")
        
    except Exception as e:
        print(f"[BŁĄD ORM] {e}")
        session.rollback() # Cofnij zmiany w razie błędu
    finally:
        session.close() # Zawsze zamykaj sesję!

# --- MQTT CALLBACKS ---
def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"Połączono z lokalnym Mosquitto ({MQTT_BROKER})!")
        client.subscribe(MQTT_TOPIC)
        print(f"Nasłuchuję na kanale: {MQTT_TOPIC}")
    else:
        print(f"Błąd połączenia. Kod błędu: {rc}")

def on_message(client, userdata, msg):
    try:
        payload = msg.payload.decode()
        # print(f"[RAW] {payload}") 
        
        data = json.loads(payload)
        
        # 1. Logika biznesowa (Alarm)
        current_temp = data.get('temp', 0)
        if current_temp > ALARM_TEMP:
            print(f"\n!!! ALARM !!! Temperatura za wysoka: {current_temp}°C\n")
            
        # 2. Zapis do bazy przez SQLAlchemy
        save_to_db_orm(data)
        
    except json.JSONDecodeError:
        print("Błąd: Otrzymano niepoprawny JSON")
    except Exception as e:
        print(f"Błąd przetwarzania wiadomości: {e}")

# --- START ---
if __name__ == "__main__":
    print("--- START SERWERA (SQLAlchemy + Local Mosquitto) ---")
    
    # Obsługa nowszej wersji Paho MQTT (v2.0+) lub starszej
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    except AttributeError:
        client = mqtt.Client() # Fallback dla starszych wersji
        
    # Ustawienie loginu i hasła (jeśli zdefiniowane)
    if MQTT_USER and MQTT_PASS:
        client.username_pw_set(MQTT_USER, MQTT_PASS)

    client.on_connect = on_connect
    client.on_message = on_message

    print(f"Łączenie z brokerem {MQTT_BROKER}...")
    
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_forever()
    except ConnectionRefusedError:
        print(f"Błąd: Nie można połączyć się z {MQTT_BROKER}. Czy usługa Mosquitto działa?")
    except KeyboardInterrupt:
        print("\nZatrzymano serwer.")