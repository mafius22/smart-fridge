import os
import json
import logging
from pywebpush import webpush, WebPushException
from app import db
from app.models.subscriber import PushSubscriber

# Setup loggera
logger = logging.getLogger(__name__)

def send_alert(temperature, device, app):
    """
    Wysyła powiadomienie do tych subskrybentów którzy maja wlaczone powiadomienia i temperatura jest wyzsza od ich progu.
    Wymaga przekazania 'app', aby wejść w kontekst bazy danych.
    """
    vapid_private = os.getenv("VAPID_PRIVATE_KEY")
    vapid_email = os.getenv("VAPID_EMAIL")

    if not vapid_private:
        logger.error("Brak klucza VAPID_PRIVATE_KEY w .env!")
        return

    with app.app_context():
        subscribers = PushSubscriber.query.all()
        
        if not subscribers:
            return

        payload = json.dumps({
            "title": "ALARM TEMPERATURY! 🔥",
            "body": f"Temperatura wzrosła do {temperature}°C! w lodówce: {device}",
            "icon": "/vite.svg" # Ikona, którą masz we frontendzie
        })

        for sub in subscribers:
            if sub.is_active and sub.custom_threshold < temperature:

                try:
                    webpush(
                        subscription_info={
                            "endpoint": sub.endpoint,
                            "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                        },
                        data=payload,
                        vapid_private_key=vapid_private,
                        vapid_claims={"sub": vapid_email},
                        ttl=86400,            # Ważność: 24h
                        headers={"Urgency": "high"}
                    )
                except WebPushException as ex:
                    if ex.response and ex.response.status_code == 410:
                        logger.info(f"Usuwanie nieaktywnego subskrybenta: {sub.id}")
                        db.session.delete(sub)
                    else:
                        logger.error(f"Błąd Push: {ex}")
        
        db.session.commit()