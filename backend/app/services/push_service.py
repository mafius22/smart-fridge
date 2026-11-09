import json
import logging
from concurrent.futures import ThreadPoolExecutor

from flask import current_app, g
from pywebpush import WebPushException, webpush

from app.extensions import db
from app.models import PushSubscription

logger = logging.getLogger(__name__)

# Wysylka w tle: wolny serwer push nie blokuje odbioru MQTT ani odpowiedzi API
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")


def queue(user_id, title, body, url="/", tag=None):
    """Dodaje powiadomienie do wyslania po commicie biezacej transakcji (send_pending)."""
    if "pending_push" not in g:
        g.pending_push = []
    g.pending_push.append({"user_id": user_id, "title": title, "body": body, "url": url, "tag": tag})


def discard_pending():
    g.pop("pending_push", None)


def send_pending():
    """Wywolywac po db.session.commit() - wysyla powiadomienia zebrane w tej transakcji."""
    items = g.pop("pending_push", None)
    if not items:
        return
    app = current_app._get_current_object()
    if not app.config.get("VAPID_PRIVATE_KEY"):
        logger.warning(f"Brak VAPID_PRIVATE_KEY - pomijam {len(items)} powiadomień")
        return
    _executor.submit(_send_batch, app, items)


def _vapid_sub(email):
    # Serwery push wymagaja adresu w formie mailto:
    if email and not email.startswith("mailto:"):
        return f"mailto:{email}"
    return email


def _send_batch(app, items):
    with app.app_context():
        try:
            for item in items:
                _send_to_user(app, item)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            logger.error(f"Błąd wysyłki push: {e}")


def _send_to_user(app, item):
    subscriptions = PushSubscription.query.filter_by(user_id=item["user_id"]).all()
    payload = json.dumps({k: item[k] for k in ("title", "body", "url", "tag")})
    for sub in subscriptions:
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=payload,
                vapid_private_key=app.config["VAPID_PRIVATE_KEY"],
                vapid_claims={"sub": _vapid_sub(app.config.get("VAPID_EMAIL"))},
                ttl=12 * 3600,
                headers={"Urgency": "high"},
            )
            logger.info(f"Push -> user {item['user_id']}: {item['title']} | {item['body']}")
        except WebPushException as ex:
            status = ex.response.status_code if ex.response is not None else None
            if status in (404, 410):
                logger.info(f"Usuwam wygasłą subskrypcję push {sub.id} (user {sub.user_id})")
                db.session.delete(sub)
            else:
                logger.error(f"Błąd WebPush (subskrypcja {sub.id}): {ex}")
