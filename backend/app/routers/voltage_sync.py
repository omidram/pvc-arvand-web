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


@router.post("/run")
def run_voltage_sync_now(db: Session = Depends(get_db)):
    """Pull complete AriaORMS log sheets for all electrolyzers (includes today)."""
    _get_or_create(db)

    def work(session: Session, progress):
        row = session.query(models.VoltageSyncSettings).first()
        result = voltage_sync.pull_from_ariaorms(
            session,
            row,
            include_today=True,
            progress=progress,
        )
        try:
            # Do not overwrite AriaORMS last_run_* when the watch folder is empty.
            folder = voltage_sync.scan_and_apply(
                session,
                session.query(models.VoltageSyncSettings).first(),
                record_run=False,
            )
            if folder.get("files_applied"):
                result["files_applied"] = int(result.get("files_applied") or 0) + int(
                    folder.get("files_applied") or 0
                )
                result["rows_upserted"] = int(result.get("rows_upserted") or 0) + int(
                    folder.get("rows_upserted") or 0
                )
                result["message"] = f"{result.get('message')}; folder: {folder.get('message')}"
                # Folder actually contributed data — refresh the stamp from AriaORMS row.
                row2 = session.query(models.VoltageSyncSettings).first()
                if row2:
                    result["last_run_at"] = row2.last_run_at.isoformat() if row2.last_run_at else None
        except Exception:  # noqa: BLE001
            pass
        return result

    return spawn_import(work)


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
