"""ARIAORMS LogSheets Excel watch-folder sync into Standardized Voltage."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas, voltage_sync, voltage_sync_scheduler
from ..database import get_db
from ..import_jobs import spawn_import

router = APIRouter(prefix="/voltage-sync", tags=["voltage-sync"])


def _get_or_create(db: Session) -> models.VoltageSyncSettings:
    obj = db.query(models.VoltageSyncSettings).first()
    if not obj:
        obj = models.VoltageSyncSettings(
            watch_dir=str(voltage_sync.default_watch_dir()),
            source_url="http://192.168.20.12:8080/LogSheetsReports.aspx",
        )
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


def _to_read(obj: models.VoltageSyncSettings) -> schemas.VoltageSyncSettingsRead:
    resolved = voltage_sync.resolve_watch_dir(obj.watch_dir)
    data = schemas.VoltageSyncSettingsRead.model_validate(obj)
    data.resolved_watch_dir = str(resolved)
    data.watched_file_count = voltage_sync.count_watched_files(obj.watch_dir)
    return data


@router.get("/settings", response_model=schemas.VoltageSyncSettingsRead)
def get_voltage_sync_settings(db: Session = Depends(get_db)):
    return _to_read(_get_or_create(db))


@router.put("/settings", response_model=schemas.VoltageSyncSettingsRead)
def update_voltage_sync_settings(
    payload: schemas.VoltageSyncSettingsUpdate,
    db: Session = Depends(get_db),
):
    obj = _get_or_create(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    if not obj.watch_dir:
        obj.watch_dir = str(voltage_sync.default_watch_dir())
    db.commit()
    db.refresh(obj)
    voltage_sync_scheduler.apply_schedule(obj)
    return _to_read(obj)


@router.post("/run", response_model=schemas.VoltageSyncRunResult)
def run_voltage_sync_now(db: Session = Depends(get_db)):
    obj = _get_or_create(db)
    result = voltage_sync.scan_and_apply(db, obj)
    return schemas.VoltageSyncRunResult(**result)


@router.post("/import-file")
async def import_voltage_sync_file(
    file: UploadFile,
    electrolyzer: str | None = None,
    reading_date: str | None = None,
):
    """Manual one-shot upsert of an ARIAORMS Excel export (same logic as the watcher)."""
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
            db.commit()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "ok": True,
            "files_scanned": 1,
            "files_applied": 1,
            "rows_upserted": int(info.get("rows_upserted") or 0),
            "message": (
                f"Upserted {info.get('rows_upserted')} rows for "
                f"{info.get('electrolyzer')} on {info.get('reading_date')}"
            ),
            "details": [info],
        }

    return spawn_import(work)
