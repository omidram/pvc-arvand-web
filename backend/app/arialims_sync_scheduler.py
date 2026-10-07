"""Daily AriaLims pull scheduler (armed when enabled; pull stays gated until API contract)."""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from . import arialims_sync, models
from .database import SessionLocal

logger = logging.getLogger("pvc_arvand.arialims")

DAILY_JOB_ID = "arialims_sync_daily"
_scheduler: BackgroundScheduler | None = None


def get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler()
        _scheduler.start()
    return _scheduler


def _parse_hhmm(value: str | None) -> tuple[int, int]:
    try:
        hour_s, minute_s = (value or "01:00").split(":")
        return int(hour_s), int(minute_s)
    except (ValueError, AttributeError):
        return 1, 0


def _run_daily_pull() -> None:
    db = SessionLocal()
    try:
        row = db.query(models.AriaLimsSyncSettings).first()
        if not row or not row.enabled:
            return
        result = arialims_sync.pull_from_arialims(db, row, include_today=False)
        logger.info("AriaLims daily pull: %s", result.get("message"))
    except Exception:  # noqa: BLE001
        logger.exception("AriaLims daily pull failed")
    finally:
        db.close()


def apply_schedule(row: "models.AriaLimsSyncSettings") -> None:
    scheduler = get_scheduler()
    existing = scheduler.get_job(DAILY_JOB_ID)
    if existing:
        scheduler.remove_job(DAILY_JOB_ID)

    if not row or not row.enabled:
        return

    hour, minute = _parse_hhmm(row.daily_time)
    scheduler.add_job(
        _run_daily_pull,
        CronTrigger(hour=hour, minute=minute),
        id=DAILY_JOB_ID,
        replace_existing=True,
    )


def get_next_run_at() -> str | None:
    scheduler = get_scheduler()
    job = scheduler.get_job(DAILY_JOB_ID)
    if not job or not job.next_run_time:
        return None
    return job.next_run_time.isoformat()


def init_scheduler_from_db() -> None:
    db = SessionLocal()
    try:
        row = arialims_sync.get_or_create_settings(db)
        apply_schedule(row)
    finally:
        db.close()


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
