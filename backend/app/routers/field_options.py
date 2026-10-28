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
from ..workflow_models import MembraneStock

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
            "membrane_remark",  # membrane use: نو / reused
            "remarks",  # current status of the element
        ],
    ),
    # TAFKIK segregation sheet: quality grades and decisions repeat from row to row.
    "segregations": (
        models.ElectrodeSegregation,
        ["company", "voltage_quality", "warranty", "coating_quality", "decision"],
    ),
    # Group Definition: its combos offer what the cell elements / anodes / cathodes / membranes already carry
    # (the plant's Excel lists were imported into those), plus anything added in Settings → Field lists.
    "group_definitions": (models.GroupDefinition, ["anode_coating", "cathode_coating", "membrane_type", "gap_mm"]),
}

# One shared pool: every combo that is tied to Assembly Data, the columns it is read from,
# and the dropdowns that must offer the same values.
# fields: (field_options table, field). sources: (model, column) distinct values.
ASSEMBLY_RELATIONS: list[dict[str, Any]] = [
    {
        # One coating-company pool: assembly, anode, cathode, group definition and segregation.
        "fields": [
            ("elements", "anode_coating"),
            ("elements", "cathode_coating"),
            ("anodes", "coating"),
            ("cathodes", "coating"),
            ("group_definitions", "anode_coating"),
            ("group_definitions", "cathode_coating"),
            ("segregations", "company"),
        ],
        "sources": [
            (models.Element, "anode_coating"),
            (models.Element, "cathode_coating"),
            (models.Anode, "coating"),
            (models.Cathode, "coating"),
            (models.GroupDefinition, "anode_coating"),
            (models.GroupDefinition, "cathode_coating"),
            (models.ElectrodeSegregation, "company"),
        ],
    },
    {
        "fields": [("elements", "membrane_type"), ("membranes", "membrane_type"), ("group_definitions", "membrane_type")],
        "sources": [(models.Element, "membrane_type"), (models.Membrane, "membrane_type"), (models.GroupDefinition, "membrane_type"), (MembraneStock, "membrane_type")],
    },
    {
        "fields": [("elements", "gap_mm"), ("group_definitions", "gap_mm")],
        "sources": [(models.Element, "gap_mm"), (models.GroupDefinition, "gap_mm")],
    },
    {
        "fields": [("elements", "generation")],
        "sources": [(models.Element, "generation"), (models.Anode, "generation"), (models.Cathode, "generation")],
        "built_in": ["3", "4", "5", "5+", "6", "6+", "Blue Star"],
    },
    {
        "fields": [("elements", "membrane_remark")],
        "sources": [(models.Element, "membrane_remark")],
        "built_in": ["نو", "reused"],
    },
    {
        "fields": [("elements", "anode_shell")],
        "sources": [(models.Element, "anode_shell")],
        "built_in": ["دنوار(ایتالیا)", "بلو استار (چین)", "دنورا"],
    },
    {
        "fields": [("elements", "cathode_shell")],
        "sources": [(models.Element, "cathode_shell")],
        "built_in": ["دنوار(ایتالیا)", "بلو استار (چین)", "دنورا"],
    },
    {"fields": [("elements", "anode_electrode")], "sources": [(models.Element, "anode_electrode")]},
    {"fields": [("elements", "cathode_electrode")], "sources": [(models.Element, "cathode_electrode")]},
    {"fields": [("elements", "membrane_info")], "sources": [(models.Element, "membrane_info")]},
    {"fields": [("elements", "ispb")], "sources": [(models.Element, "ispb")]},
    {"fields": [("elements", "remarks")], "sources": [(models.Element, "remarks")]},
    {"fields": [("elements", "decommission_reason")], "sources": [(models.Element, "decommission_reason")]},
]


def _relation(table: str, field: str) -> dict[str, Any] | None:
    for rel in ASSEMBLY_RELATIONS:
        if (table, field) in rel["fields"]:
            return rel
    return None


def _extras(table: str, field: str, sources: list[tuple[Any, str]]) -> list[tuple[Any, str]]:
    model = CATALOG[table][0]
    return [pair for pair in sources if pair != (model, field)]


