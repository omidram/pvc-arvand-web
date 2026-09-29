"""
Live Cell Arrangement board (Access frmAnordnung / qryAnordnung).

Shows every position in an electrolyzer's arrangement blocks with the currently
mounted (non-disassembled) element components — matching Uhde Access behavior.
Selecting a cell loads every related record (assembly, anode, cathode, membrane,
inspections, voltage) so it can be edited in place.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import require_any_form_access
from ..database import get_db
from .elements import _enrich

router = APIRouter(
    prefix="/arrangement-board",
    tags=["arrangements"],
    dependencies=[Depends(require_any_form_access("settings", "elements"))],
)


def _pos_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


@router.get("")
def arrangement_board(
    electrolyzer: str | None = Query(default=None, description="Electrolyzer Bezeichnung / name"),
    db: Session = Depends(get_db),
):
    """
    Access equivalent of qryAnordnung + Update Display:
    for the selected electrolyzer, list positions (from arrangement start..end)
    and fill with active Montage/element data when present.
    """
    # Distinct electrolyzer names from arrangement definitions (and elements as fallback)
    names = sorted(
        {
            (r.name or "").strip()
            for r in db.query(models.ElectrolyzerArrangement).all()
            if (r.name or "").strip()
        }
        | {
            (r.electrolyzer or "").strip()
            for r in db.query(models.Element.electrolyzer).distinct().all()
            if (r.electrolyzer or "").strip()
        }
    )

    selected = (electrolyzer or "").strip() or (names[0] if names else "")
    blocks = (
        db.query(models.ElectrolyzerArrangement)
        .filter(models.ElectrolyzerArrangement.name == selected)
        .order_by(models.ElectrolyzerArrangement.id.asc())
        .all()
        if selected
        else []
    )

    # Position ranges
    ranges: list[tuple[int, int, models.ElectrolyzerArrangement]] = []
    for block in blocks:
        start = _pos_int(block.start_position)
        end = _pos_int(block.end_position)
        if start is None or end is None:
            continue
        if end < start:
            start, end = end, start
        ranges.append((start, end, block))

    # Active elements on this electrolyzer (Demontage Datum IS NULL)
    active = (
        db.query(models.Element)
        .filter(
            models.Element.electrolyzer == selected,
            models.Element.disassembly_date.is_(None),
        )
        .all()
        if selected
        else []
    )
    by_pos: dict[int, models.Element] = {}
    for el in active:
        p = _pos_int(el.position)
        if p is None:
            continue
        prev = by_pos.get(p)
        if prev is None or (el.assembly_date or date.min, el.id or 0) > (
            prev.assembly_date or date.min,
            prev.id or 0,
        ):
            by_pos[p] = el

    cells = []
    if ranges:
        for start, end, block in ranges:
            for pos in range(start, end + 1):
                el = by_pos.get(pos)
                cells.append(
                    {
                        "position": pos,
                        "block": block.block,
                        "occupied": el is not None,
                        "element_nr": el.element_nr if el else None,
                        "anode_nr": el.anode_nr if el else None,
                        "cathode_nr": el.cathode_nr if el else None,
                        "membrane_nr": el.membrane_nr if el else None,
                        "membrane_type": el.membrane_type if el else None,
                        "assembly_date": el.assembly_date.isoformat() if el and el.assembly_date else None,
                        "commissioning_date": el.commissioning_date.isoformat()
                        if el and el.commissioning_date
                        else None,
                        "decommissioning_date": el.decommissioning_date.isoformat()
                        if el and el.decommissioning_date
                        else None,
                        "element_id": el.id if el else None,
                    }
                )
    else:
        # No arrangement definition — still show known active positions
        for pos in sorted(by_pos):
            el = by_pos[pos]
            cells.append(
                {
                    "position": pos,
                    "block": None,
                    "occupied": True,
                    "element_nr": el.element_nr,
                    "anode_nr": el.anode_nr,
                    "cathode_nr": el.cathode_nr,
                    "membrane_nr": el.membrane_nr,
                    "membrane_type": el.membrane_type,
                    "assembly_date": el.assembly_date.isoformat() if el.assembly_date else None,
                    "commissioning_date": el.commissioning_date.isoformat() if el.commissioning_date else None,
                    "decommissioning_date": el.decommissioning_date.isoformat()
                    if el.decommissioning_date
                    else None,
                    "element_id": el.id,
                }
            )

    occupied = sum(1 for c in cells if c["occupied"])
    return {
        "electrolyzer": selected or None,
        "electrolyzers": names,
        "blocks": [
            {
                "id": b.id,
                "name": b.name,
                "block": b.block,
                "sub_plant": b.sub_plant,
                "transformer": b.transformer,
                "rectifier": b.rectifier,
                "start_position": b.start_position,
                "end_position": b.end_position,
            }
            for b in blocks
        ],
        "counts": {
            "positions": len(cells),
            "occupied": occupied,
            "empty": len(cells) - occupied,
        },
        "cells": cells,
    }


def _dump(schema, obj):
    if obj is None:
        return None
    return schema.model_validate(obj).model_dump(mode="json")


def _dump_many(schema, rows) -> list:
    return [_dump(schema, row) for row in rows]


def _compact(value) -> str:
    return str(value or "").replace(" ", "").strip().upper()


def _find_one(db: Session, model, attr: str, number: str | None):
    if not number or not str(number).strip():
        return None
    column = getattr(model, attr)
    exact = db.query(model).filter(column == str(number).strip()).first()
    if exact:
        return exact
    compact = _compact(number)
    expr = func.upper(func.replace(column, " ", ""))
    return db.query(model).filter(expr == compact).first()


def _find_many(db: Session, model, attr: str, number: str | None) -> list:
    if not number or not str(number).strip():
        return []
    column = getattr(model, attr)
    compact = _compact(number)
    expr = func.upper(func.replace(column, " ", ""))
    rows = db.query(model).filter(or_(column == str(number).strip(), expr == compact)).all()
    unique = {}
    for row in rows:
        unique[getattr(row, "id", None) or id(row)] = row
    return list(unique.values())


def _block_for(blocks, position: int):
    for block in blocks:
        start = _pos_int(block.start_position)
        end = _pos_int(block.end_position)
        if start is None or end is None:
            continue
        if end < start:
            start, end = end, start
        if start <= position <= end:
            return {
                "id": block.id,
                "block": block.block,
                "sub_plant": block.sub_plant,
                "transformer": block.transformer,
                "rectifier": block.rectifier,
                "start_position": block.start_position,
                "end_position": block.end_position,
            }
    return None


@router.get("/cell")
def arrangement_cell(
    electrolyzer: str = Query(...),
    position: int = Query(...),
    element_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Everything stored for one cell, joined the way Access links the forms."""
    selected = electrolyzer.strip()
    if not selected:
        raise HTTPException(status_code=400, detail="Electrolyzer is required")

    blocks = (
        db.query(models.ElectrolyzerArrangement)
        .filter(models.ElectrolyzerArrangement.name == selected)
        .order_by(models.ElectrolyzerArrangement.id.asc())
        .all()
    )
    rows = db.query(models.Element).filter(models.Element.electrolyzer == selected).all()
    history = [row for row in rows if _pos_int(row.position) == position]
    history.sort(key=lambda row: (row.assembly_date or date.min, row.id or 0), reverse=True)

    chosen = None
    if element_id is not None:
        chosen = next((row for row in history if row.id == element_id), None)
    if chosen is None:
        chosen = next((row for row in history if row.disassembly_date is None), None) or (history[0] if history else None)

    element = _enrich(chosen).model_dump(mode="json") if chosen else None
    anode_nr = chosen.anode_nr if chosen else None
    cathode_nr = chosen.cathode_nr if chosen else None
    membrane_nr = chosen.membrane_nr if chosen else None
    element_nr = chosen.element_nr if chosen else None
    group_nr = chosen.group_nr if chosen else None

    anode = _find_one(db, models.Anode, "anode_nr", anode_nr)
    cathode = _find_one(db, models.Cathode, "cathode_nr", cathode_nr)
    membrane = _find_one(db, models.Membrane, "membrane_nr", membrane_nr)
    group_ok = True
    if group_nr and str(group_nr).strip():
        group_ok = (
            db.query(models.GroupDefinition)
            .filter(models.GroupDefinition.group_nr == str(group_nr).strip())
            .first()
            is not None
        )

    pos_keys = [str(position), f"{position}.0"]
    voltage = (
        db.query(models.VoltageReading)
        .filter(models.VoltageReading.electrolyzer == selected, models.VoltageReading.position.in_(pos_keys))
        .order_by(models.VoltageReading.date.desc(), models.VoltageReading.id.desc())
        .limit(40)
        .all()
    )
    efficiency = (
        db.query(models.CurrentEfficiencyEntry)
        .filter(
            models.CurrentEfficiencyEntry.scope == "element",
            models.CurrentEfficiencyEntry.position.in_(pos_keys),
            or_(
                models.CurrentEfficiencyEntry.scope_ref == selected,
                models.CurrentEfficiencyEntry.scope_ref.is_(None),
            ),
        )
        .order_by(models.CurrentEfficiencyEntry.date.desc(), models.CurrentEfficiencyEntry.id.desc())
        .limit(40)
        .all()
    )

    return {
        "electrolyzer": selected,
        "position": position,
        "block": _block_for(blocks, position),
        "element": element,
        "history": [_enrich(row).model_dump(mode="json") for row in history],
        "anode": _dump(schemas.AnodeBase, anode),
        "cathode": _dump(schemas.CathodeBase, cathode),
        "membrane": _dump(schemas.MembraneBase, membrane),
        "anode_maintenance": _dump_many(schemas.AnodeMaintenanceRead, _find_many(db, models.AnodeMaintenance, "anode_nr", anode_nr)),
        "anode_recoating": _dump_many(schemas.AnodeRecoatingRead, _find_many(db, models.AnodeRecoating, "anode_nr", anode_nr)),
        "anode_coating": _dump_many(schemas.AnodeCoatingCheckRead, _find_many(db, models.AnodeCoatingCheck, "anode_nr", anode_nr)),
        "cathode_maintenance": _dump_many(schemas.CathodeMaintenanceRead, _find_many(db, models.CathodeMaintenance, "cathode_nr", cathode_nr)),
        "cathode_recoating": _dump_many(schemas.CathodeRecoatingRead, _find_many(db, models.CathodeRecoating, "cathode_nr", cathode_nr)),
        "cathode_coating": _dump_many(schemas.CathodeCoatingCheckRead, _find_many(db, models.CathodeCoatingCheck, "cathode_nr", cathode_nr)),
        "membrane_maintenance": _dump_many(
            schemas.MembraneMaintenanceRead, _find_many(db, models.MembraneMaintenance, "membrane_nr", membrane_nr)
        ),
        "anode_segregation": _dump_many(
            schemas.ElectrodeSegregationRead, _find_many(db, models.ElectrodeSegregation, "serial_nr", anode_nr)
        ),
        "cathode_segregation": _dump_many(
            schemas.ElectrodeSegregationRead, _find_many(db, models.ElectrodeSegregation, "serial_nr", cathode_nr)
        ),
        "inspections": _dump_many(schemas.InspectionReportRead, _find_many(db, models.InspectionReport, "element_nr", element_nr)),
        "halfshells": [
            {
                "id": grid.id,
                "element_nr": grid.element_nr,
                "grid_type": grid.grid_type,
                "grid_data": grid.grid_data or {},
            }
            for grid in _find_many(db, models.InspectionHalfshellGrid, "element_nr", element_nr)
        ],
        "voltage": _dump_many(schemas.VoltageReadingRead, voltage),
        "current_efficiency": _dump_many(schemas.CurrentEfficiencyEntryRead, efficiency),
        "links": {
            "anode_catalog": anode is not None,
            "cathode_catalog": cathode is not None,
            "membrane_catalog": membrane is not None,
            "group_catalog": group_ok,
        },
    }
