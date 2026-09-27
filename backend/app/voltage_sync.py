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

from sqlalchemy.orm import Session

from . import models
from .config import DATA_DIR
from .plant_import import parse_voltage_excel

logger = logging.getLogger("pvc_arvand.voltage_sync")

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


def apply_parsed_voltage(
    db: Session,
    parsed: dict[str, Any],
    *,
    electrolyzer: str | None = None,
    reading_date: str | None = None,
) -> dict[str, Any]:
    """Upsert parsed ARIAORMS/SiteMan readings by electrolyzer+date+time+position."""
    if parsed.get("error"):
        raise ValueError(parsed["error"])

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

    times_in_file = {item.get("time") for item in (parsed.get("readings") or []) if item.get("time")}
    times_in_file |= set((parsed.get("totals") or {}).keys())

    upserted = 0
    for item in parsed.get("readings") or []:
        item_el = (item.get("electrolyzer") or el).strip().upper()
        pos = str(item.get("position") or "").strip()
        tlabel = item.get("time")
        voltage = item.get("voltage")
        if not pos or not tlabel or voltage is None:
            continue

        existing = (
            db.query(models.VoltageReading)
            .filter(
                models.VoltageReading.electrolyzer == item_el,
                models.VoltageReading.date == date_val,
                models.VoltageReading.time == tlabel,
                models.VoltageReading.position == pos,
            )
            .first()
        )
        if existing:
            existing.voltage = float(voltage)
            existing.element_nr = item.get("element_nr") or existing.element_nr
        else:
            db.add(
                models.VoltageReading(
                    electrolyzer=item_el,
                    position=pos,
                    element_nr=item.get("element_nr"),
                    date=date_val,
                    time=tlabel,
                    voltage=float(voltage),
                )
            )
        upserted += 1

    # Per time-slot normalization header from totals
    totals = parsed.get("totals") or {}
    counts_by_time: dict[str, int] = {}
    for item in parsed.get("readings") or []:
        t = item.get("time")
        if t:
            counts_by_time[t] = counts_by_time.get(t, 0) + 1

    for tlabel, tvals in totals.items():
        total_v = tvals.get("total")
        if total_v is None and tvals.get("rack_a") is not None and tvals.get("rack_b") is not None:
            total_v = float(tvals["rack_a"]) + float(tvals["rack_b"])
        if total_v is None:
            continue
        existing_n = (
            db.query(models.ElectrolyzerNormalization)
            .filter(
                models.ElectrolyzerNormalization.electrolyzer == el,
                models.ElectrolyzerNormalization.date == date_val,
                models.ElectrolyzerNormalization.time == tlabel,
            )
            .first()
        )
        if existing_n:
            existing_n.total_voltage = float(total_v)
            existing_n.element_count = counts_by_time.get(tlabel) or existing_n.element_count
            if tvals.get("anolyte_temp") is not None:
                existing_n.anolyte_temp = tvals.get("anolyte_temp")
            if tvals.get("catholyte_temp") is not None:
                existing_n.catholyte_temp = tvals.get("catholyte_temp")
            if tvals.get("load") is not None:
                existing_n.total_current = tvals.get("load")
        else:
            db.add(
                models.ElectrolyzerNormalization(
                    electrolyzer=el,
                    date=date_val,
                    time=tlabel,
                    total_voltage=float(total_v),
                    element_count=counts_by_time.get(tlabel),
                    anolyte_temp=tvals.get("anolyte_temp"),
                    catholyte_temp=tvals.get("catholyte_temp"),
                    total_current=tvals.get("load"),
                )
            )

    db.flush()
    return {
        "electrolyzer": el,
        "reading_date": date_val.date().isoformat(),
        "times": sorted(t for t in times_in_file if t),
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
) -> dict[str, Any]:
    parsed = parse_voltage_excel(content)
    el = electrolyzer
    if not el and hint_from_name:
        m = _EL_FROM_NAME.search(hint_from_name)
        if m:
            el = m.group("el").upper()
    return apply_parsed_voltage(db, parsed, electrolyzer=el, reading_date=reading_date)


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
