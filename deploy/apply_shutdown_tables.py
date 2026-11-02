"""Replace live shutdown tables with the committed plant seed.

Used by deploy/update.sh and deploy/update.ps1 after git pull.
Only shutdowns, shutdown_causes, and shutdown_categories are replaced.
"""
from __future__ import annotations

import sqlite3
import sys

TABLES = (
    ("shutdowns", "nr"),
    ("shutdown_causes", "id"),
    ("shutdown_categories", "id"),
)


def _columns(con: sqlite3.Connection, schema: str, table: str) -> list[tuple[str, str]]:
    rows = con.execute(f"PRAGMA {schema}.table_info([{table}])").fetchall()
    return [(row[1], row[2] or "TEXT") for row in rows]


def apply(dest: str, seed: str) -> None:
    live = sqlite3.connect(dest)
    live.execute("PRAGMA foreign_keys=OFF")
    live.execute("ATTACH DATABASE ? AS seed", (seed,))
    for table, pk in TABLES:
        seed_cols = _columns(live, "seed", table)
        if not seed_cols:
            print(f"skip {table}: missing from seed")
            continue
        live_cols = _columns(live, "main", table)
        if not live_cols:
            schema = live.execute(
                "SELECT sql FROM seed.sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()
            if not schema or not schema[0]:
                print(f"skip {table}: no schema")
                continue
            live.execute(schema[0])
            live_cols = _columns(live, "main", table)
        have = {name for name, _typ in live_cols}
        for name, typ in seed_cols:
            if name not in have:
                live.execute(f"ALTER TABLE main.[{table}] ADD COLUMN [{name}] {typ}")
        cols = [name for name, _typ in seed_cols if name in {n for n, _t in _columns(live, "main", table)}]
        listed = ", ".join(f"[{name}]" for name in cols)
        live.execute(f"DELETE FROM main.[{table}]")
        live.execute(f"INSERT INTO main.[{table}] ({listed}) SELECT {listed} FROM seed.[{table}]")
        count = live.execute(f"SELECT COUNT(*) FROM main.[{table}]").fetchone()[0]
        maximum = live.execute(f"SELECT MAX([{pk}]) FROM main.[{table}]").fetchone()[0] or 0
        try:
            live.execute(
                "INSERT INTO sqlite_sequence(name, seq) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=?)",
                (table, maximum, table),
            )
            live.execute("UPDATE sqlite_sequence SET seq=? WHERE name=?", (maximum, table))
        except sqlite3.OperationalError:
            pass
        print(f"{table} {count}")
    live.commit()
    live.execute("DETACH DATABASE seed")
    live.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: apply_shutdown_tables.py LIVE_DB SEED_DB")
    apply(sys.argv[1], sys.argv[2])
