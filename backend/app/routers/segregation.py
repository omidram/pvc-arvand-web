"""Electrode segregation / TAFKIK workshop decisions."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..excel_import import import_excel_bytes, read_xlsx
from ..import_jobs import spawn_import
from ..auth import require_admin
from ..export_utils import ExportFilters, build_export_meta, export_pdf, export_xlsx, rows_to_dicts
from ..plant_import import parse_tafkik_excel
from ..segregation_enrich import (
    apply_enrichment_to_row,
    build_latest_element_index,
    enrich_segregation_fields,
)
from ..warehouse import compact_eq, compact_nr

router = APIRouter(prefix="/electrode-segregations", tags=["segregation"])

EXPORT_FIELDS = list(schemas.ElectrodeSegregationRead.model_fields.keys())

_SEG_FIELD_NAMES = set(schemas.ElectrodeSegregationBase.model_fields.keys())


def _parse_iso_date(value: str | date | None) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value)
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        try:
            return datetime.fromisoformat(text).date()
        except ValueError:
            return None


def _row_kwargs(fields: dict) -> dict:
    out = {}
    for key in _SEG_FIELD_NAMES:
        if key not in fields:
            continue
        value = fields[key]
        if key.endswith("_date"):
            out[key] = _parse_iso_date(value)
        else:
            out[key] = value
    return out


@router.get("", response_model=list[schemas.ElectrodeSegregationRead])
def list_segregations(
    q: str | None = Query(default=None),
    electrode_kind: str | None = None,
    skip: int = 0,
    limit: int = Query(default=500, le=20000),
    db: Session = Depends(get_db),
):
    query = db.query(models.ElectrodeSegregation)
    if q:
        like = f"%{q}%"
        clauses = [
            models.ElectrodeSegregation.serial_nr.ilike(like),
            models.ElectrodeSegregation.company.ilike(like),
            models.ElectrodeSegregation.decision.ilike(like),
            models.ElectrodeSegregation.segregation.ilike(like),
            models.ElectrodeSegregation.problems.ilike(like),
            models.ElectrodeSegregation.pair_serial_nr.ilike(like),
            models.ElectrodeSegregation.inspection_form_serial.ilike(like),
        ]
        match = compact_eq(models.ElectrodeSegregation.serial_nr, q)
        if match is not None:
            clauses.append(match)
        query = query.filter(or_(*clauses))
    if electrode_kind:
        query = query.filter(models.ElectrodeSegregation.electrode_kind == electrode_kind)
    return (
        query.order_by(models.ElectrodeSegregation.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/export.meta", include_in_schema=False)
def export_meta_route():
    return build_export_meta(EXPORT_FIELDS)


@router.get("/export.xlsx", include_in_schema=False)
def export_xlsx_route(
    q: str | None = None,
    electrode_kind: str | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    items = list_segregations(q=q, electrode_kind=electrode_kind, limit=20000, db=db)
    rows = rows_to_dicts(items, EXPORT_FIELDS)
    rows, fields = filters.apply(rows, EXPORT_FIELDS)
    return export_xlsx(rows, fields, "electrode-segregations")


@router.get("/export.pdf", include_in_schema=False)
def export_pdf_route(
    q: str | None = None,
    electrode_kind: str | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    items = list_segregations(q=q, electrode_kind=electrode_kind, limit=2000, db=db)
    rows = rows_to_dicts(items, EXPORT_FIELDS)
    rows, fields = filters.apply(rows, EXPORT_FIELDS)
    return export_pdf(rows, fields, "electrode-segregations")


@router.post("/import.xlsx", include_in_schema=False)
async def import_segregations(_admin=Depends(require_admin), file: UploadFile = File(...)):
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


@router.post("/enrich-from-assembly")
def enrich_from_assembly(
    _admin=Depends(require_admin),
    limit: int = Query(default=20000, le=50000),
    db: Session = Depends(get_db),
):
    """Backfill company/dates/pair/monitoring from Assembly + AriaORMS. Keeps existing service_life."""
    index = build_latest_element_index(db)
    rows = (
        db.query(models.ElectrodeSegregation)
        .order_by(models.ElectrodeSegregation.id.asc())
        .limit(limit)
        .all()
    )
    updated = 0
    for i, row in enumerate(rows, start=1):
        if apply_enrichment_to_row(db, row, element_index=index):
            updated += 1
        if i % 200 == 0:
            db.flush()
    db.commit()
    return {"checked": len(rows), "updated": updated}


@router.get("/from-assembly")
def from_assembly(
    serial_nr: str = Query(..., min_length=1),
    preserve_service_life: str | None = None,
    db: Session = Depends(get_db),
):
    """Live form fill: Assembly + inspection + AriaORMS fields for one serial."""
    serial = serial_nr.strip()
    if not serial:
        raise HTTPException(status_code=400, detail="serial_nr required")
    fields = enrich_segregation_fields(
        db,
        serial_nr=serial,
        preserve_service_life=preserve_service_life or None,
    )
    # JSON-friendly dates
    out = {}
    for key, value in fields.items():
        if hasattr(value, "isoformat"):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out


@router.post("/import-tafkik-excel")
async def import_tafkik_excel(
    _admin=Depends(require_admin),
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
        anode_keys = {compact_nr(nr) for (nr,) in db.query(models.Anode.anode_nr).all() if nr}
        cathode_keys = {compact_nr(nr) for (nr,) in db.query(models.Cathode.cathode_nr).all() if nr}
        element_index = build_latest_element_index(db)
        created = 0
        for done, item in enumerate(records, start=1):
            kind = item.get("electrode_kind")
            if not kind or kind == "unknown":
                key = compact_nr(item["serial_nr"])
                if key in anode_keys and key not in cathode_keys:
                    kind = "anode"
                elif key in cathode_keys and key not in anode_keys:
                    kind = "cathode"
            fields = enrich_segregation_fields(
                db,
                serial_nr=item["serial_nr"],
                electrode_kind=kind,
                preserve_service_life=item.get("service_life") or None,
                excel_values=item,
                element_index=element_index,
            )
            db.add(models.ElectrodeSegregation(**_row_kwargs(fields)))
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
    data = payload.model_dump()
    fields = enrich_segregation_fields(
        db,
        serial_nr=data["serial_nr"],
        electrode_kind=data.get("electrode_kind"),
        preserve_service_life=data.get("service_life"),
        excel_values=data,
    )
    # Manual payload wins for explicitly set non-null values.
    for key, value in data.items():
        if value is not None:
            fields[key] = value
    if not data.get("service_life") and fields.get("service_life"):
        pass  # keep calculated
    obj = models.ElectrodeSegregation(**_row_kwargs(fields))
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
