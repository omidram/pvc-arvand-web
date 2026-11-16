"""Scheduler for ARIAORMS log-sheet pulls + optional Excel watch-folder poll."""
import logging
import threading
from datetime import datetime, timedelta, timezone
from functools import partial

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from . import models, voltage_sync
from sqlalchemy.exc import OperationalError

from .database import SessionLocal, is_sqlite_lock

logger = logging.getLogger("pvc_arvand.voltage_sync")

DAILY_JOB_ID = "voltage_sync_daily_ariaorms"
# Later clocks pick up cells entered after the first pull (06:00, 10:00, 18:00 sheets).
FOLLOWUP_SLOTS = ((9, 0), (13, 0), (20, 0), (22, 0))
SHIFT_JOB_PREFIX = "shift_report_pull_"
DEFAULT_SHIFT_URL = "http://192.168.20.12:8080/ViewShiftReport.aspx"
DEFAULT_SHIFT_TIMES = "07:00,19:00"
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
        shift_report_enabled=True,
        shift_report_url=DEFAULT_SHIFT_URL,
        shift_report_times=DEFAULT_SHIFT_TIMES,
    )


def _pulled_recently(row: models.VoltageSyncSettings, *, minutes: int) -> bool:
    """A restart just after a successful pull must not download the same sheets again."""
    if row.last_run_status != "success" or row.last_run_at is None:
        return False
    stamp = row.last_run_at
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - stamp.astimezone(timezone.utc) < timedelta(minutes=minutes)


def _run_daily_pull() -> None:
    db = SessionLocal()
    try:
        row = db.query(models.VoltageSyncSettings).first()
        if not row or not row.enabled:
            return
        if _pulled_recently(row, minutes=50):
            logger.info("AriaORMS log-sheet pull skipped: a pull finished in the last 50 minutes")
            return
        result = voltage_sync.pull_from_ariaorms(db, row, include_today=True, scheduled=True)
        logger.info("AriaORMS log-sheet pull: %s", result.get("message"))
    except OperationalError as exc:
        if is_sqlite_lock(exc):
            logger.warning("AriaORMS daily pull deferred: database is busy")
        else:
            logger.exception("AriaORMS daily pull failed")
    except Exception:  # noqa: BLE001
        logger.exception("AriaORMS daily pull failed")
    finally:
        db.close()


def _run_shift_pull(kind: str) -> None:
    """Morning clock pulls yesterday's 12 شب. Evening clock pulls today's 12 صبح."""
    db = SessionLocal()
    try:
        row = db.query(models.VoltageSyncSettings).first()
        if not row or not row.shift_report_enabled:
            return
        result = voltage_sync.pull_shift_report(db, row, kind=kind)
        logger.info("AriaORMS shift report pull (%s): %s", kind, result.get("message"))
    except OperationalError as exc:
        if is_sqlite_lock(exc):
            logger.warning("Shift report pull deferred: database is busy")
        else:
            logger.exception("Shift report pull failed")
    except Exception:  # noqa: BLE001
        logger.exception("Shift report pull failed")
    finally:
        db.close()


def shift_times(value: str | None) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for part in (value or DEFAULT_SHIFT_TIMES).replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        hour, minute = _parse_hhmm(part)
        if (hour, minute) not in out:
            out.append((hour, minute))
    return out or [(7, 0), (19, 0)]


