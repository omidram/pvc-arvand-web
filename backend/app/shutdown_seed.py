"""Replace live shutdown tables from the committed plant seed."""
from __future__ import annotations

import logging
import sqlite3
import time
from pathlib import Path

_log = logging.getLogger("uvicorn.error")

TABLES = (
    ("shutdowns", "nr"),
    ("shutdown_causes", "id"),
    ("shutdown_categories", "id"),
)


def _columns(con: sqlite3.Connection, schema: str, table: str) -> list[tuple[str, str]]:
    rows = con.execute(f"PRAGMA {schema}.table_info([{table}])").fetchall()
    return [(row[1], row[2] or "TEXT") for row in rows]


def apply_shutdown_tables(dest: str, seed: str) -> dict[str, int]:
    last: sqlite3.OperationalError | None = None
    for attempt in range(6):
        try:
            return _apply_once(dest, seed)
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc).lower() and "busy" not in str(exc).lower():
                raise
            last = exc
            time.sleep(0.4 * (attempt + 1))
    assert last is not None
    raise last


def _apply_once(dest: str, seed: str) -> dict[str, int]:
    live = sqlite3.connect(dest, timeout=120)
    try:
        live.execute("PRAGMA busy_timeout=120000")
        live.execute("PRAGMA foreign_keys=OFF")
        # Read-only attach: SQLite must not create a journal beside the seed file.
        seed_uri = "file:" + Path(seed).resolve().as_posix() + "?mode=ro"
        live.execute("ATTACH DATABASE ? AS seed", (seed_uri,))
        counts: dict[str, int] = {}
        try:
            live.execute("BEGIN IMMEDIATE")
            counts = _copy_tables(live)
            live.commit()
        except Exception:
            try:
                live.rollback()
            except sqlite3.Error:
                pass
            raise
        finally:
            try:
                live.execute("DETACH DATABASE seed")
            except sqlite3.Error:
                pass
    finally:
        live.close()
    _log.info("Loaded shutdown tables from seed: %s", counts)
    return counts


def _copy_tables(live: sqlite3.Connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table, pk in TABLES:
        seed_cols = _columns(live, "seed", table)
        if not seed_cols:
            _log.warning("shutdown seed has no table %s", table)
            continue
        live_cols = _columns(live, "main", table)
        if not live_cols:
            schema = live.execute(
                "SELECT sql FROM seed.sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()
            if not schema or not schema[0]:
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
        count = int(live.execute(f"SELECT COUNT(*) FROM main.[{table}]").fetchone()[0])
        maximum = live.execute(f"SELECT MAX([{pk}]) FROM main.[{table}]").fetchone()[0] or 0
        try:
            live.execute(
                "INSERT INTO sqlite_sequence(name, seq) SELECT ?, ? "
                "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=?)",
                (table, maximum, table),
            )
            live.execute("UPDATE sqlite_sequence SET seq=? WHERE name=?", (maximum, table))
        except sqlite3.OperationalError:
            pass
        counts[table] = count
        print(f"{table} {count}")
    return counts
