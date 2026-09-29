from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..excel_import import import_excel_bytes, read_xlsx
from ..import_jobs import spawn_import
from ..export_utils import export_pdf, export_xlsx, rows_to_dicts
from ..plant_import import parse_lab_analysis_excel
from datetime import datetime

router = APIRouter(prefix="/analyses", tags=["analyses"])

ANALYSIS_EXPORT_FIELDS = list(schemas.AnalysisSampleRead.model_fields.keys())

ANALYSIS_TYPES = [
    "anolyte",
    "catholyte",
    "chlorine_gas",
    "pure_brine",
    "demin_water",
    "hydrogen",
    "caustic_feed",
    "hcl",
]

# Display units from the Access forms. The entry screen uses a per-scope field
# list (frontend analysis-forms.ts); these are the shared units for /meta.
PARAMETER_UNITS: dict[str, dict[str, str]] = {
    "anolyte": {"NaCl": "g/l", "NaClO3": "g/l", "Na2SO4": "g/l", "NaOCl": "g/l", "HCl": "g/l", "density_20C": "g/l", "temperature": "°C", "pH": "[/]"},
    "catholyte": {"make_up_water": "m³/h", "temperature": "°C", "NaOH": "wt.%", "NaCl": "ppm w", "NaClO3": "ppm w", "Na2SO4": "ppm w", "Fe": "ppm w"},
    "chlorine_gas": {"Cl2_CO2": "Vol.%", "restgas": "Vol.%", "O2": "Vol.%", "H2": "Vol.%", "N2": "Vol.%", "Br": "Vol. ppm"},
    "pure_brine": {
        "flow_rate": "m³/h", "temperature": "°C", "pH": "-", "density_20C": "g/l",
        "NaCl": "g/l", "NaClO3": "g/l", "Na2CO3": "g/l", "NaOH": "g/l", "Na2SO4": "g/l", "NaOCl": "g/l", "HCl": "g/l",
        "Ca+Mg": "ppb w", "Ba": "ppb w", "Sr": "ppb w", "Ni": "ppb w", "Fe": "ppb w", "Al": "ppb w",
        "SiO2": "ppb w", "I": "ppb w", "F": "ppb w", "Br": "ppb w", "Organics": "ppm w", "H2O2": "ppm w",
    },
    "demin_water": {"conductivity": "µS/cm", "Fe": "ppm w", "SiO2": "ppm w", "Cl": "ppm w", "O2_dissolved": "ppm w", "organics": "ppm w"},
    "hydrogen": {"H2": "vol. %", "O2": "ppm v"},
    "caustic_feed": {"flow_rate": "m³/h", "NaOH": "wt. %", "Fe": "ppm w", "temperature": "°C"},
    "hcl": {"flow_rate": "l/h", "HCl": "% w", "density": "g/l"},
}


@router.get("/meta")
def analysis_meta():
    return {"types": ANALYSIS_TYPES, "parameter_units": PARAMETER_UNITS}


@router.post("/import-lab-excel")
async def import_lab_excel(file: UploadFile = File(...)):
    """Import hierarchical LIMS / plant lab Excel (Caustic Train sample format)."""
    content = await file.read()
    parsed = parse_lab_analysis_excel(content)

    def work(db: Session, progress):
        samples = parsed.get("samples") or []
        total = len(samples)
        if progress:
            progress(0, total)
        created = 0
        for done, sample in enumerate(samples, start=1):
            dt = None
            if sample.get("date"):
                try:
                    dt = datetime.fromisoformat(sample["date"])
                except ValueError:
                    dt = None
            db.add(
                models.AnalysisSample(
                    analysis_type=sample["analysis_type"],
                    scope=sample.get("scope") or "sub_plant",
                    sub_plant=sample.get("sub_plant"),
                    date=dt,
                    time=sample.get("time"),
                    parameters=sample.get("parameters") or {},
                )
            )
            created += 1
            if progress and (done == total or done % 25 == 0):
                progress(done, total)
        db.commit()
        return {"imported_samples": created, "preview": samples[:3]}

    return spawn_import(work)


@router.get("", response_model=list[schemas.AnalysisSampleRead])
def list_analyses(
    analysis_type: str | None = None,
    scope: str | None = None,
    electrolyzer: str | None = None,
    skip: int = 0,
    limit: int = Query(default=500, le=5000),
    db: Session = Depends(get_db),
):
    query = db.query(models.AnalysisSample)
    if analysis_type:
        query = query.filter(models.AnalysisSample.analysis_type == analysis_type)
    if scope in ("plant", "total_plant"):
        query = query.filter(models.AnalysisSample.scope.in_(("plant", "total_plant")))
    elif scope:
        query = query.filter(models.AnalysisSample.scope == scope)
    if electrolyzer:
        query = query.filter(models.AnalysisSample.electrolyzer == electrolyzer)
    return query.order_by(models.AnalysisSample.date.desc()).offset(skip).limit(limit).all()


@router.get("/export.xlsx", include_in_schema=False)
def export_analyses_xlsx(
    analysis_type: str | None = None, scope: str | None = None, electrolyzer: str | None = None, db: Session = Depends(get_db)
):
    items = list_analyses(analysis_type=analysis_type, scope=scope, electrolyzer=electrolyzer, limit=20000, db=db)
    rows = rows_to_dicts(items, ANALYSIS_EXPORT_FIELDS)
    return export_xlsx(rows, ANALYSIS_EXPORT_FIELDS, "analyses")


@router.get("/export.pdf", include_in_schema=False)
def export_analyses_pdf(
    analysis_type: str | None = None, scope: str | None = None, electrolyzer: str | None = None, db: Session = Depends(get_db)
):
    items = list_analyses(analysis_type=analysis_type, scope=scope, electrolyzer=electrolyzer, limit=2000, db=db)
    rows = rows_to_dicts(items, ANALYSIS_EXPORT_FIELDS)
    return export_pdf(rows, ANALYSIS_EXPORT_FIELDS, "analyses")


@router.post("/import.xlsx", include_in_schema=False)
async def import_analyses(file: UploadFile = File(...)):
    content = await read_xlsx(file)
    return spawn_import(
        lambda db, progress: import_excel_bytes(
            db, models.AnalysisSample, schemas.AnalysisSampleBase, content, pk_field="id", progress=progress
        )
    )


@router.get("/{item_id}", response_model=schemas.AnalysisSampleRead)
def get_analysis(item_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException

    obj = db.query(models.AnalysisSample).filter(models.AnalysisSample.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


@router.post("", response_model=schemas.AnalysisSampleRead, status_code=201)
def create_analysis(payload: schemas.AnalysisSampleBase, db: Session = Depends(get_db)):
    obj = models.AnalysisSample(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{item_id}", response_model=schemas.AnalysisSampleRead)
def update_analysis(item_id: int, payload: schemas.AnalysisSampleBase, db: Session = Depends(get_db)):
    from fastapi import HTTPException

    obj = db.query(models.AnalysisSample).filter(models.AnalysisSample.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{item_id}", status_code=204)
def delete_analysis(item_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.AnalysisSample).filter(models.AnalysisSample.id == item_id).first()
    if obj:
        db.delete(obj)
        db.commit()
    return None
