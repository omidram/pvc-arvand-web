"""CLI wrapper used by deploy/update.sh."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, "/app")

from app.shutdown_seed import apply_shutdown_tables  # noqa: E402


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: apply_shutdown_tables.py LIVE_DB SEED_DB")
    apply_shutdown_tables(sys.argv[1], sys.argv[2])
