Smart Fridge
==================

## System Purpose
Ensuring continuous monitoring of product storage conditions in catering and retail facilities. The system independently records data and sends immediate notifications of failures, preventing food spoilage.


## System Architecture

1.  **Device:** The ESP32 collects and transmits data to the server.
3.  **Backend:** A Flask server processes the data and manages alarms.
4.  **Frontend:** A React application for visualization, configuration, and receiving notifications.


## Technologies

### `/firmware`
* **Language:** C
* **MCU:** ESP32
* **Framework:** ESP-IDF, FreeRTOS
* **Sensors:** DS18B20

### `/backend`
* **Language:** Python
* **Framework:** Flask
* **Data Base:** SQLite + SQLAlchemy ORM
* **MQTT:** Paho-MQTT
* **Push:** PyWebPush

### `/frontend`
* **Language:** JS
* **Framework:** React + Vite
* **HTTP Client:** Axios
* **Service Worker:** Background notification and PWA support

---

## Project Structure

```text
smart-fridge/
├── backend/            # Server logic
├── docs/               # Notes
├── firmware/           # ESP32 source code
└── frontend/           # React app
