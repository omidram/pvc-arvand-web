"""ARIAORMS LogSheets sync into Standardized Voltage (daily HTTP + watch folder)."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas, voltage_sync, voltage_sync_scheduler
from ..database import get_db
from ..import_jobs import spawn_import

router = APIRouter(prefix="/voltage-sync", tags=["voltage-sync"])


def _get_or_create(db: Session) -> models.VoltageSyncSettings:
    obj = db.query(models.VoltageSyncSettings).first()
    if not obj:
        obj = voltage_sync_scheduler._default_settings()
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


def _to_read(obj: models.VoltageSyncSettings) -> schemas.VoltageSyncSettingsRead:
    resolved = voltage_sync.resolve_watch_dir(obj.watch_dir)
    data = schemas.VoltageSyncSettingsRead.model_validate(obj)
    data.password_set = bool(obj.password)
    data.resolved_watch_dir = str(resolved)
    data.watched_file_count = voltage_sync.count_watched_files(obj.watch_dir)
    data.next_run_at = voltage_sync_scheduler.get_next_run_at() if obj.enabled else None
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
    data = payload.model_dump(exclude_unset=True)
    password = data.pop("password", None)
    for key, value in data.items():
        setattr(obj, key, value)
    if password is not None and str(password).strip() != "":
        obj.password = str(password)
    if not obj.watch_dir:
        obj.watch_dir = str(voltage_sync.default_watch_dir())
    if not (obj.daily_time or "").strip():
        obj.daily_time = "00:00"
    db.commit()
    db.refresh(obj)
    voltage_sync_scheduler.apply_schedule(obj)
    return _to_read(obj)


@router.get("/active")
def voltage_sync_active():
    """Job started from Settings. It keeps running after the browser leaves the page."""
    from ..import_jobs import get_job

    job_id = voltage_sync.active_pull_job()
    job = get_job(job_id) if job_id else None
    running = bool(job and not job.get("done"))
    return {
        "running": running,
        "job_id": job_id,
        "percent": int((job or {}).get("percent") or 0),
        "processed": int((job or {}).get("processed") or 0),
        "total": int((job or {}).get("total") or 0),
        "done": bool((job or {}).get("done")),
        "error": (job or {}).get("error"),
    }


@router.post("/run")
def run_voltage_sync_now(db: Session = Depends(get_db)):
    """Pull today's AriaORMS log sheets on the server. Navigation does not cancel it."""
    _get_or_create(db)
    return voltage_sync.launch_pull(include_today=True)


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
            "mode": "upload",
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
