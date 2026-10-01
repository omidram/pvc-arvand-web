"""Industrial English names for Uhde Einzelteile (cell BOM / Cell Components).

Access stored German Benennung values (Zellenelement, Distanzstreifen Anode, …).
This map is the plant catalog used on display, export, import, and migration.
Custom names that are not in the catalog are left unchanged.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from . import models

ENGLISH_BY_PART: dict[str, str] = {
    "100": "Cell element",
    "131": "Anode spacer strip",
    "132": "Cathode spacer strip",
    "133": "Insert pipes",
    "141": "Anode flange",
    "142": "Cathode flange",
    "146": "Frame gasket",
    "148": "Hexagon bolt",
    "149": "Hexagon nut",
    "150": "Belleville washer",
    "151": "Insulating washer",
    "152": "Insulating sleeve",
    "165": "Blind plug",
    "166": "Plug",
    "180": "Flange insulator set",
}

# Normalized German (and English aliases) → industrial English.
_NAME_TO_EN: dict[str, str] = {
    "zellenelement": "Cell element",
    "cell element": "Cell element",
    "distanzstreifen anode": "Anode spacer strip",
    "anode spacer strip": "Anode spacer strip",
    "distanzstreifen kathode": "Cathode spacer strip",
    "cathode spacer strip": "Cathode spacer strip",
    "einsteckrohre": "Insert pipes",
    "einsteckrohr": "Insert pipes",
    "insert pipes": "Insert pipes",
    "insert pipe": "Insert pipes",
    "anodenflansch": "Anode flange",
    "anode flange": "Anode flange",
    "kathodenflansch": "Cathode flange",
    "cathode flange": "Cathode flange",
    "rahmendichtung": "Frame gasket",
    "frame gasket": "Frame gasket",
    "sechskantschraube": "Hexagon bolt",
    "hexagon bolt": "Hexagon bolt",
    "hex head bolt": "Hexagon bolt",
    "sechskantmutter": "Hexagon nut",
    "hexagon nut": "Hexagon nut",
    "tellerpannscheibe": "Belleville washer",
    "tellerspannscheibe": "Belleville washer",
    "tellerfederscheibe": "Belleville washer",
    "belleville washer": "Belleville washer",
    "disc spring washer": "Belleville washer",
    "isolierscheibe": "Insulating washer",
    "insulating washer": "Insulating washer",
    "isolierhuelse": "Insulating sleeve",
    "insulating sleeve": "Insulating sleeve",
    "blindstopfen": "Blind plug",
    "blind plug": "Blind plug",
    "stopfen": "Plug",
    "plug": "Plug",
    "flanschisolator satz": "Flange insulator set",
    "flanschisolatorsatz": "Flange insulator set",
    "flange insulator set": "Flange insulator set",
}


def _norm(value: str | None) -> str:
    if not value:
        return ""
    text = value.strip().lower()
    for src, dst in (
        ("ä", "ae"),
        ("ö", "oe"),
        ("ü", "ue"),
        ("ß", "ss"),
        ("-", " "),
        ("_", " "),
    ):
        text = text.replace(src, dst)
    return " ".join(text.split())


def industrial_english(name: str | None, part_nr: str | None = None) -> str | None:
    """Translate a known German/alias BOM name to industrial English.

    Unknown custom descriptions are returned unchanged.
    """
    key = _norm(name)
    if key in _NAME_TO_EN:
        return _NAME_TO_EN[key]
    if not key:
        part = (part_nr or "").strip()
        return ENGLISH_BY_PART.get(part, name)
    return name


def persist_industrial_names(db: Session) -> int:
    """Rewrite stored German catalog names to industrial English. Returns rows changed."""
    changed = 0
    try:
        rows = db.query(models.CellComponent).all()
    except Exception:
        return 0
    for row in rows:
        next_name = industrial_english(row.name, row.part_nr)
        if next_name and next_name != row.name:
            row.name = next_name
            changed += 1
    if changed:
        db.commit()
    return changed