_CATALOG_FIELDS = {(name, col) for name, (_model, cols) in CATALOG.items() for col in cols}
EXTRA_SOURCES: dict[tuple[str, str], list[tuple[Any, str]]] = {
    (table, field): _extras(table, field, rel["sources"])
    for rel in ASSEMBLY_RELATIONS
    for table, field in rel["fields"]
    if (table, field) in _CATALOG_FIELDS
}

BUILT_IN: dict[tuple[str, str], list[str]] = {
    (table, field): list(rel.get("built_in") or [])
    for rel in ASSEMBLY_RELATIONS
    for table, field in rel["fields"]
    if rel.get("built_in")
}

SEED_VERSION = "3"


def _distinct(db: Session, model: Any, column: str) -> list[str]:
    col = getattr(model, column)
    found: list[str] = []
    seen: set[str] = set()
    for (raw,) in db.query(col).filter(col.isnot(None)).distinct().all():
        text = _clean(str(raw))
        if not text or len(text) > 200:
            continue
        key = _key(text)
        if key in seen:
            continue
        seen.add(key)
        found.append(text)
    return found


def sync_assembly_combos(db: Session) -> int:
    """Delete every Assembly-linked combo value and write it again from the related tables.

    Built-in seeds (generation, membrane use, shell) are written even when no row uses them yet.
    """
    written = 0
    for rel in ASSEMBLY_RELATIONS:
        values: list[str] = []
        seen: set[str] = set()
        for text in list(rel.get("built_in") or []):
            clean = _clean(text)
            if clean and _key(clean) not in seen:
                seen.add(_key(clean))
                values.append(clean)
        for model, column in rel["sources"]:
            for text in _distinct(db, model, column):
                if _key(text) not in seen:
                    seen.add(_key(text))
                    values.append(text)
        for table, field in rel["fields"]:
            if table not in CATALOG or field not in CATALOG[table][1]:
                continue
            db.query(models.FieldOption).filter_by(table_name=table, field_name=field).delete(synchronize_session=False)
            for text in values:
                db.add(models.FieldOption(table_name=table, field_name=field, value=text))
                written += 1
    db.flush()
    return written


def publish_assembly_value(db: Session, table: str, field: str, value: str | None) -> None:
    """Keep a newly saved Assembly value in every combo that shares its relation."""
    text = _clean(value)
    if not text or len(text) > 200:
        return
    rel = _relation(table, field)
    targets = rel["fields"] if rel else [(table, field)]
    for item_table, item_field in targets:
        if item_table not in CATALOG or item_field not in CATALOG[item_table][1]:
            continue
        rows = db.query(models.FieldOption).filter_by(table_name=item_table, field_name=item_field).all()
        if any(_key(row.value) == _key(text) for row in rows):
            continue
        db.add(models.FieldOption(table_name=item_table, field_name=item_field, value=text))


def seed_field_options(db: Session) -> int:
    """Rebuild Assembly combos from the related tables once per rules version.

    A marker row (table ``_meta``) stops the wipe from running again on the next start,
    so a value added later in Settings → Field lists is kept.
    """
    marker = db.query(models.FieldOption).filter_by(table_name="_meta", field_name="seed").first()
    if marker and marker.value == SEED_VERSION:
        return 0
    written = sync_assembly_combos(db)
    if marker:
        marker.value = SEED_VERSION
    else:
        db.add(models.FieldOption(table_name="_meta", field_name="seed", value=SEED_VERSION))
    db.commit()
    return written


def _natural(value: str):
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", value)]


