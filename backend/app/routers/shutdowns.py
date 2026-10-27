from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import inspect as sa_inspect, or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..crud import build_crud_router
from ..database import get_db
from ..excel_import import import_excel_bytes, read_xlsx
from ..import_jobs import spawn_import
from ..auth import require_admin
from ..export_utils import ExportFilters, build_export_meta, export_pdf, export_xlsx, rows_to_dicts

router = APIRouter(prefix="/shutdowns", tags=["shutdowns"])

SHUTDOWN_EXPORT_FIELDS = list(schemas.ShutdownRead.model_fields.keys())


def _duration_hours(obj: models.Shutdown) -> float | None:
    if not (obj.shutdown_time and obj.startup_time):
        return None
    seconds = (obj.startup_time - obj.shutdown_time).total_seconds()
    return round(max(seconds, 0) / 3600, 4) if seconds >= 0 else 0.0


def _mtbf_days(db: Session, obj: models.Shutdown) -> float | None:
    """Days from the previous shutdown of the same plant part (switch / electrolyzer) to this one."""
    part = (obj.plant_part or "").strip()
    if not part or not obj.shutdown_time:
        return None
    prev = (
        db.query(models.Shutdown)
        .filter(
            models.Shutdown.plant_part == part,
            models.Shutdown.shutdown_time.isnot(None),
            models.Shutdown.shutdown_time < obj.shutdown_time,
            models.Shutdown.nr != obj.nr if obj.nr else True,
        )
        .order_by(models.Shutdown.shutdown_time.desc())
        .first()
    )
    if not prev or not prev.shutdown_time:
        return None
    return round((obj.shutdown_time - prev.shutdown_time).total_seconds() / 86400, 2)


def _apply_trip_metrics(db: Session, obj: models.Shutdown) -> None:
    """Fill lost load / production / MTBF from Duration×KA/4.85 and prior trip of the same plant part."""
    hours = _duration_hours(obj)
    ka = obj.ka_before_trip
    if hours is not None and ka is not None:
        try:
            obj.lost_load = round(float(ka) * 0.2074 * float(hours), 4)
            obj.lost_production = round(float(ka) * 0.2336 * float(hours), 4)
        except (TypeError, ValueError):
            pass
    else:
        obj.lost_load = None
        obj.lost_production = None
    # Auto-fill MTBF when empty (operator can still override with a typed value).
    if obj.mtbf_days is None:
        obj.mtbf_days = _mtbf_days(db, obj)


def _enrich(obj: models.Shutdown) -> schemas.ShutdownRead:
    read = schemas.ShutdownRead.model_validate(obj)
    read.duration_hours = _duration_hours(obj)
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
    # Access continuous form order: by No. ascending (1, 2, 3 …), newest at the bottom.
    items = query.order_by(models.Shutdown.nr.asc()).offset(skip).limit(limit).all()
    return [_enrich(i) for i in items]


@router.get("/export.meta", include_in_schema=False)
def export_shutdowns_meta():
    return build_export_meta(SHUTDOWN_EXPORT_FIELDS)


