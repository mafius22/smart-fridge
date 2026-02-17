Smart Fridge
==================

## Cel Systemu
Zapewnienie ciągłego nadzoru nad warunkami przechowywania produktów w obiektach gastronomicznych i handlowych. System samodzielnie rejestruje dane i wysyła natychmiastowe powiadomienia o awariach, zapobiegając psuciu się żywności.

## Architektura Systemu

1.  **Urządzenie:** ESP32 zbiera i wysyła dane na server.
3.  **Backend:** Serwer Flask przetwarza dane i zarządza alarmami.
4.  **Frontend:** Aplikacja reactowa do wizualizacji, konfiguracji oraz odbierania powiadomień.


## Technologie

### `/firmware`
* **Język:** C
* **MCU:** ESP32
* **Framework:** ESP-IDF, FreeRTOS
* **Czujniki:** DS18B20

### `/backend`
* **Język:** Python
* **Framework:** Flask
* **Baza Danych:** SQLite + SQLAlchemy ORM
* **MQTT:** Paho-MQTT
* **Push:** PyWebPush

### `/frontend`
* **Język:** JS
* **Framework:** React + Vite
* **HTTP Klient:** Axios
* **Service Worker:** Obsługa powiadomień w tle i PWA

---

## Struktura Projektu

```text
smart-fridge/
├── backend/            # Logika serwerowa
├── docs/               # Notatki
├── firmware/           # Kod źródłowy ESP32
└── frontend/           # Aplikacji React
