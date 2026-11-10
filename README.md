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
* **UI:** Tailwind CSS 4 + shadcn/ui (Radix), light/dark theme
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
flask --app run db upgrade      # create / migrate the database
flask --app run create-admin    # first administrator
python run.py                   
python -m pytest                
```
Run the backend as a **single process with several threads** (`gunicorn -w 1 --threads 8 -b 0.0.0.0:5000 wsgi:app`, Linux only): it holds a persistent MQTT session (`MQTT_CLIENT_ID`) and the offline-detection scheduler, so more worker processes would duplicate them; the default sync worker without `--threads` would serve one request at a time. Use `flask --app run ...` (not `--app wsgi`) for CLI commands - importing `wsgi` starts MQTT.

### Frontend (`/frontend`)
```powershell
cd frontend
npm install
npm run dev                     # http://localhost:5173, /api proxied to the backend
```

### Accounts and access
* The admin creates user accounts and grants access to fridges.
* Boards and sensors register themselves on the first MQTT message; the admin assigns a sensor to a fridge.
* Every user sets their own min/max thresholds, notifications, fridge names and folders.
