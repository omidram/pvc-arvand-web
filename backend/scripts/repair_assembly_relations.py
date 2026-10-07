"""Repair Assembly Data relationships (dry run unless --apply).

Removes exact duplicate installations, closes installations that were replaced by a later
one (same cell or same anode/cathode/membrane) and pads positions to 001-168.

    python scripts/repair_assembly_relations.py            # report only
    python scripts/repair_assembly_relations.py --apply    # write
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.assembly_integrity import apply_repairs, plan_repairs, summarize
from app.database import SessionLocal


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    db = SessionLocal()
    try:
        plan = plan_repairs(db)
        print("found:", summarize(plan))
        if "--apply" in sys.argv:
            print("applied:", apply_repairs(db, plan))
        else:
            print("dry run - nothing written (use --apply)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
