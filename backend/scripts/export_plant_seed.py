"""Export a GitHub-sized plant seed from the laptop live DB.

Excludes huge runtime tables (voltage readings, alerts, audit).
Writes:
  docs/plant-data/pvc_arvand_plant_seed.db
  docs/plant-data/shutdowns.xlsx
  docs/plant-data/shutdown-causes.xlsx
  docs/plant-data/shutdown-categories.xlsx
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "instance" / "pvc_arvand.db"
OUT_DIR = ROOT / "docs" / "plant-data"
SEED = OUT_DIR / "pvc_arvand_plant_seed.db"

DROP = (
    "voltage_readings",
    "alert_events",
    "audit_logs",
    "access_archive_meta",
)


def export_seed() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Live DB not found: {SRC}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if SEED.exists():
        SEED.unlink()
    src = sqlite3.connect(SRC)
    src.execute("VACUUM INTO ?", (str(SEED),))
    src.close()

    dst = sqlite3.connect(SEED)
    for table in DROP:
        dst.execute(f"DROP TABLE IF EXISTS [{table}]")
    dst.commit()
    dst.execute("VACUUM")
    dst.close()
    mb = SEED.stat().st_size / (1024 * 1024)
    print(f"Wrote {SEED} ({mb:.1f} MB)")


def export_shutdown_excels() -> None:
    try:
        import openpyxl
    except ImportError as exc:
        raise SystemExit("openpyxl required") from exc

    con = sqlite3.connect(SRC)
    con.row_factory = sqlite3.Row

    def dump(sql: str, path: Path, headers: list[str]) -> int:
        rows = con.execute(sql).fetchall()
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(headers)
        for row in rows:
            ws.append([row[h] for h in headers])
        wb.save(path)
        print(f"Wrote {path} ({len(rows)} rows)")
        return len(rows)

    dump(
        "SELECT nr, plant_part, shutdown_time, startup_time, code, cause, category, remarks FROM shutdowns ORDER BY nr",
        OUT_DIR / "shutdowns.xlsx",
        ["nr", "plant_part", "shutdown_time", "startup_time", "code", "cause", "category", "remarks"],
    )
    dump(
        "SELECT id, language_id, code, cause, category FROM shutdown_causes ORDER BY id",
        OUT_DIR / "shutdown-causes.xlsx",
        ["id", "language_id", "code", "cause", "category"],
    )
    dump(
        "SELECT id, category FROM shutdown_categories ORDER BY id",
        OUT_DIR / "shutdown-categories.xlsx",
        ["id", "category"],
    )
    con.close()


if __name__ == "__main__":
    export_seed()
    export_shutdown_excels()
