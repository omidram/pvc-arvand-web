"""
Lagerbestand (stock inventory) — mirrors Access forms:
  frmLagerbestandAnoden / qryLagerbestandAnoden(+2)
  frmLagerbestandKathoden / qryLagerbestandKathoden(+2)
  frmLagerbestandMembranen / qryLagerbestandMembranen(+2)

Stock = component still usable (no decommission date) and NOT mounted on an
active assembly (element with null disassembly_date).
"""
from collections import Counter

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..auth import require_any_form_access
from ..database import get_db

router = APIRouter(prefix="/storage", tags=["storage"])


def _norm(value: str | None) -> str:
    return " ".join((value or "").split()).strip().upper()


def _active_component_nrs(db: Session, field: str) -> set[str]:
    """Component numbers currently mounted on non-disassembled elements."""
    col = getattr(models.Element, field)
    rows = (
        db.query(col)
        .filter(col.isnot(None), models.Element.disassembly_date.is_(None))
        .all()
    )
    return {_norm(r[0]) for r in rows if r[0] and _norm(r[0])}


def _anode_payload(row: models.Anode) -> dict:
    return {
        "anode_nr": row.anode_nr,
        "assembly_group": row.assembly_group,
        "component_nr": row.component_nr,
        "customer_drawing_nr": row.customer_drawing_nr,
        "manufacturer": row.manufacturer,
        "manufacturer_order_nr": row.manufacturer_order_nr,
        "manufacturer_drawing_nr": row.manufacturer_drawing_nr,
        "manufacturer_date": row.manufacturer_date,
        "tank": row.tank,
        "contact_strip": row.contact_strip,
        "electrode_support": row.electrode_support,
        "electrode_shape": row.electrode_shape,
        "coating": row.coating,
        "baffle_plate": row.baffle_plate,
        "downcomer": row.downcomer,
        "inlet_system": row.inlet_system,
        "standpipe_diameter": row.standpipe_diameter,
        "flange_width": row.flange_width,
        "received_date": row.received_date,
        "remarks": row.remarks,
        "decommission_date": row.decommission_date,
        "batch": row.batch,
        "generation": row.generation,
    }


def _cathode_payload(row: models.Cathode) -> dict:
    return {
        "cathode_nr": row.cathode_nr,
        "assembly_group": row.assembly_group,
        "component_nr": row.component_nr,
        "customer_drawing_nr": row.customer_drawing_nr,
        "manufacturer": row.manufacturer,
        "manufacturer_order_nr": row.manufacturer_order_nr,
        "manufacturer_drawing_nr": row.manufacturer_drawing_nr,
        "manufacturer_date": row.manufacturer_date,
        "tank": row.tank,
        "contact_strip": row.contact_strip,
        "electrode_support": row.electrode_support,
        "electrode_shape": row.electrode_shape,
        "coating": row.coating,
        "inlet_system": row.inlet_system,
        "standpipe_diameter": row.standpipe_diameter,
        "flange_width": row.flange_width,
        "received_date": row.received_date,
        "remarks": row.remarks,
        "decommission_date": row.decommission_date,
        "batch": row.batch,
        "generation": row.generation,
    }


def _membrane_payload(row: models.Membrane) -> dict:
    return {
        "membrane_nr": row.membrane_nr,
        "membrane_type": row.membrane_type,
        "received_date": row.received_date,
        "remarks": row.remarks,
        "decommission_date": row.decommission_date,
        "batch": row.batch,
    }


