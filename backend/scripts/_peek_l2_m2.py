"""Download one L2/M2 month from AriaORMS and print parse stats."""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("ARIA_USER", os.environ.get("ARIA_USER", "588955"))
os.environ.setdefault("ARIA_PASS", os.environ.get("ARIA_PASS", "588955"))

from app.plant_import import parse_voltage_excel  # noqa: E402

_spec = importlib.util.spec_from_file_location("aria_hist", BACKEND / "scripts" / "import_ariaorms_history.py")
_hist = importlib.util.module_from_spec(_spec)
assert _spec.loader
_spec.loader.exec_module(_hist)

SAMPLES = [
    ("L2", 192, "1403-10-1", "1403-10-30"),
    ("L2", 192, "1404-7-1", "1404-7-31"),
    ("L2", 192, "1405-3-1", "1405-3-31"),
    ("M2", 193, "1403-10-1", "1403-10-30"),
    ("M2", 193, "1404-7-1", "1404-7-31"),
    ("M2", 193, "1405-3-1", "1405-3-31"),
]


def main() -> None:
    opener = _hist.new_opener()
    for name, log_id, start, end in SAMPLES:
        try:
            body = _hist.download(opener, log_id, start, end)
        except Exception as exc:  # noqa: BLE001
            print(f"{name} {start} DOWNLOAD {exc}", flush=True)
            continue
        parsed = parse_voltage_excel(body)
        readings = parsed.get("readings") or []
        slots = parsed.get("total_slots") or []
        loads = [s for s in slots if s.get("load") not in (None, "")]
        dates = parsed.get("dates") or []
        print(
            f"{name} {start}..{end} bytes={len(body)} cells={len(readings)} "
            f"dates={len(dates)} slots={len(slots)} loads={len(loads)} "
            f"err={parsed.get('error')}",
            flush=True,
        )
        if slots:
            print(f"  sample slot {slots[0]}", flush=True)
        if readings[:1]:
            print(f"  sample cell {readings[0]}", flush=True)


if __name__ == "__main__":
    main()
