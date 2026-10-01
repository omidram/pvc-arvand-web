"""Scheduler for ARIAORMS daily pull + optional Excel watch-folder poll."""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from . import models, voltage_sync
from .database import SessionLocal

logger = logging.getLogger("pvc_arvand.voltage_sync")

DAILY_JOB_ID = "voltage_sync_daily_ariaorms"
WATCH_JOB_ID = "voltage_sync_watch"
_scheduler: BackgroundScheduler | None = None

DEFAULT_USERNAME = "588955"
DEFAULT_PASSWORD = "588955"
DEFAULT_SOURCE = "http://192.168.20.12:8080/LogSheetsReports.aspx"


def get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        # Local timezone so "00:00" matches plant wall clock.
        _scheduler = BackgroundScheduler()
        _scheduler.start()
    return _scheduler


def _default_settings() -> models.VoltageSyncSettings:
    return models.VoltageSyncSettings(
        watch_dir=str(voltage_sync.default_watch_dir()),
        source_url=DEFAULT_SOURCE,
        username=DEFAULT_USERNAME,
        password=DEFAULT_PASSWORD,
        daily_time="00:00",
        lookback_days=7,
    )


def _run_daily_pull() -> None:
    db = SessionLocal()
    try:
        row = db.query(models.VoltageSyncSettings).first()
        if not row or not row.enabled:
            return
        result = voltage_sync.pull_from_ariaorms(db, row, include_today=False)
        logger.info("AriaORMS daily pull: %s", result.get("message"))
    except Exception:  # noqa: BLE001
        logger.exception("AriaORMS daily pull failed")
    finally:
        db.close()


def _run_watch_cycle() -> None:
    db = SessionLocal()
    try:
        row = db.query(models.VoltageSyncSettings).first()
        if not row or not row.enabled:
            return
        # Watch folder remains a secondary path when Excel files are dropped manually.
        result = voltage_sync.scan_and_apply(db, row)
        if result.get("files_applied"):
            logger.info("Voltage watch sync: %s", result.get("message"))
    except Exception:  # noqa: BLE001
        logger.exception("Voltage sync watch cycle failed")
    finally:
        db.close()


def _parse_hhmm(value: str | None) -> tuple[int, int]:
    try:
        hour_s, minute_s = (value or "00:00").split(":")
        return int(hour_s), int(minute_s)
    except (ValueError, AttributeError):
        return 0, 0


def apply_schedule(row: "models.VoltageSyncSettings") -> None:
    scheduler = get_scheduler()
    for job_id in (DAILY_JOB_ID, WATCH_JOB_ID):
        existing = scheduler.get_job(job_id)
        if existing:
            scheduler.remove_job(job_id)

    if not row or not row.enabled:
        return

    hour, minute = _parse_hhmm(row.daily_time)
    scheduler.add_job(
        _run_daily_pull,
        CronTrigger(hour=hour, minute=minute),
        id=DAILY_JOB_ID,
        replace_existing=True,
    )

    # Optional folder poll (manual Excel drops). Keep a gentle interval.
    seconds = max(30, int(row.poll_seconds or 30))
    scheduler.add_job(
        _run_watch_cycle,
        IntervalTrigger(seconds=seconds),
        id=WATCH_JOB_ID,
        replace_existing=True,
    )


def init_scheduler_from_db() -> None:
    db = SessionLocal()
    try:
        row = db.query(models.VoltageSyncSettings).first()
        if row is None:
            row = _default_settings()
            db.add(row)
            db.commit()
            db.refresh(row)
        else:
            changed = False
            if not (row.username or "").strip():
                row.username = DEFAULT_USERNAME
                changed = True
            if not (row.password or "").strip():
                row.password = DEFAULT_PASSWORD
                changed = True
            if not (row.daily_time or "").strip():
                row.daily_time = "00:00"
                changed = True
            if not row.lookback_days or int(row.lookback_days) < 1:
                row.lookback_days = 7
                changed = True
            if not row.source_url:
                row.source_url = DEFAULT_SOURCE
                changed = True
            if changed:
                db.commit()
                db.refresh(row)
            voltage_sync.resolve_watch_dir(row.watch_dir)
        apply_schedule(row)
    finally:
        db.close()


def get_next_run_at() -> str | None:
    scheduler = get_scheduler()
    job = scheduler.get_job(DAILY_JOB_ID)
    if job and job.next_run_time:
        return job.next_run_time.isoformat()
    return None


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