def _key(value: str) -> str:
    """Identity of a list value: case-insensitive, and 2 / 2.0 count as the same number."""
    text = value.strip().lower()
    try:
        return repr(float(text.replace(",", ".")))
    except ValueError:
        return text


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
    used: dict[str, int] = {}
    sources = [(CATALOG[table][0], field)] + EXTRA_SOURCES.get((table, field), [])
    for model, column in sources:
        col = getattr(model, column)
        rows = db.query(col, func.count()).filter(col.isnot(None)).group_by(col).all()
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
        by_key[_key(value)] = {"id": None, "value": value, "managed": False, "built_in": True, "count": used.get(value, 0)}
    for opt in db.query(models.FieldOption).filter_by(table_name=table, field_name=field).all():
        by_key[_key(opt.value)] = {"id": opt.id, "value": opt.value, "managed": True, "built_in": False, "count": used.get(opt.value, 0)}
    # Values pinned in Field lists of the linked tables (e.g. a new coating added for anodes / elements).
    for model, column in EXTRA_SOURCES.get((table, field), []):
        for other, (other_model, _fields) in CATALOG.items():
            if other_model is not model:
                continue
            for opt in db.query(models.FieldOption).filter_by(table_name=other, field_name=column).all():
                by_key.setdefault(
                    _key(opt.value),
                    {"id": None, "value": opt.value, "managed": False, "built_in": False, "count": used.get(opt.value, 0)},
                )
    for value, count in used.items():
        key = _key(value)
        if key in by_key:
            by_key[key]["count"] = max(by_key[key]["count"], count)
        else:
            by_key[key] = {"id": None, "value": value, "managed": False, "built_in": False, "count": count}
    return sorted(by_key.values(), key=lambda r: _natural(r["value"]))


def _targets(table: str, field: str) -> list[tuple[str, str]]:
    """Every combo that must show the same values as this one."""
    rel = _relation(table, field)
    pairs = rel["fields"] if rel else [(table, field)]
    return [(item_table, item_field) for item_table, item_field in pairs if item_table in CATALOG and item_field in CATALOG[item_table][1]]


def _sources(table: str, field: str) -> list[tuple[Any, str]]:
    """Every column whose stored text is this combo."""
    rel = _relation(table, field)
    if rel:
        return list(rel["sources"])
    return [(CATALOG[table][0], field)]


def _raw_matches(db: Session, model: Any, column: str, keys: set[str]) -> list[Any]:
    col = getattr(model, column)
    found: list[Any] = []
    for (raw,) in db.query(col).filter(col.isnot(None)).distinct().all():
        text = _clean(str(raw))
        if text and _key(text) in keys:
            found.append(raw)
    return found


def _bust() -> None:
    from ..element_dashboard import clear_cache

    clear_cache()


def _rewrite(db: Session, table: str, field: str, old_values: list[str], new_value: str | None) -> int:
    """Replace old spellings with one name (or blank) on every linked combo and every record that uses them."""
    keys = {_key(value) for value in old_values if _clean(value)}
    if not keys:
        return 0
    updated = 0
    for model, column in _sources(table, field):
        raws = _raw_matches(db, model, column, keys)
        if not raws:
            continue
        col = getattr(model, column)
        updated += db.execute(update(model).where(col.in_(raws)).values({column: new_value})).rowcount or 0
    if new_value and (field == "membrane_type" or any(column == "membrane_type" for _, column in _sources(table, field))):
        for model, column in ((MembraneStock, "membrane_type"), (MembraneStockMove, "membrane_type")):
            raws = _raw_matches(db, model, column, keys)
            if not raws:
                continue
            col = getattr(model, column)
            updated += db.execute(update(model).where(col.in_(raws)).values({column: new_value})).rowcount or 0
    keep_text = _clean(new_value) if new_value else ""
    for item_table, item_field in _targets(table, field):
        rows = db.query(models.FieldOption).filter_by(table_name=item_table, field_name=item_field).all()
        hit = [row for row in rows if _key(row.value) in keys or (keep_text and _key(row.value) == _key(keep_text))]
        if not keep_text:
            for row in hit:
                db.delete(row)
            continue
        for row in hit[1:]:
            db.delete(row)
        db.flush()
        if hit:
            hit[0].value = keep_text
        else:
            db.add(models.FieldOption(table_name=item_table, field_name=item_field, value=keep_text))
    return updated


def _clear_list(db: Session, table: str, field: str, clear_records: bool) -> int:
    """Remove every value of a combo. With clear_records the cells that used those values are blanked too."""
    updated = 0
    if clear_records:
        for model, column in _sources(table, field):
            col = getattr(model, column)
            updated += db.execute(update(model).where(col.isnot(None), col != "").values({column: None})).rowcount or 0
    for item_table, item_field in _targets(table, field):
        db.query(models.FieldOption).filter_by(table_name=item_table, field_name=item_field).delete(synchronize_session=False)
    return updated


