import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..calculations import standardized_voltage
from ..crud import build_crud_router
from ..database import get_db
from ..import_jobs import spawn_import

normalizations_router = build_crud_router(
    model=models.ElectrolyzerNormalization,
    read_schema=schemas.ElectrolyzerNormalizationRead,
    write_schema=schemas.ElectrolyzerNormalizationBase,
    prefix="/voltage-normalizations",
    tags=["voltage"],
    search_fields=["electrolyzer"],
    default_order="date",
)

readings_router = build_crud_router(
    model=models.VoltageReading,
    read_schema=schemas.VoltageReadingRead,
    write_schema=schemas.VoltageReadingBase,
    prefix="/voltage-readings",
    tags=["voltage"],
    search_fields=["electrolyzer", "position", "element_nr"],
    default_order="date",
)

calc_router = APIRouter(prefix="/voltage", tags=["voltage"])


@calc_router.post("/calculate-standardized")
def calculate_standardized(
    u_meas: float,
    current_density: float,
    temp_meas: float,
    conc_meas: float,
    db: Session = Depends(get_db),
    reference_current_density: float | None = None,
    zero_voltage: float | None = None,
    temp_ref: float = 90.0,
    conc_ref: float | None = None,
):
    settings_row = db.query(models.PlantSettings).first()
    plant_type = settings_row.plant_type if settings_row else "NaOH"
    ref_cd = reference_current_density or (settings_row.reference_current_density if settings_row else (6.0 if plant_type == "NaOH" else 5.0))
    u0 = zero_voltage or (settings_row.zero_voltage if settings_row else (2.40 if plant_type == "NaOH" else 2.42))
    c_ref = conc_ref if conc_ref is not None else (32.0 if plant_type == "NaOH" else 28.5)

    factor = (
        db.query(models.CorrectionFactor)
        .filter(models.CorrectionFactor.reference_current_density == ref_cd)
        .first()
    )
    t_corr = factor.temp_correction if factor else (0.020 if plant_type == "NaOH" else 0.016)
    c_corr = factor.conc_correction if factor else (0.040 if plant_type == "NaOH" else 0.033)

    result = standardized_voltage(
        u_meas=u_meas,
        current_density=current_density,
        reference_current_density=ref_cd,
        zero_voltage=u0,
        temp_meas=temp_meas,
        temp_ref=temp_ref,
        conc_meas=conc_meas,
        conc_ref=c_ref,
        temp_correction=t_corr,
        conc_correction=c_corr,
    )
    return {"standardized_voltage": result.standardized_voltage, "inputs": result.inputs}


@calc_router.get("/distribution")
def voltage_distribution(
    electrolyzer: str | None = None,
    db: Session = Depends(get_db),
):
    classes = db.query(models.VoltageDistributionClass).order_by(models.VoltageDistributionClass.lower_bound).all()
    query = db.query(models.VoltageReading).filter(models.VoltageReading.standardized_voltage.isnot(None))
    if electrolyzer:
        query = query.filter(models.VoltageReading.electrolyzer == electrolyzer)
    readings = query.all()

    buckets = []
    for c in classes:
        count = sum(
            1
            for r in readings
            if (c.lower_bound is None or r.standardized_voltage >= c.lower_bound)
            and (c.upper_bound is None or r.standardized_voltage < c.upper_bound)
        )
        buckets.append({"label": c.label, "lower_bound": c.lower_bound, "upper_bound": c.upper_bound, "count": count})
    return {"total_readings": len(readings), "buckets": buckets}


@calc_router.get("/high-deviation")
def high_deviation_elements(
    threshold: float = Query(default=0.05, description="Fractional deviation from average, e.g. 0.05 = 5%"),
    electrolyzer: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.VoltageReading).filter(models.VoltageReading.standardized_voltage.isnot(None))
    if electrolyzer:
        query = query.filter(models.VoltageReading.electrolyzer == electrolyzer)
    readings = query.all()
    if not readings:
        return {"average": None, "flagged": []}
    avg = sum(r.standardized_voltage for r in readings) / len(readings)
    flagged = [
        {
            "electrolyzer": r.electrolyzer,
            "position": r.position,
            "element_nr": r.element_nr,
            "standardized_voltage": r.standardized_voltage,
            "deviation_pct": round((r.standardized_voltage - avg) / avg * 100, 2) if avg else None,
        }
        for r in readings
        if avg and abs(r.standardized_voltage - avg) / avg > threshold
    ]
    return {"average": round(avg, 4), "flagged": sorted(flagged, key=lambda x: abs(x["deviation_pct"] or 0), reverse=True)}


