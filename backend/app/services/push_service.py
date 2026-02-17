import os
import json
import logging
from pywebpush import webpush, WebPushException
from app.extensions import db
from app.models import PushSubscriber, SubscriberDeviceSettings

logger = logging.getLogger(__name__)

def send_alert(temperature, device_obj, app):
    """
    Wysyła powiadomienie push.
    
    Logika:
    1. Znajduje subskrybentów przypisanych do urządzenia.
    2. Sprawdza, czy subskrybent jest globalnie aktywny.
    3. Sprawdza, czy aktualna temperatura > custom_threshold subskrybenta dla tego urządzenia.
    """
    vapid_private = os.getenv("VAPID_PRIVATE_KEY")
    vapid_email = os.getenv("VAPID_EMAIL")

    if not vapid_private:
        logger.error("Brak klucza VAPID_PRIVATE_KEY w .env!")
        return

    with app.app_context():
        alerts_to_send = db.session.query(PushSubscriber, SubscriberDeviceSettings)\
            .join(SubscriberDeviceSettings, PushSubscriber.id == SubscriberDeviceSettings.subscriber_id)\
            .filter(SubscriberDeviceSettings.device_id == device_obj.id)\
            .filter(PushSubscriber.is_active == True)\
            .filter(SubscriberDeviceSettings.custom_threshold < temperature)\
            .all()
        
        if not alerts_to_send:
            return

        logger.info(f"ALARM: Wysyłanie powiadomień do {len(alerts_to_send)} użytkowników dla {device_obj.name}.")

        for sub, settings in alerts_to_send:
            
            payload = json.dumps({
                "title": f"ALARM: {device_obj.name} 🔥",
                "body": f"Temperatura: {temperature}°C (Twój limit: {settings.custom_threshold}°C)",
                "icon": "/vite.svg",
                "data": {
                    "url": f"/devices/{device_obj.id}" 
                }
            })

            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                    },
                    data=payload,
                    vapid_private_key=vapid_private,
                    vapid_claims={"sub": vapid_email},
                    ttl=43200, 
                    headers={"Urgency": "high"}
                )
            except WebPushException as ex:
                if ex.response and ex.response.status_code == 410:
                    logger.info(f"Usuwanie martwej subskrypcji: {sub.id}")
                    db.session.delete(sub)
                else:
                    logger.error(f"Błąd WebPush dla {sub.id}: {ex}")

        db.session.commit()