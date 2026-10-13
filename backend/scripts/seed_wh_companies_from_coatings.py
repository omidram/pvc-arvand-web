"""Fill wh_companies from the coating / recoating company names found in the element data.

Spelling variants are merged into one company; the matched variants and element counts are kept in remarks.
Safe to re-run: existing companies (same name) are only updated, never duplicated.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func

from app import models
from app.database import SessionLocal

# name -> (is_coating, is_supplier, variants as written in anodes/cathodes.coating or *_recoating.manufacturer)
COMPANIES: dict[str, tuple[bool, bool, list[str]]] = {
    "دنورا (De Nora)": (
        True,
        True,
        ["دنورا", "original(دنورا)", "دنوار", "تعمیراتی دنورا", "دنورا (فاقد کوتینگ)", "دنورا( فاقد کوتینگ)", "خریداری دنورا"],
    ),
    "آنکان (ANCAN)": (True, False, ["آنکان", "ANCAN", "آنکان (قابل استفاده)"]),
    "شرکت رف رف": (True, False, ["شرکت رف رف", "رف رف"]),
    "پرماسکند (Permascand)": (True, True, ["پرماسکند", "شرکت پرماسکند", "NEW-PERMAS"]),
    "آتیه پردازان شریف": (True, False, ["آتیه پردازان شریف", "آتیه پردازان"]),
    "پرتو صنعت پاژ": (True, False, ["پرتو صنعت پاژ", "شرکت پرتو صنعت باز"]),
}


def _count(db, model, column, values: list[str]) -> int:
    return db.query(func.count()).select_from(model).filter(column.in_(values)).scalar() or 0


def main() -> None:
    db = SessionLocal()
    try:
        for name, (coating, supplier, variants) in COMPANIES.items():
            anodes = _count(db, models.Anode, models.Anode.coating, variants)
            cathodes = _count(db, models.Cathode, models.Cathode.coating, variants)
            recoats = _count(db, models.AnodeRecoating, models.AnodeRecoating.manufacturer, variants) + _count(
                db, models.CathodeRecoating, models.CathodeRecoating.manufacturer, variants
            )
            remarks = (
                f"From element coating data: {anodes} anodes, {cathodes} cathodes"
                + (f", {recoats} recoating records" if recoats else "")
                + f". Spellings: {', '.join(variants)}"
            )
            row = db.query(models.WhCompany).filter(models.WhCompany.name == name).first()
            if row is None:
                row = models.WhCompany(name=name, created_at=datetime.now())
                db.add(row)
                state = "added"
            else:
                state = "updated"
            row.is_coating = row.is_coating or coating
            row.is_supplier = row.is_supplier or supplier
            if not row.remarks:
                row.remarks = remarks
            print(f"{state}: {name} — {anodes} A / {cathodes} K / {recoats} recoat")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