@calc_router.post("/import")
async def import_voltage_csv(
    file: UploadFile,
    electrolyzer: str,
    reading_date: str,
):
    """
    Bulk import of per-position voltage readings from a CSV file with columns
    'position,voltage' (mirrors the manual's Excel import workflow, section 3.5).
    """
    content = await file.read()
    text = content.decode("utf-8-sig", errors="ignore")
    rows = list(csv.DictReader(io.StringIO(text)))

    def work(db: Session, progress):
        date_val = datetime.fromisoformat(reading_date)
        created = 0
        total = len(rows)
        if progress:
            progress(0, total)
        for done, row in enumerate(rows, start=1):
            position = row.get("position") or row.get("Position")
            voltage = row.get("voltage") or row.get("Voltage") or row.get("Ui")
            if position is not None and voltage not in (None, ""):
                try:
                    voltage_f = float(voltage)
                except ValueError:
                    voltage_f = None
                if voltage_f is not None:
                    db.add(
                        models.VoltageReading(
                            electrolyzer=electrolyzer,
                            position=position,
                            date=date_val,
                            voltage=voltage_f,
                        )
                    )
                    created += 1
            if progress and (done == total or done % 25 == 0):
                progress(done, total)
        db.commit()
        return {"imported_rows": created}

    return spawn_import(work)


@calc_router.post("/import-excel")
async def import_voltage_excel(
    file: UploadFile,
    electrolyzer: str | None = None,
    reading_date: str | None = None,
):
    """Import SiteMan / F2 / ARIAORMS LogSheets Excel (upsert by electrolyzer+date+time+position)."""
    from .. import voltage_sync

    content = await file.read()
    filename = file.filename or ""

    def work(db: Session, progress):
        try:
            info = voltage_sync.apply_excel_bytes(
                db,
                content,
                electrolyzer=electrolyzer,
                reading_date=reading_date,
                hint_from_name=filename,
                progress=progress,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        db.commit()
        return {
            "imported_rows": info.get("rows_upserted"),
            "electrolyzer": info.get("electrolyzer"),
            "reading_date": info.get("reading_date"),
            "times": info.get("times") or [],
            "operators": info.get("operators") or [],
            "sheet": info.get("sheet"),
            "out_of_range_count": info.get("out_of_range_count") or 0,
            "mode": "upsert",
        }

    return spawn_import(work)


current_efficiency_router = build_crud_router(
    model=models.CurrentEfficiencyEntry,
    read_schema=schemas.CurrentEfficiencyEntryRead,
    write_schema=schemas.CurrentEfficiencyEntryBase,
    prefix="/current-efficiency-entries",
    tags=["current-efficiency"],
    default_order="date",
)

ce_calc_router = APIRouter(prefix="/current-efficiency", tags=["current-efficiency"])


@ce_calc_router.post("/calculate")
def calculate_current_efficiency(
    n_cells: int,
    current_ka: float,
    v_pure_brine: float | None = None,
    v_anolyte: float | None = None,
    c_naclo3_pb: float | None = None,
    c_naclo3_an: float | None = None,
    c_hocl_an: float | None = None,
    c_hcl_pb: float | None = None,
    c_hcl_an: float | None = None,
    c_naoh_pb: float | None = None,
    c_na2co3_pb: float | None = None,
    acidified: bool = False,
):
    from ..calculations import current_efficiency

    result = current_efficiency(
        n_cells=n_cells,
        current_ka=current_ka,
        v_pure_brine=v_pure_brine,
        v_anolyte=v_anolyte,
        c_naclo3_pb=c_naclo3_pb,
        c_naclo3_an=c_naclo3_an,
        c_hocl_an=c_hocl_an,
        c_hcl_pb=c_hcl_pb,
        c_hcl_an=c_hcl_an,
        c_naoh_pb=c_naoh_pb,
        c_na2co3_pb=c_na2co3_pb,
        acidified=acidified,
    )
    return result
