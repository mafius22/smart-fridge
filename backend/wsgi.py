import logging
from app import create_app
from app.background import start_background

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = create_app()

print("--- INICJALIZACJA WSGI (PRODUKCJA) ---")
start_background(app)
