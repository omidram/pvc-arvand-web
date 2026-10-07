"""Relationship integrity for Assembly Data (elements).

Assembly rows are installation records: one row = one set of anode / cathode /
membrane installed in one cell (electrolyzer + position) during one period.
Nothing in the schema enforces that, and imports from Access/Excel leave:

* exact duplicate installations (the same sheet imported twice),
* installations that were never closed although a newer installation took over the
  same cell or the same anode / cathode / membrane - their days-on-line then keep
  counting up to today,
* positions stored with and without zero padding.

``plan_repairs`` only reads; ``apply_repairs`` writes. The same rules are used when
one installation is saved (``close_superseded_by``), so new data stays consistent.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .calculations import installation_dol

_NOT_A_PART = re.compile(r"\d")


def _text(value) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def _day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def part_key(value) -> str:
    """Compact serial; placeholders such as 'بدون مشخصات' (no digit) never identify a part."""
    key = _text(value)
    return key if key and _NOT_A_PART.search(key) else ""


def position_int(value) -> int | None:
    text = str(value or "").strip()
    return int(text) if re.fullmatch(r"\d+", text) else None


def cell_key(row: models.Element) -> tuple[str, int] | None:
    electrolyzer = _text(row.electrolyzer)
    position = position_int(row.position)
    if not electrolyzer or not position:
        return None
    return electrolyzer, position


def installed_on(row: models.Element) -> date | None:
    """Day the installation physically started (assembly, else commissioning)."""
    return _day(row.assembly_date) or _day(row.commissioning_date)


def is_open(row: models.Element) -> bool:
    return _day(row.disassembly_date) is None and _day(row.decommissioning_date) is None


def installation_signature(row: models.Element) -> tuple:
    return (
        _text(row.electrolyzer),
        position_int(row.position),
        _day(row.assembly_date),
        _text(row.anode_nr),
        _text(row.cathode_nr),
    )


_COMPARED = (
    "element_nr", "electrolyzer", "group_nr", "generation", "anode_nr", "cathode_nr",
    "membrane_nr", "membrane_type", "gap_mm", "assembly_date", "commissioning_date",
    "decommissioning_date", "disassembly_date", "dol_days", "decommission_reason", "ispb",
    "anode_coating", "anode_electrode", "anode_shell", "cathode_coating", "cathode_electrode",
    "cathode_shell", "membrane_info", "remarks", "membrane_remark", "anode_remark", "cathode_remark",
)


def _filled(row: models.Element) -> int:
    return sum(1 for name in _COMPARED if str(getattr(row, name) or "").strip())


def _links(row: models.Element) -> list[tuple[str, object]]:
    links: list[tuple[str, object]] = []
    cell = cell_key(row)
    if cell:
        links.append(("cell", cell))
    for kind, value in (("anode", row.anode_nr), ("cathode", row.cathode_nr), ("membrane", row.membrane_nr)):
        key = part_key(value)
        if key:
            links.append((kind, key))
    return links


def superseded_map(rows: list[models.Element], today: date | None = None) -> dict[int, date]:
    """{element id: day it was replaced} for installations still open although replaced.

    Replaced = a later installation (strictly later start, not in the future) took the
    same cell or the same anode / cathode / membrane.
    """
    today = today or date.today()
    by_link: dict[tuple[str, object], list[models.Element]] = defaultdict(list)
    for row in rows:
        for link in _links(row):
            by_link[link].append(row)
    result: dict[int, date] = {}
    for row in rows:
        if not is_open(row):
            continue
        start = installed_on(row)
        if start is None:
            continue
        ends: list[date] = []
        for link in _links(row):
            for other in by_link[link]:
                if other is row:
                    continue
                other_start = installed_on(other)
                if other_start and start < other_start <= today:
                    ends.append(other_start)
        if ends:
            result[row.id] = min(ends)
    return result


def close_superseded_by(db: Session, saved: models.Element) -> int:
    """After saving one installation, close the earlier open ones it replaced."""
    start = installed_on(saved)
    if start is None or start > date.today():
        return 0
    links = _links(saved)
    if not links:
        return 0
    closed = 0
    candidates: dict[int, models.Element] = {}
    for kind, value in links:
        if kind == "cell":
            query = db.query(models.Element).filter(models.Element.electrolyzer.isnot(None))
            rows = [r for r in query.all() if cell_key(r) == value]
        else:
            column = {
                "anode": models.Element.anode_nr,
                "cathode": models.Element.cathode_nr,
                "membrane": models.Element.membrane_nr,
            }[kind]
            rows = db.query(models.Element).filter(func.upper(func.replace(column, " ", "")) == value).all()
        for row in rows:
            candidates[row.id] = row
    for row in candidates.values():
        if row is saved or row.id == saved.id or not is_open(row):
            continue
        other_start = installed_on(row)
        if other_start is None or not other_start < start:
            continue
        row.disassembly_date = start
        row.dol_days = installation_dol(row.assembly_date, row.commissioning_date, row.disassembly_date, row.decommissioning_date)
        closed += 1
    return closed


def close_all_superseded(db: Session) -> int:
    """Close every replaced-but-open installation (used after bulk imports)."""
    rows = db.query(models.Element).all()
    by_id = {row.id: row for row in rows}
    closed = 0
    for element_id, end in superseded_map(rows).items():
        row = by_id[element_id]
        row.disassembly_date = end
        row.dol_days = installation_dol(row.assembly_date, row.commissioning_date, row.disassembly_date, row.decommissioning_date)
        closed += 1
    return closed


def find_same_installation(db: Session, probe: models.Element, exclude_id: int | None = None) -> models.Element | None:
    """Another saved row that is the same installation as ``probe``."""
    signature = installation_signature(probe)
    if not signature[0] or signature[1] is None:
        return None
    rows = db.query(models.Element).filter(models.Element.electrolyzer.isnot(None)).all()
    for row in rows:
        if exclude_id is not None and row.id == exclude_id:
            continue
        if installation_signature(row) == signature:
            return row
    return None


def find_duplicate_groups(rows: list[models.Element]) -> list[list[models.Element]]:
    """Rows that are the same installation (cell, assembly date, anode, cathode) and carry
    the same data - the second copy adds nothing."""
    groups: dict[tuple, list[models.Element]] = defaultdict(list)
    for row in rows:
        signature = installation_signature(row)
        if signature[0] and signature[1] is not None:
            groups[signature].append(row)
    out = []
    for members in groups.values():
        if len(members) < 2:
            continue
        # only drop copies that are identical in every stored value
        keep = members[0]
        same = [keep] + [
            r for r in members[1:] if all(getattr(r, name) == getattr(keep, name) for name in _COMPARED)
        ]
        if len(same) > 1:
            out.append(same)
    return out


def plan_repairs(db: Session) -> dict:
    rows = db.query(models.Element).order_by(models.Element.id.asc()).all()
    duplicates = find_duplicate_groups(rows)
    drop_ids = {r.id for group in duplicates for r in group[1:]}
    live = [r for r in rows if r.id not in drop_ids]
    superseded = superseded_map(live)
    padding = [
        (r.id, f"{position_int(r.position):03d}")
        for r in live
        if position_int(r.position) and 1 <= position_int(r.position) <= 168 and str(r.position).strip() != f"{position_int(r.position):03d}"
    ]
    return {
        "elements": len(rows),
        "duplicates": [[r.id for r in group] for group in duplicates],
        "superseded": {int(k): v for k, v in superseded.items()},
        "padding": padding,
    }


def apply_repairs(db: Session, plan: dict | None = None) -> dict:
    plan = plan or plan_repairs(db)
    removed = 0
    for group in plan["duplicates"]:
        for element_id in group[1:]:
            row = db.query(models.Element).filter(models.Element.id == element_id).first()
            if row is not None:
                db.delete(row)
                removed += 1
    db.flush()

    closed = 0
    for element_id, end in plan["superseded"].items():
        row = db.query(models.Element).filter(models.Element.id == element_id).first()
        if row is None or not is_open(row):
            continue
        row.disassembly_date = end
        row.dol_days = installation_dol(row.assembly_date, row.commissioning_date, row.disassembly_date, row.decommissioning_date)
        closed += 1

    padded = 0
    for element_id, value in plan["padding"]:
        row = db.query(models.Element).filter(models.Element.id == element_id).first()
        if row is not None and row.position != value:
            row.position = value
            padded += 1
    db.commit()
    return {"duplicates_removed": removed, "installations_closed": closed, "positions_padded": padded}


def summarize(plan: dict) -> dict:
    return {
        "elements": plan["elements"],
        "duplicate_installations": sum(len(group) - 1 for group in plan["duplicates"]),
        "unclosed_replaced_installations": len(plan["superseded"]),
        "unpadded_positions": len(plan["padding"]),
    }
