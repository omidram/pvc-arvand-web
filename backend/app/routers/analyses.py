from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
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

# Common chemistry parameters shown per analysis type in the input form (units for display only).
PARAMETER_UNITS: dict[str, dict[str, str]] = {
    "anolyte": {"NaCl": "g/l", "NaClO3": "g/l", "NaOCl": "g/l", "HCl": "g/l", "density_20C": "g/ml", "Na2SO4": "g/l", "temperature": "degC", "pH": ""},
    "catholyte": {"make_up_water": "m3/h", "temperature": "degC", "NaOH": "%w/w", "NaCl": "ppm", "NaClO3": "ppm", "Na2SO4": "g/l", "Fe": "ppm", "Ni": "ppm"},
    "chlorine_gas": {"Cl2_CO2": "%vol", "restgas": "%vol", "O2": "%vol", "H2": "%vol", "N2": "%vol", "Br": "ppm"},
    "pure_brine": {"flow_rate": "m3/h", "NaClO3": "g/l", "Na2SO4": "g/l", "NaOH": "g/l", "Na2CO3": "g/l", "NaOCl": "g/l", "HCl": "g/l", "temperature": "degC", "pH": "", "density_20C": "g/ml", "NaCl": "g/l"},
    "demin_water": {"conductivity": "uS/cm", "Fe": "ppm", "SiO2": "ppm", "Cl": "ppm", "O2_dissolved": "ppm", "organics": "ppm"},
    "hydrogen": {"H2": "%vol", "O2": "%vol"},
    "caustic_feed": {"flow_rate": "m3/h", "NaOH": "%w/w", "NaCl": "ppm", "NaClO3": "ppm", "Ni": "ppm", "Fe": "ppm", "temperature": "degC"},
    "hcl": {"flow_rate": "m3/h", "HCl": "%w/w", "density": "g/ml"},
}


@router.get("/meta")
def analysis_meta():
    return {"types": ANALYSIS_TYPES, "parameter_units": PARAMETER_UNITS}


@router.post("/import-lab-excel")
async def import_lab_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Import hierarchical LIMS / plant lab Excel (Caustic Train sample format)."""
    content = await file.read()
    parsed = parse_lab_analysis_excel(content)
    created = 0
    for sample in parsed.get("samples") or []:
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
    db.commit()
    return {"imported_samples": created, "preview": (parsed.get("samples") or [])[:3]}


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
    if scope:
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
