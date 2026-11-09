"""
Podglad bazy SQLite: plytki, czujniki, ostatnie pomiary.
Uruchomienie z katalogu backend: python utils/show_data.py
"""
import os
import sqlite3
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

DATABASE_FILE = os.getenv("DATABASE_FILE", "smartfridge.db")


def fmt_ts(ts):
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else "-"


con = sqlite3.connect(os.path.join("instance", DATABASE_FILE))
cur = con.cursor()

print("=== Płytki ===")
for board_id, fw, last_seen in cur.execute("SELECT id, fw, last_seen_at FROM boards"):
    print(f"{board_id}  fw={fw}  ostatnio={fmt_ts(last_seen)}")

print("\n=== Czujniki ===")
for sid, board_id, last_ts, last_temp in cur.execute("SELECT id, board_id, last_ts, last_temp FROM sensors"):
    print(f"{sid} @ {board_id}  ostatni pomiar={fmt_ts(last_ts)}  {last_temp} °C")

print("\n=== Pomiary (liczba / ostatnie 10) ===")
print(cur.execute("SELECT COUNT(*) FROM measurements").fetchone()[0])
rows = cur.execute(
    "SELECT sensor_id, fridge_id, ts, ts_from_server, temperature FROM measurements ORDER BY id DESC LIMIT 10"
)
for sid, fridge_id, ts, from_server, temp in rows:
    print(f"{fmt_ts(ts)}  {sid}  lodówka={fridge_id}  {temp} °C{'  (czas serwera)' if from_server else ''}")

print("\n=== Alarmy (ostatnie 15) ===")
rows = cur.execute(
    "SELECT id, fridge_id, user_id, kind, value, threshold, started_at, notified_at, ended_at, end_reason "
    "FROM alerts ORDER BY id DESC LIMIT 15"
)
for aid, fridge_id, user_id, kind, value, threshold, started, notified, ended, reason in rows:
    who = f"user={user_id}" if user_id else "wspólny"
    state = f"koniec {fmt_ts(ended)} ({reason})" if ended else ("AKTYWNY" if notified else "PENDING")
    print(f"#{aid} lodówka={fridge_id} {who} {kind} {value} (próg {threshold})  "
          f"start {fmt_ts(started)}  push {fmt_ts(notified)}  {state}")

con.close()
