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
npm run dev                    
```

### Firmware (`/firmware`)
Requires ESP-IDF 5.5.1.:
```powershell
& C:\path\to\esp-idf\export.ps1
cd firmware
idf.py build
idf.py flash monitor     
```

###  BLE board setup

A new board is unconfigured: it does not measure or connect to the network, starts BLE immediately and the LED blinks.

1. Install nRF Connect on a phone and scan. Connect to **`SF-XXXX`**.
2. Open the service **`0x00FF`**. It has 6 characteristics; each shows its name in the descriptor *Characteristic User Description*.
3. Write the values as **Text (UTF-8)**:

| UUID | Name | Value |
|---|---|---|
| `FF01` | Wi-Fi SSID | network name, 1-32 characters |
| `FF02` | Wi-Fi haslo | Wi-Fi password, 8-63 characters |
| `FF04` | MQTT adres | `mqtts://<broker-host>:<port>` |
| `FF05` | MQTT login | broker username |
| `FF06` | MQTT haslo | broker password  |
| `FF03` | Zapisz | `1` - validates, saves to the board and restarts |


Notes:
* Use the same broker host, port, login and password as the backend (`MQTT_BROKER`, `MQTT_PORT`, `MQTT_LOGIN`, `MQTT_PASS` in `backend/.env`).
* **Reconfigure later:** hold **BOOT for 4 s** - BLE turns on for 5 minutes (LED blinks).
* **Factory reset:** hold **BOOT for 10 s** and release - erases Wi-Fi, broker settings and buffered measurements; the board becomes unconfigured.

### Accounts and access
* The admin creates user accounts and grants access to fridges.
* Boards and sensors register themselves on the first MQTT message; the admin assigns a sensor to a fridge.
* Every user sets their own min/max thresholds, notifications, fridge names and folders.
