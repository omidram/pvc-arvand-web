"""Background scheduler that triggers automatic database backups on a
customizable schedule (time of day + selected days of the week)."""
import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from . import backup_utils
from .database import SessionLocal
from . import models

logger = logging.getLogger("pvc_arvand.backup")

JOB_ID = "auto_backup"
_scheduler: BackgroundScheduler | None = None


def get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        # Uses the server's local timezone so the configured "HH:MM" matches
        # the admin's wall-clock expectation (e.g. "run at 23:30 every day").
        _scheduler = BackgroundScheduler()
        _scheduler.start()
    return _scheduler


def _run_scheduled_backup() -> None:
    db = SessionLocal()
    try:
        row = db.query(models.BackupSettings).first()
        retention = row.retention_count if row else 14
        try:
            info = backup_utils.create_backup(retention_count=retention)
            if row:
                row.last_run_at = info["created_at"]
                row.last_run_status = "success"
                row.last_run_message = f"Backup created: {info['filename']}"
                db.commit()
            logger.info("Automatic backup created: %s", info["filename"])
        except Exception as exc:  # noqa: BLE001
            logger.exception("Automatic backup failed")
            if row:
                row.last_run_at = datetime.utcnow()
                row.last_run_status = "error"
                row.last_run_message = str(exc)
                db.commit()
    finally:
        db.close()


def apply_schedule(row: "models.BackupSettings") -> None:
    """Reconfigures (or removes) the recurring backup job based on the given settings row."""
    scheduler = get_scheduler()
    existing = scheduler.get_job(JOB_ID)
    if existing:
        scheduler.remove_job(JOB_ID)

    if not row or not row.enabled:
        return

    try:
        hour, minute = row.time.split(":")
        hour, minute = int(hour), int(minute)
    except (ValueError, AttributeError):
        hour, minute = 2, 0

    days = row.days_of_week or "mon,tue,wed,thu,fri,sat,sun"
    trigger = CronTrigger(day_of_week=days, hour=hour, minute=minute)
    scheduler.add_job(_run_scheduled_backup, trigger=trigger, id=JOB_ID, replace_existing=True)


def init_scheduler_from_db() -> None:
    """Called once at application startup to load the persisted schedule."""
    db = SessionLocal()
    try:
        row = db.query(models.BackupSettings).first()
        if row is None:
            row = models.BackupSettings()
            db.add(row)
            db.commit()
            db.refresh(row)
        apply_schedule(row)
    finally:
        db.close()


def get_next_run_at() -> str | None:
    scheduler = get_scheduler()
    job = scheduler.get_job(JOB_ID)
    if job and job.next_run_time:
        return job.next_run_time.isoformat()
    return None


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
