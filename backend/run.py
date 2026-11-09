import logging
from app import create_app
from app.background import start_background

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = create_app()

if __name__ == "__main__":
    print("--- START SYSTEMU ---")
    # MQTT + scheduler maja wlasne watki; debug=False, bo reloader uruchomilby je drugi raz
    start_background(app)

    PORT = 5000

    app.run(host='0.0.0.0', port=PORT, debug=False)