class OptionIn(BaseModel):
    table: str
    field: str
    value: str = Field(min_length=1, max_length=200)


class OptionRename(BaseModel):
    value: str = Field(min_length=1, max_length=200)
    apply_to_records: bool = True


class OptionMerge(BaseModel):
    table: str
    field: str
    values: list[str] = Field(min_length=1)
    into: str = Field(min_length=1, max_length=200)


class OptionPurge(BaseModel):
    table: str
    field: str
    values: list[str] = []
    clear_records: bool = True


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
    db.flush()
    publish_assembly_value(db, payload.table, payload.field, value)
    db.commit()
    db.refresh(row)
    _bust()
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
    if old_value != new_value:
        if payload.apply_to_records:
            updated = _rewrite(db, row.table_name, row.field_name, [old_value], new_value)
        else:
            _rewrite_lists_only(db, row.table_name, row.field_name, [old_value], new_value)
    db.commit()
    _bust()
    return {"id": option_id, "value": new_value, "records_updated": updated}


def _rewrite_lists_only(db: Session, table: str, field: str, old_values: list[str], new_value: str) -> None:
    keys = {_key(value) for value in old_values if _clean(value)}
    keep_text = _clean(new_value)
    for item_table, item_field in _targets(table, field):
        rows = db.query(models.FieldOption).filter_by(table_name=item_table, field_name=item_field).all()
        hit = [row for row in rows if _key(row.value) in keys or _key(row.value) == _key(keep_text)]
        for row in hit[1:]:
            db.delete(row)
        db.flush()
        if hit:
            hit[0].value = keep_text
        elif keep_text:
            db.add(models.FieldOption(table_name=item_table, field_name=item_field, value=keep_text))


@router.post("/merge")
def merge_options(payload: OptionMerge, db: Session = Depends(get_db)):
    """Fold several spellings of one combo into a single name, on every form and every record."""
    _check(payload.table, payload.field)
    into = _clean(payload.into)
    values = [_clean(value) for value in payload.values if _clean(value)]
    distinct = {_key(value) for value in values}
    distinct.add(_key(into))
    if len(distinct) < 2:
        raise HTTPException(status_code=400, detail="Choose at least two different values")
    if not into:
        raise HTTPException(status_code=400, detail="Value is empty")
    updated = _rewrite(db, payload.table, payload.field, values, into)
    db.commit()
    _bust()
    return {"value": into, "records_updated": updated}


@router.post("/purge")
def purge_options(payload: OptionPurge, db: Session = Depends(get_db)):
    """Delete one combo list, or the chosen values, from every linked dropdown and (by default) from the records."""
    _check(payload.table, payload.field)
    if payload.values:
        if payload.clear_records:
            updated = _rewrite(db, payload.table, payload.field, payload.values, None)
        else:
            updated = 0
            keys = {_key(_clean(value)) for value in payload.values if _clean(value)}
            for item_table, item_field in _targets(payload.table, payload.field):
                for row in db.query(models.FieldOption).filter_by(table_name=item_table, field_name=item_field).all():
                    if _key(row.value) in keys:
                        db.delete(row)
    else:
        updated = _clear_list(db, payload.table, payload.field, payload.clear_records)
    db.commit()
    _bust()
    return {"ok": True, "records_updated": updated}


@router.delete("/{option_id}")
def delete_option(option_id: int, complete: bool = False, db: Session = Depends(get_db)):
    row = db.get(models.FieldOption, option_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    updated = 0
    if complete:
        updated = _rewrite(db, row.table_name, row.field_name, [row.value], None)
    else:
        keys = {_key(row.value)}
        for item_table, item_field in _targets(row.table_name, row.field_name):
            for opt in db.query(models.FieldOption).filter_by(table_name=item_table, field_name=item_field).all():
                if _key(opt.value) in keys:
                    db.delete(opt)
    db.commit()
    _bust()
    return {"ok": True, "records_updated": updated}
