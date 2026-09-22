from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter(prefix="/search", tags=["search"])


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
        )
        .limit(100)
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

    def dump(items, fields):
        return [{f: getattr(i, f, None) for f in fields} for i in items]

    return {
        "elements": dump(elements, ["id", "element_nr", "electrolyzer", "position", "anode_nr", "cathode_nr", "membrane_nr"]),
        "anodes": dump(anodes, ["anode_nr", "manufacturer", "coating", "batch"]),
        "cathodes": dump(cathodes, ["cathode_nr", "manufacturer", "coating", "batch"]),
        "membranes": dump(membranes, ["membrane_nr", "membrane_type", "batch"]),
        "shutdowns": dump(shutdowns, ["nr", "plant_part", "cause", "category", "shutdown_time"]),
        "inspections": dump(inspections, ["id", "element_nr", "inspection_reason", "inspection_date"]),
    }


@router.get("/by-date")
def search_by_date(field: str, date: str, db: Session = Depends(get_db)):
    """
    Selects all elements matching a specific date, per the manual's search
    functions (Assembly / Commissioning / Decommissioning / Disassembly date).
    """
    from datetime import date as date_cls

    column_map = {
        "assembly": models.Element.assembly_date,
        "commissioning": models.Element.commissioning_date,
        "decommissioning": models.Element.decommissioning_date,
        "disassembly": models.Element.disassembly_date,
    }
    if field not in column_map:
        return {"error": f"field must be one of {list(column_map)}"}
    target = date_cls.fromisoformat(date)
    items = db.query(models.Element).filter(column_map[field] == target).all()
    return [
        {"id": i.id, "element_nr": i.element_nr, "electrolyzer": i.electrolyzer, "position": i.position}
        for i in items
    ]