def _run_watch_cycle() -> None:
    db = SessionLocal()
    try:
        row = db.query(models.VoltageSyncSettings).first()
        if not row or not row.enabled:
            return
        # Watch folder remains a secondary path when Excel files are dropped manually.
        result = voltage_sync.scan_and_apply(db, row, record_run=False)
        if result.get("files_applied"):
            logger.info("Voltage watch sync: %s", result.get("message"))
    except OperationalError as exc:
        if is_sqlite_lock(exc):
            logger.warning("Voltage watch sync deferred: database is busy")
        else:
            logger.exception("Voltage sync watch cycle failed")
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
    for job in list(scheduler.get_jobs()):
        if job.id == WATCH_JOB_ID or job.id.startswith(SHIFT_JOB_PREFIX) or job.id.startswith("voltage_sync_daily"):
            scheduler.remove_job(job.id)

    # The shift report has its own switch: it does not depend on the log-sheet pull being enabled.
    if row and row.shift_report_enabled:
        slots = shift_times(row.shift_report_times)
        # First clock (07:00) is the night shift of the previous day. Second clock (19:00) is today's morning shift.
        kinds = ("night", "morning")
        for index, (hour, minute) in enumerate(slots[:2]):
            scheduler.add_job(
                partial(_run_shift_pull, kinds[index]),
                CronTrigger(hour=hour, minute=minute),
                id=f"{SHIFT_JOB_PREFIX}{hour:02d}{minute:02d}",
                replace_existing=True,
                misfire_grace_time=3600,
            )

    if not row or not row.enabled:
        return

    hour, minute = _parse_hhmm(row.daily_time)
    slots = [(hour, minute)]
    for slot in FOLLOWUP_SLOTS:
        if slot not in slots:
            slots.append(slot)
    for index, (slot_hour, slot_minute) in enumerate(slots):
        scheduler.add_job(
            _run_daily_pull,
            CronTrigger(hour=slot_hour, minute=slot_minute),
            id=DAILY_JOB_ID if index == 0 else f"voltage_sync_daily_{slot_hour:02d}{slot_minute:02d}",
            replace_existing=True,
            misfire_grace_time=3600,
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
    catch_up = False
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
            if not (row.shift_report_url or "").strip():
                row.shift_report_url = DEFAULT_SHIFT_URL
                changed = True
            if not (row.shift_report_times or "").strip():
                row.shift_report_times = DEFAULT_SHIFT_TIMES
                changed = True
            if row.shift_report_enabled is None:
                row.shift_report_enabled = True
                changed = True
            if changed:
                db.commit()
                db.refresh(row)
            voltage_sync.resolve_watch_dir(row.watch_dir)
        apply_schedule(row)
        if row.last_run_status == "running":
            row.last_run_status = "interrupted"
            row.last_run_message = "The pull stopped when the server restarted. The next start fetches yesterday and today."
            db.commit()
        catch_up = bool(row.enabled)
    finally:
        db.close()
    if catch_up:
        threading.Thread(target=_catch_up_if_stale, name="ariaorms-catchup", daemon=True).start()


def _catch_up_if_stale() -> None:
    """A sheet filled after the last pull, such as today's M2 cell voltages, is fetched on startup."""
    db = SessionLocal()
    try:
        row = db.query(models.VoltageSyncSettings).first()
        if not row or not row.enabled:
            return
        if _pulled_recently(row, minutes=90):
            logger.info("AriaORMS catch-up skipped: a pull finished in the last 90 minutes")
            return
        result = voltage_sync.pull_from_ariaorms(db, row, include_today=True, scheduled=True)
        logger.info("AriaORMS catch-up pull: %s", result.get("message"))
    except OperationalError as exc:
        if is_sqlite_lock(exc):
            logger.warning("AriaORMS catch-up deferred: database is busy")
        else:
            logger.exception("AriaORMS catch-up failed")
    except Exception:  # noqa: BLE001
        logger.exception("AriaORMS catch-up failed")
    finally:
        db.close()


def get_next_shift_run_at() -> str | None:
    scheduler = get_scheduler()
    times = [job.next_run_time for job in scheduler.get_jobs() if job.id.startswith(SHIFT_JOB_PREFIX) and job.next_run_time]
    return min(times).isoformat() if times else None


def get_next_run_at() -> str | None:
    scheduler = get_scheduler()
    times = [
        job.next_run_time
        for job in scheduler.get_jobs()
        if job.id.startswith("voltage_sync_daily") and job.next_run_time
    ]
    return min(times).isoformat() if times else None


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
