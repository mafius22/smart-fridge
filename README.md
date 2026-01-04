
> **Status:** W trakcie rozwoju

# Smart Fridge

System monitorowania temperatury w chłodniach dla handlu i gastronomii.


## Architektura Systemu

System zaprojektowano w architekturze mikrousługowej:

1.  **Urządzenie:** ESP32 zbiera dane i zarządza logiką połączeń.
2.  **Transport:** Protokół MQTT.
3.  **Backend:** Serwer Flask przetwarza dane i zarządza alarmami.
4.  **Prezentacja:** Aplikacja reactowa do wizualizacji i konfiguracji.

### Schemat przepływu danych
`[Czujnik] -> (I2C/1-Wire) -> [ESP32] -> (MQTT) -> [Mosquitto Broker] -> [Backend Service] -> [Frontend Service]`

---

## Technologie

### Firmware (`/firmware`)
* **MCU:** ESP32
* **Framework:** ESP-IDF (C/C++), FreeRTOS
* **Czujniki:**
    * *Prototyp:* BMP180 (I2C) - obecna faza
    * *Produkcja:* DS18B20 (1-Wire, wodoodporny)

### Backend (`/backend`)
* **Język:** Python 3.10+
* **Framework:** Flask (REST API)
* **Baza Danych:** SQLite + SQLAlchemy ORM
* **MQTT:** Paho-MQTT
* **Push:** PyWebPush

### Frontend (`/frontend`)
* **Framework:** React + Vite
* **HTTP Klient:** Axios
* **Service Worker:** Obsługa powiadomień w tle i PWA

---

## Struktura Projektu

```text
smart-fridge/
├── backend/            # Logika serwerowa
├── docs/               # Dokumentacja, schematy, notatki
├── firmware/           # Kod źródłowy ESP32 (ESP-IDF)
└── frontend/           # Aplikacji React
