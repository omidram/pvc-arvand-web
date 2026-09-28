from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..auth import require_any_form_access, require_form_access
from ..calculations import days_on_line
from ..database import get_db

router = APIRouter(prefix="/statistics", tags=["statistics"])


def _safe_count(db: Session, model) -> int:
    try:
        return db.query(model).count()
    except Exception:
        return 0


# Voltage-only roles (e.g. Inspector) still need the live voltage strip on Main Menu.
@router.get("/dashboard", dependencies=[Depends(require_any_form_access("dashboard", "voltage"))])
def dashboard(db: Session = Depends(get_db)):
    from .. import alerts_engine

    settings_row = db.query(models.PlantSettings).first()
    active_elements = db.query(models.Element).filter(models.Element.disassembly_date.is_(None)).count()
    try:
        voltage = alerts_engine.voltage_live_stats(db)
    except Exception:
        voltage = None
    return {
        "customer": settings_row.customer if settings_row else None,
        "uan": settings_row.uan if settings_row else None,
        "plant_type": settings_row.plant_type if settings_row else None,
        "counts": {
            "electrolyzers": _safe_count(db, models.Electrolyzer),
            "elements_total": _safe_count(db, models.Element),
            "elements_active": active_elements,
            "anodes": _safe_count(db, models.Anode),
            "cathodes": _safe_count(db, models.Cathode),
            "membranes": _safe_count(db, models.Membrane),
            "shutdowns": _safe_count(db, models.Shutdown),
            "inspections": _safe_count(db, models.InspectionReport),
            "analysis_samples": _safe_count(db, models.AnalysisSample),
            "voltage_readings": _safe_count(db, models.VoltageReading),
        },
        "voltage": voltage,
    }


@router.get("/dol-by-membrane-type", dependencies=[Depends(require_form_access("statistics"))])
def dol_by_membrane_type(db: Session = Depends(get_db)):
    elements = db.query(models.Element).filter(models.Element.membrane_type.isnot(None)).all()
    grouped: dict[str, dict] = {}
    for e in elements:
        key = e.membrane_type
        entry = grouped.setdefault(key, {"membrane_type": key, "active": 0, "passive": 0, "total_dol_days": 0})
        active = e.disassembly_date is None
        entry["active" if active else "passive"] += 1
        dol = days_on_line(e.commissioning_date, e.decommissioning_date)
        if dol:
            entry["total_dol_days"] += dol
    return list(grouped.values())


@router.get("/power-consumption", dependencies=[Depends(require_form_access("statistics"))])
def power_consumption(electrolyzer: str | None = None, db: Session = Depends(get_db)):
    """
    Rough estimate of specific power consumption (kWh per unit output) from
    average standardized voltage and current, per the manual's anodic-balance
    method. Full accuracy requires matched current-efficiency data for the
    same day (see /current-efficiency).
    """
    query = db.query(models.ElectrolyzerNormalization)
    if electrolyzer:
        query = query.filter(models.ElectrolyzerNormalization.electrolyzer == electrolyzer)
    batches = query.all()
    if not batches:
        return {"records": 0, "average_specific_power_kwh_per_kA_h": None}

    values = []
    for b in batches:
        if b.total_voltage and b.element_count:
            avg_cell_voltage = b.total_voltage / b.element_count
            values.append(avg_cell_voltage * 0.001 * 1000)  # kWh per kA*h per cell, i.e. just the voltage in V
    avg = sum(values) / len(values) if values else None
    return {"records": len(batches), "average_specific_power_kwh_per_kA_h": round(avg, 4) if avg else None}


@router.get("/groups", dependencies=[Depends(require_form_access("statistics"))])
def group_statistics(db: Session = Depends(get_db)):
    rows = (
        db.query(models.Element.group_nr, func.count(models.Element.id))
        .filter(models.Element.group_nr.isnot(None))
        .group_by(models.Element.group_nr)
        .all()
    )
    definitions = {d.group_nr: d for d in db.query(models.GroupDefinition).all()}
    result = []
    for group_nr, count in rows:
        d = definitions.get(group_nr)
        result.append(
            {
                "group_nr": group_nr,
                "element_count": count,
                "anode_coating": d.anode_coating if d else None,
                "cathode_coating": d.cathode_coating if d else None,
                "membrane_type": d.membrane_type if d else None,
                "gap_mm": d.gap_mm if d else None,
            }
        )
    return result
