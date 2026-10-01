"""ARIAORMS LogSheets Excel → Standardized Voltage sync.

ARIAORMS (http://…/LogSheetsReports.aspx) exports per-electrolyzer voltage
log sheets as Excel. On the Ubuntu plant server those files are dropped into
a watched folder; this module upserts them into VoltageReading /
ElectrolyzerNormalization keyed by electrolyzer + date + time + position.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models
from .config import DATA_DIR
from .plant_import import parse_voltage_excel

logger = logging.getLogger("pvc_arvand.voltage_sync")
_voltage_indexes_ready = False

DEFAULT_WATCH_SUBDIR = "ariaorms_exports"
_EXCEL_SUFFIXES = {".xlsx", ".xls", ".xlsm"}
_EL_FROM_NAME = re.compile(r"(?:ELECTROLYZER|EL)[_\s\-]*(?P<el>[A-Za-z]+\d*)", re.I)


def default_watch_dir() -> Path:
    path = DATA_DIR / DEFAULT_WATCH_SUBDIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_watch_dir(configured: str | None) -> Path:
    if configured and configured.strip():
        path = Path(configured.strip())
        path.mkdir(parents=True, exist_ok=True)
        return path
    return default_watch_dir()


def _file_fingerprint(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "mtime": int(stat.st_mtime),
        "size": int(stat.st_size),
        "sha1": hashlib.sha1(path.read_bytes()).hexdigest()[:16],
    }


def _load_state(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _save_state(db: Session, row: models.VoltageSyncSettings, state: dict[str, Any]) -> None:
    row.processed_state = json.dumps(state, ensure_ascii=False)
    db.add(row)


def ensure_voltage_indexes(db: Session) -> None:
    """One row per electrolyzer + position + day + time, so history imports can upsert."""
    conn = db.connection()
    conn.execute(
        text(
            """
            DELETE FROM voltage_readings
            WHERE id NOT IN (
                SELECT MAX(id) FROM voltage_readings
                GROUP BY electrolyzer, position, date, time
            )
            """
        )
    )
    conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_voltage_slot "
            "ON voltage_readings (electrolyzer, position, date, time)"
        )
    )
    conn.execute(
        text(
            """
            DELETE FROM electrolyzer_normalizations
            WHERE id NOT IN (
                SELECT MAX(id) FROM electrolyzer_normalizations
                GROUP BY electrolyzer, date, time
            )
            """
        )
    )
    conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_norm_slot "
            "ON electrolyzer_normalizations (electrolyzer, date, time)"
        )
    )
    db.commit()


def _as_midnight(value: str | datetime | None, fallback: datetime) -> str:
    if isinstance(value, datetime):
        day = value
    elif isinstance(value, str) and value.strip():
        day = datetime.fromisoformat(value.strip()[:10])
    else:
        day = fallback
    return datetime(day.year, day.month, day.day).strftime("%Y-%m-%d %H:%M:%S")


def _bulk_upsert_readings(db: Session, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    stmt = text(
        """
        INSERT INTO voltage_readings (electrolyzer, position, element_nr, date, time, voltage)
        VALUES (:electrolyzer, :position, :element_nr, :date, :time, :voltage)
        ON CONFLICT(electrolyzer, position, date, time) DO UPDATE SET
            voltage = excluded.voltage,
            element_nr = COALESCE(excluded.element_nr, voltage_readings.element_nr)
        """
    )
    conn = db.connection()
    for start in range(0, len(rows), 800):
        conn.execute(stmt, rows[start : start + 800])
    return len(rows)


def _bulk_upsert_totals(db: Session, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    stmt = text(
        """
        INSERT INTO electrolyzer_normalizations (
            electrolyzer, date, time, total_voltage, element_count,
            anolyte_temp, catholyte_temp, total_current, rack_a_avg, rack_b_avg, catholyte_conc
        )
        VALUES (
            :electrolyzer, :date, :time, :total_voltage, :element_count,
            :anolyte_temp, :catholyte_temp, :total_current, :rack_a_avg, :rack_b_avg, :catholyte_conc
        )
        ON CONFLICT(electrolyzer, date, time) DO UPDATE SET
            total_voltage = COALESCE(excluded.total_voltage, electrolyzer_normalizations.total_voltage),
            element_count = COALESCE(excluded.element_count, electrolyzer_normalizations.element_count),
            anolyte_temp = COALESCE(excluded.anolyte_temp, electrolyzer_normalizations.anolyte_temp),
            catholyte_temp = COALESCE(excluded.catholyte_temp, electrolyzer_normalizations.catholyte_temp),
            total_current = COALESCE(excluded.total_current, electrolyzer_normalizations.total_current),
            rack_a_avg = COALESCE(excluded.rack_a_avg, electrolyzer_normalizations.rack_a_avg),
            rack_b_avg = COALESCE(excluded.rack_b_avg, electrolyzer_normalizations.rack_b_avg),
            catholyte_conc = COALESCE(excluded.catholyte_conc, electrolyzer_normalizations.catholyte_conc)
        """
    )
    db.connection().execute(stmt, rows)


def apply_parsed_voltage(
    db: Session,
    parsed: dict[str, Any],
    *,
    electrolyzer: str | None = None,
    reading_date: str | None = None,
    progress=None,
    evaluate_alerts: bool = True,
) -> dict[str, Any]:
    """Upsert parsed ARIAORMS/SiteMan readings by electrolyzer+date+time+position."""
    if parsed.get("error"):
        raise ValueError(parsed["error"])

    global _voltage_indexes_ready
    if not _voltage_indexes_ready:
        ensure_voltage_indexes(db)
        _voltage_indexes_ready = True

    el = (electrolyzer or parsed.get("electrolyzer") or "").strip().upper()
    if not el:
        raise ValueError("Could not detect electrolyzer; pass electrolyzer explicitly")

    if reading_date:
        date_val = datetime.fromisoformat(reading_date)
    elif parsed.get("reading_date"):
        date_val = datetime.fromisoformat(parsed["reading_date"])
    else:
        raise ValueError("Could not detect reading date; pass reading_date=YYYY-MM-DD")

    # Normalize to midnight datetime for consistent matching
    date_val = datetime(date_val.year, date_val.month, date_val.day)

    readings = parsed.get("readings") or []
    row_payload: list[dict[str, Any]] = []
    counts: dict[tuple[str, str], int] = {}
    times_in_file: set[str] = set()
    dates_in_file: set[str] = set()
    total = len(readings)
    if progress:
        progress(0, total)
    for done, item in enumerate(readings, start=1):
        item_el = (item.get("electrolyzer") or el).strip().upper()
        pos = str(item.get("position") or "").strip()
        tlabel = item.get("time")
        voltage = item.get("voltage")
        if not pos or not tlabel or voltage is None:
            continue
        stamp = _as_midnight(item.get("date"), date_val)
        row_payload.append(
            {
                "electrolyzer": item_el,
                "position": pos,
                "element_nr": item.get("element_nr"),
                "date": stamp,
                "time": tlabel,
                "voltage": float(voltage),
            }
        )
        counts[(stamp, tlabel)] = counts.get((stamp, tlabel), 0) + 1
        times_in_file.add(tlabel)
        dates_in_file.add(stamp[:10])
        if progress and (done == total or done % 400 == 0):
            progress(done, total)

    upserted = _bulk_upsert_readings(db, row_payload)

    slots = parsed.get("total_slots") or []
    if not slots:
        for tlabel, tvals in (parsed.get("totals") or {}).items():
            slots.append({"date": date_val.date().isoformat(), "time": tlabel, **tvals})
    norm_rows: list[dict[str, Any]] = []
    for slot in slots:
        tlabel = slot.get("time")
        if not tlabel:
            continue
        total_v = slot.get("total")
        if total_v is None and slot.get("rack_a") is not None and slot.get("rack_b") is not None:
            total_v = float(slot["rack_a"]) + float(slot["rack_b"])
        if total_v is None and slot.get("anolyte_temp") is None and slot.get("load") is None and slot.get("rack_a_avg") is None:
            continue
        stamp = _as_midnight(slot.get("date"), date_val)
        times_in_file.add(tlabel)
        dates_in_file.add(stamp[:10])
        norm_rows.append(
            {
                "electrolyzer": el,
                "date": stamp,
                "time": tlabel,
                "total_voltage": float(total_v) if total_v is not None else None,
                "element_count": counts.get((stamp, tlabel)),
                "anolyte_temp": slot.get("anolyte_temp"),
                "catholyte_temp": slot.get("catholyte_temp"),
                "total_current": slot.get("load"),
                "rack_a_avg": slot.get("rack_a_avg"),
                "rack_b_avg": slot.get("rack_b_avg"),
                "catholyte_conc": slot.get("catholyte_conc"),
            }
        )
    _bulk_upsert_totals(db, norm_rows)
    db.flush()

    if evaluate_alerts:
        try:
            from . import alerts_engine

            alerts_engine.ensure_default_rules(db)
            alerts_engine.evaluate_voltage_rules(db)
        except Exception:  # noqa: BLE001
            logger.exception("Alert evaluation after voltage import failed")

    return {
        "electrolyzer": el,
        "reading_date": date_val.date().isoformat(),
        "dates": sorted(dates_in_file),
        "times": sorted(times_in_file),
        "rows_upserted": upserted,
        "out_of_range_count": len(parsed.get("out_of_range") or []),
        "operators": parsed.get("operators") or [],
        "sheet": parsed.get("sheet"),
    }


def apply_excel_bytes(
    db: Session,
    content: bytes,
    *,
    electrolyzer: str | None = None,
    reading_date: str | None = None,
    hint_from_name: str | None = None,
    progress=None,
    evaluate_alerts: bool = True,
) -> dict[str, Any]:
    parsed = parse_voltage_excel(content)
    el = electrolyzer
    if not el and hint_from_name:
        m = _EL_FROM_NAME.search(hint_from_name)
        if m:
            el = m.group("el").upper()
    return apply_parsed_voltage(
        db,
        parsed,
        electrolyzer=el,
        reading_date=reading_date,
        progress=progress,
        evaluate_alerts=evaluate_alerts,
    )


def scan_and_apply(db: Session, row: models.VoltageSyncSettings | None = None) -> dict[str, Any]:
    """Scan watch folder; apply new/changed Excel files; update settings status."""
    if row is None:
        row = db.query(models.VoltageSyncSettings).first()
        if row is None:
            row = models.VoltageSyncSettings()
            db.add(row)
            db.commit()
            db.refresh(row)

    watch = resolve_watch_dir(row.watch_dir)
    state = _load_state(row.processed_state)
    details: list[dict[str, Any]] = []
    files_applied = 0
    rows_total = 0
    scanned = 0

    try:
        files = sorted(
            p for p in watch.iterdir() if p.is_file() and p.suffix.lower() in _EXCEL_SUFFIXES
        )
    except OSError as exc:
        msg = f"Cannot read watch folder {watch}: {exc}"
        row.last_run_at = datetime.utcnow()
        row.last_run_status = "error"
        row.last_run_message = msg[:500]
        db.commit()
        return {
            "ok": False,
            "files_scanned": 0,
            "files_applied": 0,
            "rows_upserted": 0,
            "message": msg,
            "details": [],
        }

    for path in files:
        scanned += 1
        rel = path.name
        try:
            fp = _file_fingerprint(path)
        except OSError as exc:
            details.append({"file": rel, "status": "error", "message": str(exc)})
            continue
        prev = state.get(rel)
        if prev and prev.get("mtime") == fp["mtime"] and prev.get("size") == fp["size"] and prev.get("sha1") == fp.get("sha1"):
            details.append({"file": rel, "status": "skipped", "message": "unchanged"})
            continue
        try:
            result = apply_excel_bytes(db, path.read_bytes(), hint_from_name=path.stem)
            db.commit()
            state[rel] = fp
            files_applied += 1
            rows_total += int(result.get("rows_upserted") or 0)
            details.append(
                {
                    "file": rel,
                    "status": "applied",
                    "electrolyzer": result.get("electrolyzer"),
                    "reading_date": result.get("reading_date"),
                    "times": result.get("times"),
                    "rows_upserted": result.get("rows_upserted"),
                }
            )
            logger.info(
                "ARIAORMS sync applied %s → %s %s (%s rows)",
                rel,
                result.get("electrolyzer"),
                result.get("reading_date"),
                result.get("rows_upserted"),
            )
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.exception("Failed to sync %s", path)
            details.append({"file": rel, "status": "error", "message": str(exc)})

    _save_state(db, row, state)
    row.last_run_at = datetime.utcnow()
    if any(d.get("status") == "error" for d in details) and files_applied == 0 and scanned > 0:
        row.last_run_status = "error"
        err = next(d for d in details if d.get("status") == "error")
        row.last_run_message = f"{err.get('file')}: {err.get('message')}"[:500]
        ok = False
        message = row.last_run_message or "Sync errors"
    else:
        row.last_run_status = "success"
        message = f"Scanned {scanned}, applied {files_applied}, upserted {rows_total} rows"
        row.last_run_message = message[:500]
        ok = True
    db.commit()

    return {
        "ok": ok,
        "files_scanned": scanned,
        "files_applied": files_applied,
        "rows_upserted": rows_total,
        "message": message,
        "details": details,
        "watch_dir": str(watch),
    }


def count_watched_files(configured: str | None) -> int:
    watch = resolve_watch_dir(configured)
    try:
        return sum(1 for p in watch.iterdir() if p.is_file() and p.suffix.lower() in _EXCEL_SUFFIXES)
    except OSError:
        return 0


def pull_from_ariaorms(
    db: Session,
    row: models.VoltageSyncSettings | None = None,
    *,
    include_today: bool = False,
    progress=None,
) -> dict[str, Any]:
    """Login to AriaORMS and upsert full log sheets for every electrolyzer."""
    from . import ariaorms_client

    if row is None:
        row = db.query(models.VoltageSyncSettings).first()
        if row is None:
            row = models.VoltageSyncSettings()
            db.add(row)
            db.commit()
            db.refresh(row)

    username = (row.username or "").strip()
    password = row.password or ""
    if not username or not password:
        msg = "AriaORMS username/password are not configured in Settings → Data Sync"
        row.last_run_at = datetime.utcnow()
        row.last_run_status = "error"
        row.last_run_message = msg[:500]
        db.commit()
        return {
            "ok": False,
            "mode": "ariaorms",
            "files_scanned": 0,
            "files_applied": 0,
            "rows_upserted": 0,
            "message": msg,
            "details": [],
        }

    base = ariaorms_client.normalize_base_url(row.source_url)
    start_day, end_day = ariaorms_client.date_window(
        lookback_days=int(row.lookback_days or 1),
        include_today=include_today,
    )
    electrolyzers = ariaorms_client.iter_electrolyzers()
    details: list[dict[str, Any]] = []
    files_applied = 0
    rows_total = 0
    errors = 0

    try:
        opener = ariaorms_client.new_opener(base, username, password)
    except Exception as exc:  # noqa: BLE001
        msg = f"AriaORMS login failed: {exc}"
        row.last_run_at = datetime.utcnow()
        row.last_run_status = "error"
        row.last_run_message = msg[:500]
        db.commit()
        return {
            "ok": False,
            "mode": "ariaorms",
            "files_scanned": 0,
            "files_applied": 0,
            "rows_upserted": 0,
            "message": msg,
            "details": [],
        }

    total = len(electrolyzers)
    if progress:
        progress(0, total)

    for index, (name, log_id) in enumerate(electrolyzers, start=1):
        try:
            content = ariaorms_client.download_logsheet(
                opener,
                base,
                log_id,
                start_day,
                end_day,
                username=username,
                password=password,
            )
            info = apply_excel_bytes(
                db,
                content,
                electrolyzer=name,
                hint_from_name=name,
                evaluate_alerts=False,
            )
            db.commit()
            files_applied += 1
            rows_total += int(info.get("rows_upserted") or 0)
            details.append(
                {
                    "electrolyzer": name,
                    "status": "applied",
                    "start": start_day.isoformat(),
                    "end": end_day.isoformat(),
                    "rows_upserted": info.get("rows_upserted"),
                    "dates": info.get("dates"),
                    "times": info.get("times"),
                }
            )
            logger.info(
                "AriaORMS pull %s %s..%s → %s rows",
                name,
                start_day,
                end_day,
                info.get("rows_upserted"),
            )
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            message = str(exc)
            if "Header row with Parameter" in message:
                details.append(
                    {
                        "electrolyzer": name,
                        "status": "empty",
                        "start": start_day.isoformat(),
                        "end": end_day.isoformat(),
                        "message": "empty sheet",
                    }
                )
            else:
                errors += 1
                logger.exception("AriaORMS pull failed for %s", name)
                details.append(
                    {
                        "electrolyzer": name,
                        "status": "error",
                        "start": start_day.isoformat(),
                        "end": end_day.isoformat(),
                        "message": message[:300],
                    }
                )
        if progress:
            progress(index, total)

    try:
        from . import alerts_engine

        alerts_engine.ensure_default_rules(db)
        alerts_engine.evaluate_voltage_rules(db)
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Alert evaluation after AriaORMS pull failed")

    ok = errors == 0
    message = (
        f"AriaORMS {start_day.isoformat()}..{end_day.isoformat()}: "
        f"electrolyzers {files_applied}/{total}, upserted {rows_total} rows"
        + (f", errors {errors}" if errors else "")
    )
    row.last_run_at = datetime.utcnow()
    row.last_run_status = "success" if ok else "error"
    row.last_run_message = message[:500]
    db.commit()

    return {
        "ok": ok,
        "mode": "ariaorms",
        "files_scanned": total,
        "files_applied": files_applied,
        "rows_upserted": rows_total,
        "message": message,
        "details": details,
    }