@router.get("/summary")
def storage_summary(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "anodes", "cathodes", "membranes")),
):
    active_anodes = _active_component_nrs(db, "anode_nr")
    active_cathodes = _active_component_nrs(db, "cathode_nr")
    active_membranes = _active_component_nrs(db, "membrane_nr")

    anodes = [
        a
        for a in db.query(models.Anode).filter(models.Anode.decommission_date.is_(None)).all()
        if _norm(a.anode_nr) not in active_anodes
    ]
    cathodes = [
        c
        for c in db.query(models.Cathode).filter(models.Cathode.decommission_date.is_(None)).all()
        if _norm(c.cathode_nr) not in active_cathodes
    ]
    membranes = [
        m
        for m in db.query(models.Membrane).filter(models.Membrane.decommission_date.is_(None)).all()
        if _norm(m.membrane_nr) not in active_membranes
    ]

    anode_groups = Counter((a.manufacturer or "—", a.generation or "—") for a in anodes)
    cathode_groups = Counter((c.manufacturer or "—", c.generation or "—") for c in cathodes)
    membrane_groups = Counter((m.membrane_type or "—") for m in membranes)

    return {
        "counts": {
            "anodes": len(anodes),
            "cathodes": len(cathodes),
            "membranes": len(membranes),
            "total": len(anodes) + len(cathodes) + len(membranes),
        },
        "anodes_by_manufacturer": [
            {"manufacturer": k[0], "generation": k[1], "count": v}
            for k, v in sorted(anode_groups.items(), key=lambda x: (-x[1], x[0]))
        ],
        "cathodes_by_manufacturer": [
            {"manufacturer": k[0], "generation": k[1], "count": v}
            for k, v in sorted(cathode_groups.items(), key=lambda x: (-x[1], x[0]))
        ],
        "membranes_by_type": [
            {"membrane_type": k, "count": v}
            for k, v in sorted(membrane_groups.items(), key=lambda x: (-x[1], x[0]))
        ],
    }


@router.get("/anodes")
def stock_anodes(
    q: str | None = None,
    limit: int = Query(default=2000, ge=1, le=10000),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "anodes")),
):
    active = _active_component_nrs(db, "anode_nr")
    rows = db.query(models.Anode).filter(models.Anode.decommission_date.is_(None)).all()
    items = [_anode_payload(r) for r in rows if _norm(r.anode_nr) not in active]
    if q:
        needle = q.strip().lower()
        items = [
            i
            for i in items
            if needle in (i.get("anode_nr") or "").lower()
            or needle in (i.get("manufacturer") or "").lower()
            or needle in (i.get("batch") or "").lower()
            or needle in (i.get("generation") or "").lower()
        ]
    items.sort(key=lambda i: (i.get("anode_nr") or ""))
    return items[:limit]


@router.get("/cathodes")
def stock_cathodes(
    q: str | None = None,
    limit: int = Query(default=2000, ge=1, le=10000),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "cathodes")),
):
    active = _active_component_nrs(db, "cathode_nr")
    rows = db.query(models.Cathode).filter(models.Cathode.decommission_date.is_(None)).all()
    items = [_cathode_payload(r) for r in rows if _norm(r.cathode_nr) not in active]
    if q:
        needle = q.strip().lower()
        items = [
            i
            for i in items
            if needle in (i.get("cathode_nr") or "").lower()
            or needle in (i.get("manufacturer") or "").lower()
            or needle in (i.get("batch") or "").lower()
            or needle in (i.get("generation") or "").lower()
        ]
    items.sort(key=lambda i: (i.get("cathode_nr") or ""))
    return items[:limit]


@router.get("/membranes")
def stock_membranes(
    q: str | None = None,
    limit: int = Query(default=2000, ge=1, le=10000),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "membranes")),
):
    active = _active_component_nrs(db, "membrane_nr")
    rows = db.query(models.Membrane).filter(models.Membrane.decommission_date.is_(None)).all()
    items = [_membrane_payload(r) for r in rows if _norm(r.membrane_nr) not in active]
    if q:
        needle = q.strip().lower()
        items = [
            i
            for i in items
            if needle in (i.get("membrane_nr") or "").lower()
            or needle in (i.get("membrane_type") or "").lower()
            or needle in (i.get("batch") or "").lower()
        ]
    items.sort(key=lambda i: (i.get("membrane_nr") or ""))
    return items[:limit]