@router.get("/export.xlsx", include_in_schema=False)
def export_shutdowns_xlsx(
    q: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    items = list_shutdowns(q=q, date_from=date_from, date_to=date_to, limit=20000, db=db)
    rows = rows_to_dicts(items, SHUTDOWN_EXPORT_FIELDS)
    rows, fields = filters.apply(rows, SHUTDOWN_EXPORT_FIELDS)
    return export_xlsx(rows, fields, "shutdowns")


@router.get("/export.pdf", include_in_schema=False)
def export_shutdowns_pdf(
    q: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    items = list_shutdowns(q=q, date_from=date_from, date_to=date_to, limit=2000, db=db)
    rows = rows_to_dicts(items, SHUTDOWN_EXPORT_FIELDS)
    rows, fields = filters.apply(rows, SHUTDOWN_EXPORT_FIELDS)
    return export_pdf(rows, fields, "shutdowns")


@router.post("/import.xlsx", include_in_schema=False)
async def import_shutdowns(_admin=Depends(require_admin), file: UploadFile = File(...)):
    content = await read_xlsx(file)
    filename = file.filename
    who = _admin.username
    return spawn_import(
        lambda db, progress: import_excel_bytes(
            db,
            models.Shutdown,
            schemas.ShutdownBase,
            content,
            pk_field="nr",
            progress=progress,
            file_key="shutdowns",
            file_name=filename,
            uploaded_by=who,
        )
    )


@router.get("/{nr}", response_model=schemas.ShutdownRead)
def get_shutdown(nr: int, db: Session = Depends(get_db)):
    obj = db.query(models.Shutdown).filter(models.Shutdown.nr == nr).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return _enrich(obj)


def _validate(obj: models.Shutdown) -> None:
    """Same rules as the Access form: a trip needs a plant part and a shutdown time; start-up cannot precede it."""
    if not (obj.plant_part or "").strip():
        raise HTTPException(status_code=422, detail="Plant part is required.")
    if obj.shutdown_time is None:
        raise HTTPException(status_code=422, detail="Shutdown time is required.")
    if obj.startup_time is not None and obj.startup_time < obj.shutdown_time:
        raise HTTPException(status_code=422, detail="Start-up time cannot be before the shutdown time.")


def _fill_from_code(db: Session, obj: models.Shutdown) -> None:
    """Access combo behaviour: picking a Code fills the cause and category from the reasons list (English first)."""
    code = (obj.code or "").strip()
    if not code or ((obj.cause or "").strip() and (obj.category or "").strip()):
        return
    hits = [c for c in db.query(models.ShutdownCause).all() if (c.code or "").strip().casefold() == code.casefold()]
    if not hits:
        return
    hits.sort(key=lambda c: 0 if c.language_id == 2 else 1)
    hit = hits[0]
    if not (obj.cause or "").strip():
        obj.cause = hit.cause
    if not (obj.category or "").strip():
        obj.category = hit.category


def _sync_lookups(db: Session, obj: models.Shutdown) -> None:
    """A typed cause / category joins the lookup lists (spelling of an existing entry wins)."""
    _fill_from_code(db, obj)
    cat = (obj.category or "").strip()
    if cat:
        hit = next(
            (c for c in db.query(models.ShutdownCategory).all() if (c.category or "").strip().casefold() == cat.casefold()),
            None,
        )
        if hit is None:
            db.add(models.ShutdownCategory(category=cat))
        else:
            obj.category = hit.category
    cause = (obj.cause or "").strip()
    if cause:
        hit = next(
            (c for c in db.query(models.ShutdownCause).all() if (c.cause or "").strip().casefold() == cause.casefold()),
            None,
        )
        if hit is None:
            db.add(models.ShutdownCause(cause=cause, category=obj.category, code=obj.code))
        else:
            obj.cause = hit.cause


@router.post("", response_model=schemas.ShutdownRead, status_code=201)
def create_shutdown(payload: schemas.ShutdownBase, db: Session = Depends(get_db)):
    obj = models.Shutdown(**payload.model_dump())
    _validate(obj)
    _sync_lookups(db, obj)
    db.add(obj)
    db.flush()
    _apply_trip_metrics(db, obj)
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
    if obj.shutdown_time and obj.startup_time and obj.startup_time < obj.shutdown_time:
        raise HTTPException(status_code=422, detail="Start-up time cannot be before the shutdown time.")
    _sync_lookups(db, obj)
    _apply_trip_metrics(db, obj)
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


def _old(obj, attr: str):
    """Value an attribute had before the pending edit (or the current one when untouched)."""
    hist = sa_inspect(obj).attrs[attr].history
    return hist.deleted[0] if hist.deleted else getattr(obj, attr)


def _category_saved(db: Session, cat: models.ShutdownCategory) -> None:
    """Access keeps category as text in the reasons and trips: renaming it in the list renames it everywhere."""
    new = (cat.category or "").strip()
    old = (_old(cat, "category") or "").strip()
    if new and old and new != old:
        db.query(models.ShutdownCause).filter(models.ShutdownCause.category == old).update({"category": new}, synchronize_session=False)
        db.query(models.Shutdown).filter(models.Shutdown.category == old).update({"category": new}, synchronize_session=False)


def _cause_saved(db: Session, cause: models.ShutdownCause) -> None:
    with db.no_autoflush:
        _cause_saved_inner(db, cause)


def _cause_saved_inner(db: Session, cause: models.ShutdownCause) -> None:
    is_new = cause.id is None
    """A reason (code + text + category) joins the category list and carries edits into the trips that use it."""
    cause.code = (cause.code or "").strip() or None
    cause.cause = (cause.cause or "").strip() or None
    cat = (cause.category or "").strip()
    if cat:
        hit = next((c for c in db.query(models.ShutdownCategory).all() if (c.category or "").strip().casefold() == cat.casefold()), None)
        if hit is None:
            db.add(models.ShutdownCategory(category=cat))
        else:
            cause.category = hit.category
    if cause.language_id is None:
        cause.language_id = 2
    if is_new:
        clash = [
            c
            for c in db.query(models.ShutdownCause).all()
            if c.language_id == cause.language_id
            and (c.code or "").strip().casefold() == (cause.code or "").casefold()
            and (c.cause or "").strip().casefold() == (cause.cause or "").casefold()
        ]
        if clash:
            raise HTTPException(status_code=409, detail="This reason already exists.")
        return
    old_code, old_text = _old(cause, "code"), _old(cause, "cause")
    if (old_code, old_text) != (cause.code, cause.cause) or sa_inspect(cause).attrs["category"].history.has_changes():
        q = db.query(models.Shutdown).filter(models.Shutdown.cause == old_text)
        if old_code:
            q = q.filter(models.Shutdown.code == old_code)
        q.update({"code": cause.code, "cause": cause.cause, "category": cause.category}, synchronize_session=False)


categories_router = build_crud_router(
    model=models.ShutdownCategory,
    read_schema=schemas.ShutdownCategoryRead,
    write_schema=schemas.ShutdownCategoryBase,
    prefix="/shutdown-categories",
    tags=["shutdowns"],
    required_fields=["category"],
    after_save=_category_saved,
)

causes_router = build_crud_router(
    model=models.ShutdownCause,
    read_schema=schemas.ShutdownCauseRead,
    write_schema=schemas.ShutdownCauseBase,
    prefix="/shutdown-causes",
    tags=["shutdowns"],
    search_fields=["cause", "category"],
    required_fields=["code", "cause"],
    after_save=_cause_saved,
)

summary_router = APIRouter(prefix="/shutdowns-summary", tags=["shutdowns"])


def _hours(s: models.Shutdown) -> float:
    if s.shutdown_time and s.startup_time:
        return max((s.startup_time - s.shutdown_time).total_seconds() / 3600, 0)
    return 0.0


@summary_router.get("")
def shutdown_summary(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
):
    query = db.query(models.Shutdown)
    if date_from is not None:
        query = query.filter(models.Shutdown.shutdown_time >= date_from)
    if date_to is not None:
        query = query.filter(models.Shutdown.shutdown_time <= date_to)
    shutdowns = query.all()
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

