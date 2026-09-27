"""Interval poller for ARIAORMS Excel → voltage sync watch folder."""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from . import models, voltage_sync
from .database import SessionLocal

logger = logging.getLogger("pvc_arvand.voltage_sync")

JOB_ID = "voltage_sync_watch"
_scheduler: BackgroundScheduler | None = None


def get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler()
        _scheduler.start()
    return _scheduler


def _run_watch_cycle() -> None:
    db = SessionLocal()
    try:
        row = db.query(models.VoltageSyncSettings).first()
        if not row or not row.enabled:
            return
        result = voltage_sync.scan_and_apply(db, row)
        if result.get("files_applied"):
            logger.info("Voltage sync: %s", result.get("message"))
    except Exception:  # noqa: BLE001
        logger.exception("Voltage sync watch cycle failed")
    finally:
        db.close()


def apply_schedule(row: "models.VoltageSyncSettings") -> None:
    scheduler = get_scheduler()
    existing = scheduler.get_job(JOB_ID)
    if existing:
        scheduler.remove_job(JOB_ID)

    if not row or not row.enabled:
        return

    seconds = max(5, int(row.poll_seconds or 30))
    trigger = IntervalTrigger(seconds=seconds)
    scheduler.add_job(_run_watch_cycle, trigger=trigger, id=JOB_ID, replace_existing=True)


def init_scheduler_from_db() -> None:
    db = SessionLocal()
    try:
        row = db.query(models.VoltageSyncSettings).first()
        if row is None:
            row = models.VoltageSyncSettings(
                watch_dir=str(voltage_sync.default_watch_dir()),
                source_url="http://192.168.20.12:8080/LogSheetsReports.aspx",
            )
            db.add(row)
            db.commit()
            db.refresh(row)
        else:
            # Ensure default folder exists even when disabled
            voltage_sync.resolve_watch_dir(row.watch_dir)
        apply_schedule(row)
    finally:
        db.close()


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
