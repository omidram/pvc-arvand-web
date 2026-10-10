"""Dropdown (combo) values for data-entry fields.

Every combo offers the union of:
  * values the plant added on purpose (table ``field_options``), and
  * values already used by records of that field (so nothing typed earlier is lost).

The ``/field-options/items`` endpoints back the "Field lists" settings tab, where new values can be
defined, renamed (optionally in all records) or removed.
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, update
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter(prefix="/field-options", tags=["field-options"])

_COMMON = ["assembly_group", "manufacturer", "tank", "contact_strip", "electrode_support", "electrode_shape", "coating"]
_ELECTRODE_TAIL = ["inlet_system", "standpipe_diameter", "flange_width", "batch", "generation"]

# table -> (model, ordered list of fields that get a combo)
CATALOG: dict[str, tuple[Any, list[str]]] = {
    "anodes": (models.Anode, _COMMON + ["baffle_plate", "downcomer"] + _ELECTRODE_TAIL),
    "cathodes": (models.Cathode, _COMMON + _ELECTRODE_TAIL),
    "membranes": (models.Membrane, ["membrane_type", "batch"]),
    "elements": (
        models.Element,
        [
            "generation",
            "membrane_type",
            "decommission_reason",
            "gap_mm",
            "ispb",
            "anode_coating",
            "anode_electrode",
            "anode_shell",
            "cathode_coating",
            "cathode_electrode",
            "cathode_shell",
            "membrane_info",
        ],
    ),
}

# Values every installation starts with (shown even before any record uses them).
BUILT_IN: dict[tuple[str, str], list[str]] = {
    ("elements", "generation"): ["3", "4", "5", "5+", "6", "6+", "Blue Star"],
}


def _natural(value: str):
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", value)]


def _clean(value: str | None) -> str:
    return " ".join((value or "").split())


def _check(table: str, field: str | None = None):
    entry = CATALOG.get(table)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Unknown table '{table}'")
    if field is not None and field not in entry[1]:
        raise HTTPException(status_code=404, detail=f"'{field}' has no list in '{table}'")
    return entry


def _in_use(db: Session, table: str, field: str) -> dict[str, int]:
    model = CATALOG[table][0]
    col = getattr(model, field)
    rows = db.query(col, func.count()).filter(col.isnot(None)).group_by(col).all()
    used: dict[str, int] = {}
    for raw, count in rows:
        text = _clean(str(raw))
        if text:
            used[text] = used.get(text, 0) + int(count)
    return used


def _items(db: Session, table: str, field: str) -> list[dict[str, Any]]:
    """Every value of one field with its origin and how many records use it."""
    used = _in_use(db, table, field)
    by_key: dict[str, dict[str, Any]] = {}
    for value in BUILT_IN.get((table, field), []):
        by_key[value.lower()] = {"id": None, "value": value, "managed": False, "built_in": True, "count": used.get(value, 0)}
    for opt in db.query(models.FieldOption).filter_by(table_name=table, field_name=field).all():
        by_key[opt.value.lower()] = {"id": opt.id, "value": opt.value, "managed": True, "built_in": False, "count": used.get(opt.value, 0)}
    for value, count in used.items():
        key = value.lower()
        if key in by_key:
            by_key[key]["count"] = max(by_key[key]["count"], count)
        else:
            by_key[key] = {"id": None, "value": value, "managed": False, "built_in": False, "count": count}
    return sorted(by_key.values(), key=lambda r: _natural(r["value"]))


class OptionIn(BaseModel):
    table: str
    field: str
    value: str = Field(min_length=1, max_length=200)


class OptionRename(BaseModel):
    value: str = Field(min_length=1, max_length=200)
    apply_to_records: bool = False


@router.get("/catalog")
def catalog():
    return [{"table": table, "fields": fields} for table, (_, fields) in CATALOG.items()]


@router.get("/values")
def values(table: str = Query(...), db: Session = Depends(get_db)):
    """``{field: [value, ...]}`` for every combo field of a table (used by the data-entry forms)."""
    _, fields = _check(table)
    return {field: [i["value"] for i in _items(db, table, field)] for field in fields}


@router.get("/items")
def items(table: str = Query(...), field: str = Query(...), db: Session = Depends(get_db)):
    _check(table, field)
    return _items(db, table, field)


@router.post("")
def add_option(payload: OptionIn, db: Session = Depends(get_db)):
    _check(payload.table, payload.field)
    value = _clean(payload.value)
    if not value:
        raise HTTPException(status_code=400, detail="Value is empty")
    existing = [
        o for o in db.query(models.FieldOption).filter_by(table_name=payload.table, field_name=payload.field).all()
        if o.value.lower() == value.lower()
    ]
    if existing:
        raise HTTPException(status_code=409, detail=f"'{value}' is already in the list")
    row = models.FieldOption(table_name=payload.table, field_name=payload.field, value=value)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "value": row.value}


@router.put("/{option_id}")
def rename_option(option_id: int, payload: OptionRename, db: Session = Depends(get_db)):
    row = db.get(models.FieldOption, option_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    new_value = _clean(payload.value)
    if not new_value:
        raise HTTPException(status_code=400, detail="Value is empty")
    clash = [
        o for o in db.query(models.FieldOption).filter_by(table_name=row.table_name, field_name=row.field_name).all()
        if o.id != row.id and o.value.lower() == new_value.lower()
    ]
    if clash:
        raise HTTPException(status_code=409, detail=f"'{new_value}' is already in the list")
    old_value = row.value
    updated = 0
    if payload.apply_to_records and old_value != new_value:
        model = CATALOG[row.table_name][0]
        col = getattr(model, row.field_name)
        updated = db.execute(update(model).where(col == old_value).values({row.field_name: new_value})).rowcount or 0
    row.value = new_value
    db.commit()
    return {"id": row.id, "value": row.value, "records_updated": updated}


@router.delete("/{option_id}")
def delete_option(option_id: int, db: Session = Depends(get_db)):
    row = db.get(models.FieldOption, option_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
