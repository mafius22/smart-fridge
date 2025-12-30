# Smart Fridge

> **Status:** W trakcie rozwoju (Prototypowanie)

System monitorowania temperatury dla handlu i gastronomii. Projekt integruje urządzenia wbudowane ESP32, komunikację bezprzewodową, przetwarzanie w chmurze oraz aplikację mobilną.

## Główne Założenia

Celem projektu jest zapewnienie bezpieczeństwa przechowywania żywności poprzez:
* **Ciągły monitoring:** Pomiary temperatury i wilgotności w czasie rzeczywistym.
* **Niezawodność:** Buforowanie danych offline (na wypadek awarii Wi-Fi).
* **Łatwość wdrożenia:** Konfiguracja sieci Wi-Fi przez Bluetooth (BLE Provisioning).
* **Szybką reakcję:** Powiadomienia Push o przekroczeniu progów alarmowych.

---

## Architektura Systemu

System zaprojektowano w architekturze mikrousługowej:

1.  **Urządzenie:** ESP32 zbiera dane i zarządza logiką połączeń.
2.  **Transport:** Protokół MQTT.
3.  **Backend:** Kontenery Docker przetwarzają dane i zarządzają alarmami.
4.  **Prezentacja:** Aplikacja mobilna do wizualizacji i konfiguracji.

### Schemat przepływu danych
`[Czujnik] -> (I2C/1-Wire) -> [ESP32] -> (MQTT) -> [Mosquitto Broker] -> [Backend Service] -> [InfluxDB]`

---

## Technologie

### Firmware (`/firmware`)
* **MCU:** ESP32 (DevKit V1)
* **Framework:** ESP-IDF (C/C++), FreeRTOS
* **Czujniki:**
    * *Prototyp:* BMP180 (I2C) - obecna faza
    * *Produkcja:* DS18B20 (1-Wire, wodoodporny)
* **Kluczowe biblioteki:** `wifi_provisioning`, `mqtt_client`, `nvs_flash`

### Backend & Infrastruktura (`/backend`, `/infrastructure`)
* **Runtime:** Docker & Docker Compose
* **Baza Danych:** InfluxDB (Time Series Database)
* **Broker:** Eclipse Mosquitto
* **API/Logic:** Python (FastAPI) lub Node.js *[Do ustalenia]*

### Aplikacja Mobilna (`/mobile-app`)
* **Framework:** Flutter (Android / iOS)
* **Komunikacja:** BLE (do konfiguracji), HTTP/WebSocket (do wykresów)

---

## Struktura Projektu

```text
smart-fridge/
├── firmware/           # Kod źródłowy ESP32 (ESP-IDF)
├── backend/            # Logika serwerowa
├── mobile-app/         # Kod aplikacji Flutter
├── infrastructure/     # Konfiguracja Docker (docker-compose.yml)
├── docs/               # Dokumentacja, schematy, notatki
└── tools/              # Skrypty pomocnicze