"""Automatic/manual SQLite database backup: schedule configuration, manual run,
history listing, download, and deletion of backup files."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import backup_scheduler, backup_utils, models, schemas
from ..database import get_db

router = APIRouter(prefix="/backup", tags=["backup"])


def _get_or_create(db: Session) -> models.BackupSettings:
    obj = db.query(models.BackupSettings).first()
    if not obj:
        obj = models.BackupSettings()
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


def _to_read(obj: models.BackupSettings) -> schemas.BackupSettingsRead:
    data = schemas.BackupSettingsRead.model_validate(obj)
    data.next_run_at = backup_scheduler.get_next_run_at() if obj.enabled else None
    return data


@router.get("/settings", response_model=schemas.BackupSettingsRead)
def get_backup_settings(db: Session = Depends(get_db)):
    return _to_read(_get_or_create(db))


@router.put("/settings", response_model=schemas.BackupSettingsRead)
def update_backup_settings(payload: schemas.BackupSettingsUpdate, db: Session = Depends(get_db)):
    obj = _get_or_create(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    backup_scheduler.apply_schedule(obj)
    return _to_read(obj)


@router.get("/list", response_model=list[schemas.BackupFileInfo])
def list_backups():
    return backup_utils.list_backups()


@router.post("/run", response_model=schemas.BackupFileInfo)
def run_backup_now(db: Session = Depends(get_db)):
    obj = _get_or_create(db)
    try:
        info = backup_utils.create_backup(retention_count=obj.retention_count)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    obj.last_run_at = info["created_at"]
    obj.last_run_status = "success"
    obj.last_run_message = f"Manual backup created: {info['filename']}"
    db.commit()
    return info


@router.get("/download/{filename}")
def download_backup(filename: str):
    try:
        path = backup_utils.resolve_backup_path(filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")
    return FileResponse(path, filename=filename, media_type="application/octet-stream")


@router.delete("/{filename}")
def delete_backup(filename: str):
    try:
        backup_utils.delete_backup(filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Backup file not found") from exc
    return {"ok": True}
