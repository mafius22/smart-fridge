import time
from datetime import datetime, timezone


def now_ts():
    """Biezacy czas jako epoch UTC w sekundach (tak jak ts z plytki)."""
    return int(time.time())


def utcnow():
    return datetime.now(timezone.utc)
