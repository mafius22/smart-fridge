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
```
---

## Running locally

### Backend (`/backend`)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env          # fill in MQTT, VAPID, secrets
flask --app run db upgrade      # create / migrate the database (instance/smartfridge.db)
flask --app run create-admin    # first administrator (password prompted, not echoed)
python run.py                   # API on http://localhost:5000/api + MQTT ingest + offline checks
python -m pytest                # tests
```
Run the backend as a **single process** (`gunicorn -w 1 wsgi:app`): it holds a persistent MQTT session (`MQTT_CLIENT_ID`) and the offline-detection scheduler.

### Frontend (`/frontend`)
```powershell
cd frontend
npm install
npm run dev                     # http://localhost:5173, /api proxied to the backend
```

### Accounts and access
* The admin creates user accounts (users change the initial password at first login) and grants access to fridges.
* Boards and sensors register themselves on the first MQTT message; the admin assigns a sensor to a fridge.
* Every user sets their own min/max thresholds, notifications, fridge names and folders.

MQTT interface of the firmware: `docs/firmware_backend_interface.md`. REST API: `docs/backend_api.md`.
