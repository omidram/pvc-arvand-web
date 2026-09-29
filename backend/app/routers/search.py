"""Search Functions — Access Suchübersicht typed searches."""
from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter(prefix="/search", tags=["search"])

ELEMENT_FIELDS = [
    "id",
    "element_nr",
    "electrolyzer",
    "position",
    "group_nr",
    "anode_nr",
    "cathode_nr",
    "membrane_nr",
    "membrane_type",
    "assembly_date",
    "commissioning_date",
    "decommissioning_date",
    "disassembly_date",
    "dol_days",
    "remarks",
]


def _dump(items, fields):
    out = []
    for i in items:
        row = {}
        for f in fields:
            val = getattr(i, f, None)
            if hasattr(val, "isoformat"):
                val = val.isoformat()
            row[f] = val
        out.append(row)
    return out


def _active_q(db: Session):
    return db.query(models.Element).filter(
        models.Element.commissioning_date.isnot(None),
        models.Element.decommissioning_date.is_(None),
        models.Element.disassembly_date.is_(None),
    )


def _passive_q(db: Session):
    return db.query(models.Element).filter(
        or_(
            models.Element.decommissioning_date.isnot(None),
            models.Element.disassembly_date.isnot(None),
            models.Element.commissioning_date.is_(None),
        )
    )


@router.get("")
def search_all(q: str = Query(min_length=1), db: Session = Depends(get_db)):
    like = f"%{q}%"

    elements = (
        db.query(models.Element)
        .filter(
            (models.Element.element_nr.ilike(like))
            | (models.Element.anode_nr.ilike(like))
            | (models.Element.cathode_nr.ilike(like))
            | (models.Element.membrane_nr.ilike(like))
            | (models.Element.remarks.ilike(like))
            | (models.Element.electrolyzer.ilike(like))
        )
        .limit(200)
        .all()
    )
    anodes = db.query(models.Anode).filter(models.Anode.anode_nr.ilike(like)).limit(100).all()
    cathodes = db.query(models.Cathode).filter(models.Cathode.cathode_nr.ilike(like)).limit(100).all()
    membranes = db.query(models.Membrane).filter(models.Membrane.membrane_nr.ilike(like)).limit(100).all()
    shutdowns = (
        db.query(models.Shutdown)
        .filter((models.Shutdown.plant_part.ilike(like)) | (models.Shutdown.cause.ilike(like)))
        .limit(100)
        .all()
    )
    inspections = (
        db.query(models.InspectionReport).filter(models.InspectionReport.element_nr.ilike(like)).limit(100).all()
    )

    return {
        "kind": "all",
        "elements": _dump(elements, ELEMENT_FIELDS),
        "anodes": _dump(anodes, ["anode_nr", "manufacturer", "coating", "batch"]),
        "cathodes": _dump(cathodes, ["cathode_nr", "manufacturer", "coating", "batch"]),
        "membranes": _dump(membranes, ["membrane_nr", "membrane_type", "batch"]),
        "shutdowns": _dump(shutdowns, ["nr", "plant_part", "cause", "category", "shutdown_time"]),
        "inspections": _dump(inspections, ["id", "element_nr", "inspection_reason", "inspection_date"]),
    }


@router.get("/by-date")
def search_by_date(field: str, date: str, db: Session = Depends(get_db)):
    column_map = {
        "assembly": models.Element.assembly_date,
        "commissioning": models.Element.commissioning_date,
        "decommissioning": models.Element.decommissioning_date,
        "disassembly": models.Element.disassembly_date,
    }
    if field not in column_map:
        raise HTTPException(status_code=400, detail=f"field must be one of {list(column_map)}")
    target = date_cls.fromisoformat(date)
    items = db.query(models.Element).filter(column_map[field] == target).order_by(models.Element.element_nr).all()
    return _dump(items, ELEMENT_FIELDS)


