from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..crud import build_crud_router
from ..database import get_db
from ..excel_import import import_excel_bytes, read_xlsx
from ..import_jobs import spawn_import
from ..export_utils import export_pdf, export_xlsx, rows_to_dicts

router = APIRouter(prefix="/shutdowns", tags=["shutdowns"])

SHUTDOWN_EXPORT_FIELDS = list(schemas.ShutdownRead.model_fields.keys())


def _enrich(obj: models.Shutdown) -> schemas.ShutdownRead:
    read = schemas.ShutdownRead.model_validate(obj)
    if obj.shutdown_time and obj.startup_time:
        read.duration_hours = round((obj.startup_time - obj.shutdown_time).total_seconds() / 3600, 2)
    return read


@router.get("", response_model=list[schemas.ShutdownRead])
def list_shutdowns(
    q: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    skip: int = 0,
    limit: int = Query(default=500, le=5000),
    db: Session = Depends(get_db),
):
    query = db.query(models.Shutdown)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(models.Shutdown.plant_part.ilike(like), models.Shutdown.cause.ilike(like), models.Shutdown.category.ilike(like))
        )
    if date_from is not None:
        query = query.filter(models.Shutdown.shutdown_time >= date_from)
    if date_to is not None:
        query = query.filter(models.Shutdown.shutdown_time <= date_to)
    items = query.order_by(models.Shutdown.shutdown_time.desc()).offset(skip).limit(limit).all()
    return [_enrich(i) for i in items]


@router.get("/export.xlsx", include_in_schema=False)
def export_shutdowns_xlsx(
    q: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    db: Session = Depends(get_db),
):
    items = list_shutdowns(q=q, date_from=date_from, date_to=date_to, limit=20000, db=db)
    rows = rows_to_dicts(items, SHUTDOWN_EXPORT_FIELDS)
    return export_xlsx(rows, SHUTDOWN_EXPORT_FIELDS, "shutdowns")


@router.get("/export.pdf", include_in_schema=False)
def export_shutdowns_pdf(
    q: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    db: Session = Depends(get_db),
):
    items = list_shutdowns(q=q, date_from=date_from, date_to=date_to, limit=2000, db=db)
    rows = rows_to_dicts(items, SHUTDOWN_EXPORT_FIELDS)
    return export_pdf(rows, SHUTDOWN_EXPORT_FIELDS, "shutdowns")


@router.post("/import.xlsx", include_in_schema=False)
async def import_shutdowns(file: UploadFile = File(...)):
    content = await read_xlsx(file)
    return spawn_import(
        lambda db, progress: import_excel_bytes(
            db, models.Shutdown, schemas.ShutdownBase, content, pk_field="nr", progress=progress
        )
    )


@router.get("/{nr}", response_model=schemas.ShutdownRead)
def get_shutdown(nr: int, db: Session = Depends(get_db)):
    obj = db.query(models.Shutdown).filter(models.Shutdown.nr == nr).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return _enrich(obj)


@router.post("", response_model=schemas.ShutdownRead, status_code=201)
def create_shutdown(payload: schemas.ShutdownBase, db: Session = Depends(get_db)):
    obj = models.Shutdown(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _enrich(obj)


@router.put("/{nr}", response_model=schemas.ShutdownRead)
def update_shutdown(nr: int, payload: schemas.ShutdownBase, db: Session = Depends(get_db)):
    obj = db.query(models.Shutdown).filter(models.Shutdown.nr == nr).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return _enrich(obj)


@router.delete("/{nr}", status_code=204)
def delete_shutdown(nr: int, db: Session = Depends(get_db)):
    obj = db.query(models.Shutdown).filter(models.Shutdown.nr == nr).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(obj)
    db.commit()
    return None


categories_router = build_crud_router(
    model=models.ShutdownCategory,
    read_schema=schemas.ShutdownCategoryRead,
    write_schema=schemas.ShutdownCategoryBase,
    prefix="/shutdown-categories",
    tags=["shutdowns"],
)

causes_router = build_crud_router(
    model=models.ShutdownCause,
    read_schema=schemas.ShutdownCauseRead,
    write_schema=schemas.ShutdownCauseBase,
    prefix="/shutdown-causes",
    tags=["shutdowns"],
    search_fields=["cause", "category"],
)

summary_router = APIRouter(prefix="/shutdowns-summary", tags=["shutdowns"])


def _hours(s: models.Shutdown) -> float:
    if s.shutdown_time and s.startup_time:
        return max((s.startup_time - s.shutdown_time).total_seconds() / 3600, 0)
    return 0.0


@summary_router.get("")
def shutdown_summary(db: Session = Depends(get_db)):
    shutdowns = db.query(models.Shutdown).all()
    by_category: dict[str, dict] = {}
    by_reason: dict[str, dict] = {}
    for s in shutdowns:
        hours = _hours(s)
        cat = s.category or "Unknown"
        cat_entry = by_category.setdefault(cat, {"category": cat, "count": 0, "total_hours": 0.0})
        cat_entry["count"] += 1
        cat_entry["total_hours"] += hours

        key = f"{s.code or ''}|{s.cause or ''}|{s.category or ''}"
        reason_entry = by_reason.setdefault(
            key,
            {
                "code": s.code,
                "cause": s.cause,
                "category": s.category,
                "count": 0,
                "total_hours": 0.0,
            },
        )
        reason_entry["count"] += 1
        reason_entry["total_hours"] += hours

    for entry in by_category.values():
        entry["total_hours"] = round(entry["total_hours"], 2)
    for entry in by_reason.values():
        entry["total_hours"] = round(entry["total_hours"], 2)

    total_hours = round(sum(_hours(s) for s in shutdowns), 2)
    return {
        "total_shutdowns": len(shutdowns),
        "total_hours": total_hours,
        "by_category": list(by_category.values()),
        "by_reason": list(by_reason.values()),
    }
