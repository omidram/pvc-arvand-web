"""Short memory cache for heavy read-only plant queries.

The dashboard, monitoring page and reports ask for the same totals many times
a minute. The numbers come from a single SQLite file, so repeating a scan for
every browser poll keeps the file busy.
"""

from __future__ import annotations

import threading
import time
from typing import Callable, TypeVar

T = TypeVar("T")

_lock = threading.Lock()
_box: dict[str, tuple[float, object]] = {}


def get_or_compute(key: str, ttl_seconds: float, compute: Callable[[], T]) -> T:
    now = time.monotonic()
    with _lock:
        hit = _box.get(key)
        if hit is not None and now - hit[0] < ttl_seconds:
            return hit[1]  # type: ignore[return-value]
    value = compute()
    with _lock:
        _box[key] = (time.monotonic(), value)
    return value
