"""Merge duplicate anode/cathode master rows that differ only by whitespace.

Example: ``UA 30064`` and ``UA30064`` → keep ``UA30064``, remap all FKs, delete spaced PK.
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal


def compact(value: str | None) -> str:
    return re.sub(r"\s+", "", (value or "").strip()).upper()


def prefer_key(candidates: list[str]) -> str:
    """Prefer compact form without spaces; then densest non-empty fields later."""
    no_space = [c for c in candidates if " " not in c and "\t" not in c]
    pool = no_space or candidates
    return sorted(pool, key=lambda s: (len(s), s))[0]


def filled_score(row) -> int:
    return sum(1 for v in row.__dict__.values() if v not in (None, "", []))


def merge_fields(keeper, loser) -> None:
    for col in loser.__table__.columns:
        name = col.name
        if name in ("anode_nr", "cathode_nr"):
            continue
        kv = getattr(keeper, name, None)
        lv = getattr(loser, name, None)
        if (kv is None or kv == "") and lv not in (None, ""):
            setattr(keeper, name, lv)


def remap_string_column(db: Session, table: str, column: str, old: str, new: str) -> int:
    result = db.execute(
        text(f"UPDATE {table} SET {column} = :new WHERE {column} = :old"),
        {"old": old, "new": new},
    )
    return result.rowcount or 0


ANODE_REFS = [
    ("elements", "anode_nr"),
    ("anode_maintenance", "anode_nr"),
    ("anode_recoating", "anode_nr"),
    ("anode_coating_checks", "anode_nr"),
    ("assembly_inspection_reports", "anode_nr"),
    ("inspection_reports", "anode_nr"),
    ("electrode_segregations", "serial_nr"),
    ("electrode_segregations", "pair_serial_nr"),
    ("wh_element_states", "serial"),
    ("wh_coating_dispatch_items", "serial"),
    ("wh_coating_receiving_items", "serial"),
    ("wh_purchase_items", "serial"),
    ("wh_punches", "serial"),
    ("wh_decommissions", "serial"),
    ("wh_lifecycle_events", "serial"),
    ("maintenance_reports", "component_nr"),
]

CATHODE_REFS = [
    ("elements", "cathode_nr"),
    ("cathode_maintenance", "cathode_nr"),
    ("cathode_recoating", "cathode_nr"),
    ("cathode_coating_checks", "cathode_nr"),
    ("assembly_inspection_reports", "cathode_nr"),
    ("inspection_reports", "cathode_nr"),
    ("electrode_segregations", "serial_nr"),
    ("electrode_segregations", "pair_serial_nr"),
    ("wh_element_states", "serial"),
    ("wh_coating_dispatch_items", "serial"),
    ("wh_coating_receiving_items", "serial"),
    ("wh_purchase_items", "serial"),
    ("wh_punches", "serial"),
    ("wh_decommissions", "serial"),
    ("wh_lifecycle_events", "serial"),
    ("maintenance_reports", "component_nr"),
]


def existing_tables(db: Session) -> set[str]:
    rows = db.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    return {r[0] for r in rows}


def dedupe_kind(db: Session, model, pk_attr: str, refs: list[tuple[str, str]]) -> dict:
    rows = db.query(model).all()
    groups: dict[str, list] = defaultdict(list)
    for row in rows:
        key = compact(getattr(row, pk_attr))
        if key:
            groups[key].append(row)

    tables = existing_tables(db)
    merged = 0
    deleted = 0
    remapped = 0
    examples: list[str] = []

    for key, members in groups.items():
        if len(members) < 2:
            continue
        # Prefer densest compact PK
        members_sorted = sorted(members, key=lambda r: (-filled_score(r), " " in getattr(r, pk_attr), getattr(r, pk_attr)))
        # Prefer no-space PK when scores close
        preferred_pk = prefer_key([getattr(r, pk_attr) for r in members])
        keeper = next((r for r in members_sorted if getattr(r, pk_attr) == preferred_pk), members_sorted[0])
        losers = [r for r in members if r is not keeper]
        for loser in losers:
            old = getattr(loser, pk_attr)
            new = getattr(keeper, pk_attr)
            merge_fields(keeper, loser)
            for table, column in refs:
                if table not in tables:
                    continue
                try:
                    remapped += remap_string_column(db, table, column, old, new)
                except Exception:
                    db.rollback()
                    # re-bind session state after rollback — continue best-effort
                    db.begin()
            db.delete(loser)
            deleted += 1
            if len(examples) < 12:
                examples.append(f"{old} → {new}")
        merged += 1

    db.commit()
    return {"groups_merged": merged, "rows_deleted": deleted, "fk_updates": remapped, "examples": examples}


def main() -> None:
    db = SessionLocal()
    try:
        before_a = db.query(models.Anode).count()
        before_c = db.query(models.Cathode).count()
        a = dedupe_kind(db, models.Anode, "anode_nr", ANODE_REFS)
        c = dedupe_kind(db, models.Cathode, "cathode_nr", CATHODE_REFS)
        after_a = db.query(models.Anode).count()
        after_c = db.query(models.Cathode).count()
        print("anodes", before_a, "->", after_a, a)
        print("cathodes", before_c, "->", after_c, c)
    finally:
        db.close()


if __name__ == "__main__":
    main()
