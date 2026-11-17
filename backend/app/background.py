"""
Praca w tle: odbior MQTT + zadanie wykrywania plytek offline.
Uruchamiac w JEDNYM procesie (run.py albo gunicorn -w 1) - staly client_id MQTT i jeden scheduler.
"""
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from app.extensions import db
from app.services import alert_service, push_service
from app.services.mqtt_client import MqttIngestClient
from app.utils import now_ts

logger = logging.getLogger(__name__)

OFFLINE_CHECK_EVERY_S = 60
MQTT_SETTLE_S = 180


def _offline_job(app):
    with app.app_context():
        mqtt_client = app.extensions.get("mqtt")
        if mqtt_client is None or mqtt_client.connected_since is None:
            return
        now = now_ts()
        if now - mqtt_client.connected_since < MQTT_SETTLE_S:
            return
        try:
            alert_service.check_offline(now)
            alert_service.send_outage_summaries(now)
            db.session.commit()
            push_service.send_pending()
        except Exception as e:
            db.session.rollback()
            push_service.discard_pending()
            logger.error(f"Błąd zadania okresowego (offline / podsumowanie przerwy): {e}")


def start_background(app):
    cfg = app.config
    mqtt_client = MqttIngestClient(
        app,
        host=cfg["MQTT_BROKER"],
        port=cfg["MQTT_PORT"],
        client_id=cfg["MQTT_CLIENT_ID"],
        username=cfg["MQTT_LOGIN"],
        password=cfg["MQTT_PASS"],
        use_tls=cfg["MQTT_TLS"],
    )
    app.extensions["mqtt"] = mqtt_client
    mqtt_client.start()

    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(
        _offline_job, "interval", seconds=OFFLINE_CHECK_EVERY_S, args=[app],
        next_run_time=datetime.now() + timedelta(seconds=OFFLINE_CHECK_EVERY_S),
        max_instances=1, coalesce=True,
    )
    scheduler.start()
    app.extensions["scheduler"] = scheduler
    logger.info("Uruchomiono odbiór MQTT i sprawdzanie płytek offline")
