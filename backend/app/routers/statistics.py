from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..auth import require_any_form_access, require_form_access
from ..calculations import installation_dol
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
        dol = installation_dol(e.assembly_date, e.commissioning_date, e.disassembly_date, e.decommissioning_date)
        if dol:
            entry["total_dol_days"] += dol
    return list(grouped.values())


@router.get("/power-consumption", dependencies=[Depends(require_form_access("statistics"))])
def power_consumption(
    electrolyzer: str | None = None,
    group: str = "electrolyzer",
    date_from: str | None = None,
    date_till: str | None = None,
    db: Session = Depends(get_db),
):
    """kWh from LogSheets load (kA) and total voltage: kWh = V × I_kA × hours."""
    from datetime import datetime

    from ..energy import report

    start = datetime.fromisoformat(date_from) if date_from else None
    end = datetime.fromisoformat(date_till) if date_till else None
    data = report(db, start=start, end=end, group=group)
    if electrolyzer:
        el = electrolyzer.strip().upper()
        data["rows"] = [
            row
            for row in data["rows"]
            if str(row.get("electrolyzer") or "").upper() == el or str(row.get("key") or "").upper().startswith(el)
        ]
        data["total_kwh"] = round(sum(row["energy_kwh"] for row in data["rows"]), 1)
    return data


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
