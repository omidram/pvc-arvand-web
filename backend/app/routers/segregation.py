"""Electrode segregation / TAFKIK workshop decisions."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..excel_import import import_excel_bytes, read_xlsx
from ..import_jobs import spawn_import
from ..export_utils import export_pdf, export_xlsx, rows_to_dicts
from ..plant_import import parse_tafkik_excel

router = APIRouter(prefix="/electrode-segregations", tags=["segregation"])

EXPORT_FIELDS = list(schemas.ElectrodeSegregationRead.model_fields.keys())


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        try:
            return datetime.fromisoformat(value).date()
        except ValueError:
            return None


@router.get("", response_model=list[schemas.ElectrodeSegregationRead])
def list_segregations(
    q: str | None = Query(default=None),
    electrode_kind: str | None = None,
    skip: int = 0,
    limit: int = Query(default=500, le=5000),
    db: Session = Depends(get_db),
):
    query = db.query(models.ElectrodeSegregation)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                models.ElectrodeSegregation.serial_nr.ilike(like),
                models.ElectrodeSegregation.company.ilike(like),
                models.ElectrodeSegregation.decision.ilike(like),
                models.ElectrodeSegregation.segregation.ilike(like),
                models.ElectrodeSegregation.problems.ilike(like),
            )
        )
    if electrode_kind:
        query = query.filter(models.ElectrodeSegregation.electrode_kind == electrode_kind)
    return (
        query.order_by(models.ElectrodeSegregation.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/export.xlsx", include_in_schema=False)
def export_xlsx_route(q: str | None = None, electrode_kind: str | None = None, db: Session = Depends(get_db)):
    items = list_segregations(q=q, electrode_kind=electrode_kind, limit=20000, db=db)
    rows = rows_to_dicts(items, EXPORT_FIELDS)
    return export_xlsx(rows, EXPORT_FIELDS, "electrode-segregations")


@router.get("/export.pdf", include_in_schema=False)
def export_pdf_route(q: str | None = None, electrode_kind: str | None = None, db: Session = Depends(get_db)):
    items = list_segregations(q=q, electrode_kind=electrode_kind, limit=2000, db=db)
    rows = rows_to_dicts(items, EXPORT_FIELDS)
    return export_pdf(rows, EXPORT_FIELDS, "electrode-segregations")


@router.post("/import.xlsx", include_in_schema=False)
async def import_segregations(file: UploadFile = File(...)):
    content = await read_xlsx(file)
    return spawn_import(
        lambda db, progress: import_excel_bytes(
            db,
            models.ElectrodeSegregation,
            schemas.ElectrodeSegregationBase,
            content,
            pk_field="id",
            progress=progress,
        )
    )


@router.post("/import-tafkik-excel")
async def import_tafkik_excel(
    file: UploadFile = File(...),
    sheet: str | None = None,
):
    """Import TAFKIK segregation workbook (workshop warranty / recoating decisions)."""
    content = await file.read()
    parsed = parse_tafkik_excel(content, sheet=sheet)

    def work(db: Session, progress):
        records = parsed.get("records") or []
        total = len(records)
        if progress:
            progress(0, total)
        created = 0
        for done, item in enumerate(records, start=1):
            db.add(
                models.ElectrodeSegregation(
                    serial_nr=item["serial_nr"],
                    electrode_kind=item.get("electrode_kind"),
                    company=item.get("company"),
                    service_life=item.get("service_life"),
                    install_date=_parse_iso_date(item.get("install_date")),
                    dismantle_date=_parse_iso_date(item.get("dismantle_date")),
                    inspection_date=_parse_iso_date(item.get("inspection_date")),
                    xrf=item.get("xrf"),
                    voltage_quality=item.get("voltage_quality"),
                    warranty=item.get("warranty"),
                    coating_quality=item.get("coating_quality"),
                    decision=item.get("decision"),
                    problems=item.get("problems"),
                    segregation=item.get("segregation"),
                    pallet=item.get("pallet"),
                )
            )
            created += 1
            if created % 500 == 0:
                db.flush()
            if progress and (done == total or done % 25 == 0):
                progress(done, total)
        db.commit()
        return {
            "imported_rows": created,
            "sheet": parsed.get("sheet"),
            "preview": records[:3],
        }

    return spawn_import(work)


@router.get("/{item_id}", response_model=schemas.ElectrodeSegregationRead)
def get_segregation(item_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.ElectrodeSegregation).filter(models.ElectrodeSegregation.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


@router.post("", response_model=schemas.ElectrodeSegregationRead, status_code=201)
def create_segregation(payload: schemas.ElectrodeSegregationBase, db: Session = Depends(get_db)):
    obj = models.ElectrodeSegregation(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{item_id}", response_model=schemas.ElectrodeSegregationRead)
def update_segregation(item_id: int, payload: schemas.ElectrodeSegregationBase, db: Session = Depends(get_db)):
    obj = db.query(models.ElectrodeSegregation).filter(models.ElectrodeSegregation.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{item_id}", status_code=204)
def delete_segregation(item_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.ElectrodeSegregation).filter(models.ElectrodeSegregation.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(obj)
    db.commit()
    return None
