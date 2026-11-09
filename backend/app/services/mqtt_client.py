import json
import logging

import paho.mqtt.client as mqtt

from app.extensions import db
from app.services import push_service
from app.services.ingest_service import BOARD_ID_RE, ingest_data, ingest_status
from app.utils import now_ts

logger = logging.getLogger(__name__)

TOPIC_PREFIX = "sf/v1"
SUBSCRIPTIONS = [(f"{TOPIC_PREFIX}/+/data", 1), (f"{TOPIC_PREFIX}/+/status", 1)]
# Komendy do plytki: retained, bo plytka jest online tylko kilka sekund co cykl
COMMANDS = ("reset", "update")


class MqttIngestClient:
    """
    Odbior wiadomosci z plytek z jednego brokera.
    Trwala sesja (clean_session=False + staly client_id) i subskrypcja QoS 1: gdy backend nie dziala,
    broker przechowuje wiadomosci i oddaje je po ponownym polaczeniu.
    Pod brokera per klient: jedna instancja na broker.
    """

    def __init__(self, app, host, port, client_id, username=None, password=None, use_tls=True):
        self.app = app
        self.host = host
        self.port = port
        # Epoch polaczenia (None = rozlaczony) - wykrywanie offline plytek czeka po (re)connect
        self.connected_since = None

        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=client_id,
            clean_session=False,
            protocol=mqtt.MQTTv311,
        )
        if use_tls:
            self.client.tls_set()
        if username and password:
            self.client.username_pw_set(username, password)
        self.client.reconnect_delay_set(min_delay=1, max_delay=60)

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def start(self):
        logger.info(f"Łączenie z brokerem MQTT ({self.host}:{self.port})...")
        # connect_async + loop_start: wlasny watek, automatyczne ponawianie polaczenia
        self.client.connect_async(self.host, self.port, keepalive=60)
        self.client.loop_start()

    def stop(self):
        self.client.loop_stop()
        self.client.disconnect()

    def publish_command(self, board_id, command, payload):
        """Komenda retained QoS 1; plytka odbierze ja w najblizszym cyklu i sama wyczysci temat."""
        if command not in COMMANDS:
            raise ValueError(f"Nieznana komenda: {command}")
        if self.connected_since is None:
            return False
        info = self.client.publish(f"{TOPIC_PREFIX}/{board_id}/{command}", payload, qos=1, retain=True)
        logger.info(f"Komenda {command} -> {board_id}: {payload}")
        return info.rc == mqtt.MQTT_ERR_SUCCESS

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            logger.error(f"❌ Błąd połączenia MQTT: {reason_code}")
            return
        self.connected_since = now_ts()
        logger.info(f"✅ MQTT połączono: {self.host}:{self.port} (sesja z brokera: {flags.session_present})")
        client.subscribe(SUBSCRIPTIONS)
        logger.info(f"📡 Nasłuchiwanie: {', '.join(t for t, _ in SUBSCRIPTIONS)}")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        self.connected_since = None
        if reason_code != 0:
            logger.warning(f"⚠️ MQTT rozłączono ({reason_code}) - ponawiam połączenie")

    def _on_message(self, client, userdata, msg):
        parts = msg.topic.split("/")
        if len(parts) != 4 or "/".join(parts[:2]) != TOPIC_PREFIX or not BOARD_ID_RE.match(parts[2]):
            logger.warning(f"Ignoruję temat: {msg.topic}")
            return
        board_id, kind = parts[2], parts[3]
        if kind not in ("data", "status") or not msg.payload:
            return

        with self.app.app_context():
            try:
                payload = json.loads(msg.payload.decode())
                if kind == "data":
                    ingest_data(board_id, payload)
                else:
                    ingest_status(board_id, payload, retained=bool(msg.retain))
                db.session.commit()
                push_service.send_pending()
            except Exception as e:
                db.session.rollback()
                push_service.discard_pending()
                # Cala wiadomosc w logu - da sie ja odtworzyc recznie
                logger.error(f"Błąd obsługi {msg.topic}: {e} | payload: {msg.payload!r}")
