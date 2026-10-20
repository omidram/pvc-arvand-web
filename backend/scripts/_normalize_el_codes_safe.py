"""Normalize only electrolyzer code columns to A1 form (safe, narrow)."""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "instance" / "pvc_arvand.db"
DIGIT_FIRST = re.compile(r"^([12])([A-HJ-M])$", re.I)

TARGETS = [
    ("electrolyzers", "name"),
    ("electrolyzer_arrangements", "name"),
    ("electrolyzer_normalizations", "electrolyzer"),
    ("voltage_readings", "electrolyzer"),
    ("elements", "electrolyzer"),
    ("shutdowns", "plant_part"),
    ("analysis_samples", "electrolyzer"),
    ("current_efficiency", "electrolyzer"),
    ("remarks", "electrolyzer"),
]


def canon(value: str) -> str | None:
    m = DIGIT_FIRST.match(str(value).strip())
    if not m:
        return None
    return f"{m.group(2).upper()}{m.group(1)}"


def main() -> None:
    con = sqlite3.connect(DB)
    cur = con.cursor()
    n = 0
    tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for table, col in TARGETS:
        if table not in tables:
            continue
        cols = {r[1] for r in cur.execute(f'PRAGMA table_info("{table}")')}
        if col not in cols:
            continue
        rows = cur.execute(f'SELECT rowid, "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL').fetchall()
        for rid, val in rows:
            new = canon(val)
            if new and new != val:
                cur.execute(f'UPDATE "{table}" SET "{col}" = ? WHERE rowid = ?', (new, rid))
                n += 1
    con.commit()
    con.close()
    print(f"normalized {n} electrolyzer codes")


if __name__ == "__main__":
    main()
