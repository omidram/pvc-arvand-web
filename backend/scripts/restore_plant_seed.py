"""Merge docs/plant-data/pvc_arvand_plant_seed.db into the live database.

Default: replace plant master + shutdown tables from the seed (keeps users,
roles, alert rules, voltage sync settings, and any voltage_readings already
present on the server).

Usage (inside backend venv / container):
  python scripts/restore_plant_seed.py
  python scripts/restore_plant_seed.py --seed /app/docs/plant-data/pvc_arvand_plant_seed.db
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SEED = ROOT / "docs" / "plant-data" / "pvc_arvand_plant_seed.db"

# Keep server auth / ops config; merge everything else from the laptop seed.
KEEP_LIVE = {
    "users",
    "form_permissions",
    "app_roles",
    "role_permissions",
    "backup_settings",
    "voltage_sync_settings",
    "alert_rules",
    "sqlite_sequence",
}

# Never wipe large runtime tables that may exist only on the server.
PROTECT_IF_PRESENT = {
    "voltage_readings",
    "alert_events",
    "audit_logs",
}


def live_db_path() -> Path:
    sys.path.insert(0, str(ROOT / "backend"))
    from app.paths import data_root  # noqa: WPS433

    return Path(data_root()) / "pvc_arvand.db"


def restore(seed: Path, dest: Path) -> None:
    if not seed.is_file():
        raise SystemExit(f"Seed not found: {seed}")
    if not dest.is_file():
        raise SystemExit(f"Live DB not found: {dest}")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = dest.with_name(f"pvc_arvand_pre_seed_{stamp}.db")
    shutil.copy2(dest, backup)
    print(f"Backup: {backup}")

    live = sqlite3.connect(dest)
    live.execute("PRAGMA foreign_keys=OFF")
    live.execute(f"ATTACH DATABASE ? AS seed", (str(seed),))

    seed_tables = {
        r[0]
        for r in live.execute(
            "SELECT name FROM seed.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    }
    live_tables = {
        r[0]
        for r in live.execute(
            "SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    }

    replaced = []
    for table in sorted(seed_tables):
        if table in KEEP_LIVE or table in PROTECT_IF_PRESENT:
            continue
        if table not in live_tables:
            # Create missing table from seed schema
            schema = live.execute(
                "SELECT sql FROM seed.sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()
            if not schema or not schema[0]:
                continue
            live.execute(schema[0])
        live.execute(f"DELETE FROM main.[{table}]")
        live.execute(f"INSERT INTO main.[{table}] SELECT * FROM seed.[{table}]")
        replaced.append(table)

    live.commit()
    live.execute("DETACH DATABASE seed")
    live.execute("PRAGMA foreign_keys=ON")
    live.close()
    print(f"Restored {len(replaced)} tables from seed into {dest}")
    print("Kept:", ", ".join(sorted(KEEP_LIVE | PROTECT_IF_PRESENT)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=Path, default=DEFAULT_SEED)
    parser.add_argument("--db", type=Path, default=None, help="Live SQLite path (default: app data root)")
    args = parser.parse_args()
    dest = args.db or live_db_path()
    restore(args.seed.resolve(), dest.resolve())


if __name__ == "__main__":
    main()