@router.get("/kind/{kind}")
def search_by_kind(
    kind: str,
    q: str | None = Query(default=None),
    limit: int = Query(default=500, le=5000),
    db: Session = Depends(get_db),
):
    """
    Typed searches from Access Suchübersicht.
    kind values mirror the web search menu buttons.
    """
    like = f"%{q.strip()}%" if q and q.strip() and q.strip() != "*" else None
    kind = kind.strip().lower()

    def elements_result(items, title: str):
        return {
            "kind": kind,
            "title": title,
            "elements": _dump(items[:limit], ELEMENT_FIELDS),
            "anodes": [],
            "cathodes": [],
            "membranes": [],
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind in {"element", "search-element"}:
        query = db.query(models.Element)
        if like:
            query = query.filter(
                or_(
                    models.Element.element_nr.ilike(like),
                    models.Element.remarks.ilike(like),
                )
            )
        return elements_result(query.order_by(models.Element.element_nr).all(), "Elements")

    if kind == "anode":
        query = db.query(models.Anode)
        if like:
            query = query.filter(
                or_(models.Anode.anode_nr.ilike(like), models.Anode.remarks.ilike(like), models.Anode.batch.ilike(like))
            )
        rows = query.limit(limit).all()
        return {
            "kind": kind,
            "title": "Anodes",
            "elements": [],
            "anodes": _dump(rows, ["anode_nr", "manufacturer", "coating", "batch", "generation", "received_date"]),
            "cathodes": [],
            "membranes": [],
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind == "cathode":
        query = db.query(models.Cathode)
        if like:
            query = query.filter(
                or_(
                    models.Cathode.cathode_nr.ilike(like),
                    models.Cathode.remarks.ilike(like),
                    models.Cathode.batch.ilike(like),
                )
            )
        rows = query.limit(limit).all()
        return {
            "kind": kind,
            "title": "Cathodes",
            "elements": [],
            "anodes": [],
            "cathodes": _dump(rows, ["cathode_nr", "manufacturer", "coating", "batch", "generation", "received_date"]),
            "membranes": [],
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind == "membrane":
        query = db.query(models.Membrane)
        if like:
            query = query.filter(
                or_(
                    models.Membrane.membrane_nr.ilike(like),
                    models.Membrane.membrane_type.ilike(like),
                    models.Membrane.batch.ilike(like),
                )
            )
        rows = query.limit(limit).all()
        return {
            "kind": kind,
            "title": "Membranes",
            "elements": [],
            "anodes": [],
            "cathodes": [],
            "membranes": _dump(rows, ["membrane_nr", "membrane_type", "batch", "received_date", "remarks"]),
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind == "active":
        return elements_result(_active_q(db).order_by(models.Element.electrolyzer, models.Element.position).all(), "Active elements")

    if kind == "passive":
        return elements_result(_passive_q(db).order_by(models.Element.element_nr).all(), "Passive / inactive elements")

    if kind == "assembly":
        query = db.query(models.Element).filter(models.Element.assembly_date.isnot(None))
        if like:
            query = query.filter(models.Element.element_nr.ilike(like))
        return elements_result(query.order_by(models.Element.assembly_date.desc()).all(), "Assembled elements")

    if kind == "commissioning":
        query = db.query(models.Element).filter(models.Element.commissioning_date.isnot(None))
        if like:
            query = query.filter(models.Element.element_nr.ilike(like))
        return elements_result(query.order_by(models.Element.commissioning_date.desc()).all(), "Commissioned elements")

    if kind == "decommissioning":
        query = db.query(models.Element).filter(models.Element.decommissioning_date.isnot(None))
        if like:
            query = query.filter(models.Element.element_nr.ilike(like))
        return elements_result(
            query.order_by(models.Element.decommissioning_date.desc()).all(), "Decommissioned elements"
        )

    if kind == "disassembly":
        query = db.query(models.Element).filter(models.Element.disassembly_date.isnot(None))
        if like:
            query = query.filter(models.Element.element_nr.ilike(like))
        return elements_result(query.order_by(models.Element.disassembly_date.desc()).all(), "Disassembled elements")

    if kind == "group":
        query = db.query(models.Element).filter(models.Element.group_nr.isnot(None))
        if like:
            query = query.filter(models.Element.group_nr.ilike(like))
        return elements_result(query.order_by(models.Element.group_nr, models.Element.element_nr).all(), "Elements by group")

    if kind == "dol":
        # Without DOL / missing computed commissioning
        query = db.query(models.Element).filter(
            models.Element.commissioning_date.is_(None),
            models.Element.disassembly_date.is_(None),
        )
        return elements_result(query.all(), "Elements without DOL (no commissioning date)")

    if kind == "inspection":
        query = db.query(models.InspectionReport)
        if like:
            query = query.filter(
                or_(
                    models.InspectionReport.element_nr.ilike(like),
                    models.InspectionReport.inspection_reason.ilike(like),
                )
            )
        rows = query.order_by(models.InspectionReport.inspection_date.desc()).limit(limit).all()
        return {
            "kind": kind,
            "title": "Inspections",
            "elements": [],
            "anodes": [],
            "cathodes": [],
            "membranes": [],
            "shutdowns": [],
            "inspections": _dump(rows, ["id", "element_nr", "inspection_reason", "inspection_date", "inspector_name"]),
            "extra": {},
        }

    if kind in {
        "dup-anode",
        "dup-cathode",
        "dup-membrane",
        "dup-anode-active",
        "dup-cathode-active",
        "dup-membrane-active",
        "dup-anode-passive",
        "dup-cathode-passive",
        "dup-membrane-passive",
    }:
        col_map = {
            "dup-anode": models.Element.anode_nr,
            "dup-cathode": models.Element.cathode_nr,
            "dup-membrane": models.Element.membrane_nr,
            "dup-anode-active": models.Element.anode_nr,
            "dup-cathode-active": models.Element.cathode_nr,
            "dup-membrane-active": models.Element.membrane_nr,
            "dup-anode-passive": models.Element.anode_nr,
            "dup-cathode-passive": models.Element.cathode_nr,
            "dup-membrane-passive": models.Element.membrane_nr,
        }
        col = col_map[kind]
        if kind.endswith("-passive"):
            pool = _passive_q(db).filter(col.isnot(None)).all()
            scope = "passive"
        else:
            pool = db.query(models.Element).filter(col.isnot(None), models.Element.disassembly_date.is_(None)).all()
            scope = "active"
        seen: dict[str, list] = {}
        for el in pool:
            value = getattr(el, col.key)
            if not value:
                continue
            seen.setdefault(str(value), []).append(el)
        dup_elements = []
        for value, group in seen.items():
            if len(group) > 1:
                dup_elements.extend(group)
        return elements_result(dup_elements, f"Duplicate {kind.split('-')[1]}s ({scope})")

    if kind == "remarks":
        query = db.query(models.Element).filter(models.Element.remarks.isnot(None), models.Element.remarks != "")
        if like:
            query = query.filter(models.Element.remarks.ilike(like))
        return elements_result(query.order_by(models.Element.element_nr).limit(limit).all(), "Assembly remarks")

    if kind == "membrane-type":
        query = db.query(models.Element).filter(models.Element.membrane_type.isnot(None))
        if like:
            query = query.filter(models.Element.membrane_type.ilike(like))
        return elements_result(query.order_by(models.Element.membrane_type).all(), "Elements by membrane type")

    if kind == "active-membrane-type":
        query = _active_q(db).filter(models.Element.membrane_type.isnot(None))
        if like:
            query = query.filter(models.Element.membrane_type.ilike(like))
        return elements_result(
            query.order_by(models.Element.membrane_type, models.Element.position).all(),
            "Active elements per membrane type",
        )

    if kind == "recoating-anode":
        rows = db.query(models.AnodeRecoating).order_by(models.AnodeRecoating.id.desc()).limit(limit).all()
        return {
            "kind": kind,
            "title": "Anode recoating",
            "elements": [],
            "anodes": _dump(
                rows,
                ["id", "anode_nr", "coating_nr", "manufacturer", "dispatch_date", "return_date", "recoating_number"],
            ),
            "cathodes": [],
            "membranes": [],
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind == "recoating-cathode":
        rows = db.query(models.CathodeRecoating).order_by(models.CathodeRecoating.id.desc()).limit(limit).all()
        return {
            "kind": kind,
            "title": "Cathode recoating",
            "elements": [],
            "anodes": [],
            "cathodes": _dump(rows, ["id", "cathode_nr", "manufacturer", "dispatch_date", "return_date"]),
            "membranes": [],
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind == "active-groups":
        rows = (
            db.query(models.Element.group_nr, func.count(models.Element.id))
            .filter(
                models.Element.group_nr.isnot(None),
                models.Element.commissioning_date.isnot(None),
                models.Element.decommissioning_date.is_(None),
                models.Element.disassembly_date.is_(None),
            )
            .group_by(models.Element.group_nr)
            .order_by(models.Element.group_nr)
            .all()
        )
        elements = [
            {
                "id": idx + 1,
                "element_nr": group_nr,
                "electrolyzer": None,
                "position": None,
                "group_nr": group_nr,
                "anode_nr": None,
                "cathode_nr": None,
                "membrane_nr": None,
                "membrane_type": None,
                "assembly_date": None,
                "commissioning_date": None,
                "decommissioning_date": None,
                "disassembly_date": None,
                "dol_days": count,
                "remarks": f"{count} active element(s)",
            }
            for idx, (group_nr, count) in enumerate(rows)
        ]
        return {
            "kind": kind,
            "title": "Active groups",
            "elements": elements,
            "anodes": [],
            "cathodes": [],
            "membranes": [],
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind == "stock-anode":
        active_nrs = {
            (r[0] or "").strip().upper()
            for r in db.query(models.Element.anode_nr)
            .filter(models.Element.anode_nr.isnot(None), models.Element.disassembly_date.is_(None))
            .all()
            if r[0]
        }
        rows = [
            a
            for a in db.query(models.Anode).filter(models.Anode.decommission_date.is_(None)).all()
            if (a.anode_nr or "").strip().upper() not in active_nrs
        ]
        return {
            "kind": kind,
            "title": "Anode stock",
            "elements": [],
            "anodes": _dump(rows[:limit], ["anode_nr", "manufacturer", "coating", "batch", "generation"]),
            "cathodes": [],
            "membranes": [],
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind == "stock-cathode":
        active_nrs = {
            (r[0] or "").strip().upper()
            for r in db.query(models.Element.cathode_nr)
            .filter(models.Element.cathode_nr.isnot(None), models.Element.disassembly_date.is_(None))
            .all()
            if r[0]
        }
        rows = [
            c
            for c in db.query(models.Cathode).filter(models.Cathode.decommission_date.is_(None)).all()
            if (c.cathode_nr or "").strip().upper() not in active_nrs
        ]
        return {
            "kind": kind,
            "title": "Cathode stock",
            "elements": [],
            "anodes": [],
            "cathodes": _dump(rows[:limit], ["cathode_nr", "manufacturer", "coating", "batch", "generation"]),
            "membranes": [],
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind == "stock-membrane":
        active_nrs = {
            (r[0] or "").strip().upper()
            for r in db.query(models.Element.membrane_nr)
            .filter(models.Element.membrane_nr.isnot(None), models.Element.disassembly_date.is_(None))
            .all()
            if r[0]
        }
        rows = [
            m
            for m in db.query(models.Membrane).filter(models.Membrane.decommission_date.is_(None)).all()
            if (m.membrane_nr or "").strip().upper() not in active_nrs
        ]
        return {
            "kind": kind,
            "title": "Membrane stock",
            "elements": [],
            "anodes": [],
            "cathodes": [],
            "membranes": _dump(rows[:limit], ["membrane_nr", "membrane_type", "batch"]),
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    if kind == "electrolyzer":
        query = db.query(models.Element)
        if like:
            query = query.filter(models.Element.electrolyzer.ilike(like))
        else:
            raise HTTPException(status_code=400, detail="Provide electrolyzer name in q")
        return elements_result(
            query.filter(models.Element.disassembly_date.is_(None)).order_by(models.Element.position).all(),
            f"Elements in electrolyzer {q}",
        )

    if kind == "dol-list":
        query = db.query(models.Element).filter(models.Element.dol_days.isnot(None))
        if like:
            query = query.filter(models.Element.element_nr.ilike(like))
        return elements_result(query.order_by(models.Element.dol_days.desc()).limit(limit).all(), "DOL")

    if kind == "inspection-code":
        if not like:
            raise HTTPException(status_code=400, detail="Provide inspection code in q")
        reasons = (
            db.query(models.InspectionReason)
            .filter(or_(models.InspectionReason.code.ilike(like), models.InspectionReason.reason.ilike(like)))
            .all()
        )
        reason_texts = [r.reason for r in reasons if r.reason]
        query = db.query(models.InspectionReport)
        if reason_texts:
            query = query.filter(
                or_(
                    models.InspectionReport.inspection_reason.ilike(like),
                    models.InspectionReport.inspection_reason.in_(reason_texts),
                )
            )
        else:
            query = query.filter(models.InspectionReport.inspection_reason.ilike(like))
        rows = query.order_by(models.InspectionReport.inspection_date.desc()).limit(limit).all()
        return {
            "kind": kind,
            "title": "Inspections by code",
            "elements": [],
            "anodes": [],
            "cathodes": [],
            "membranes": [],
            "shutdowns": [],
            "inspections": _dump(rows, ["id", "element_nr", "inspection_reason", "inspection_date", "inspector_name"]),
            "extra": {"codes": _dump(reasons, ["id", "code", "reason"])},
        }

    if kind == "remembraning":
        rows = db.query(models.MembraneMaintenance).order_by(models.MembraneMaintenance.id.desc()).limit(limit).all()
        return {
            "kind": kind,
            "title": "Remembraning",
            "elements": [],
            "anodes": [],
            "cathodes": [],
            "membranes": _dump(rows, ["id", "membrane_nr", "date", "repair_work"]),
            "shutdowns": [],
            "inspections": [],
            "extra": {},
        }

    raise HTTPException(
        status_code=400,
        detail=(
            "Unknown kind. Use: element, anode, cathode, membrane, active, passive, "
            "assembly, commissioning, decommissioning, disassembly, group, dol, dol-list, inspection, "
            "inspection-code, remembraning, "
            "dup-anode, dup-cathode, dup-membrane, dup-anode-active, dup-anode-passive, "
            "dup-cathode-active, dup-cathode-passive, dup-membrane-active, dup-membrane-passive, "
            "stock-anode, stock-cathode, stock-membrane, electrolyzer, remarks, membrane-type, "
            "active-membrane-type, recoating-anode, recoating-cathode, active-groups"
        ),
    )
