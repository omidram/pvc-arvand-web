"""Load the plant monthly trip workbook (one sheet per Shamsi month) into shutdowns."""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from . import models
from .plant_import import jalali_to_gregorian
from .plant_topology import format_electrolyzer_name
from .routers.shutdowns import _apply_trip_metrics

_DATE = re.compile(r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})")


def _plant_part(value) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text or text in {"-", "—"}:
        return None
    folded = text.replace(" ", "").replace("‌", "").casefold()
    if folded in {"cellroom2", "train2", "trainii"} or "تریندو" in folded or folded.endswith("room2"):
        return "Train2"
    if folded in {"cellroom1", "train1"} or folded.endswith("room1"):
        return "Train1"
    name = format_electrolyzer_name(text)
    return name or text[:50]


def _clock(value) -> time | None:
    """Hour and minute from a log sheet. Excel stores a clock as a fraction of a day, a time, or 1899-12-30."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return time(value.hour, value.minute, value.second)
    if isinstance(value, time):
        return time(value.hour, value.minute, value.second)
    if isinstance(value, timedelta):
        seconds = int(value.total_seconds())
        if seconds < 0 or seconds >= 24 * 3600:
            return None
        return time(seconds // 3600, (seconds % 3600) // 60, seconds % 60)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if number == int(number) and 0 <= number <= 23:
            return time(int(number), 0)
        minutes = int(round((number % 1) * 24 * 60)) % (24 * 60)
        return time(minutes // 60, minutes % 60)
    text = str(value).strip()
    match = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?", text)
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    second = int(match.group(3) or 0)
    if hour > 23 or minute > 59 or second > 59:
        return None
    return time(hour, minute, second)


def _day(value) -> date | None:
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        if value.year > 1700:
            return value
        return jalali_to_gregorian(value.year, value.month, value.day)
    text = str(value or "").strip()
    match = _DATE.match(text)
    if not match:
        return None
    year, month, day = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    if year > 1700:
        return date(year, month, day)
    return jalali_to_gregorian(year, month, day)


def _stamp(day_value, clock_value) -> datetime | None:
    day = _day(day_value)
    if day is None:
        return None
    clock = _clock(clock_value) if clock_value not in (None, "") else time(0, 0)
    if clock is None:
        clock = time(0, 0)
    return datetime(day.year, day.month, day.day, clock.hour, clock.minute, clock.second)


def _number(value) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text in {"-", "—"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _text(value) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text or None


def import_monthly_trip_workbook(db: Session, path: str | Path) -> dict:
    """Insert trip rows. A row already stored for the same plant part and trip time is filled, not duplicated."""
    book = load_workbook(Path(path), data_only=True)
    existing = {
        ((row.plant_part or "").strip(), row.shutdown_time): row
        for row in db.query(models.Shutdown).all()
        if row.shutdown_time
    }
    known_causes = {(c.cause or "").strip().casefold() for c in db.query(models.ShutdownCause).all() if c.cause}
    created = 0
    updated = 0
    skipped = 0
    touched: list[models.Shutdown] = []

    for sheet in book.worksheets:
        header_at = None
        for index, row in enumerate(sheet.iter_rows(max_row=8, values_only=True)):
            labels = [str(cell or "").strip() for cell in row]
            if "تاریخ تریپ" in labels and "تجهیز" in labels:
                header_at = index
                headers = labels
                break
        if header_at is None:
            continue
        col = {name: pos for pos, name in enumerate(headers) if name}

        def cell(row, name):
            pos = col.get(name)
            if pos is None or pos >= len(row):
                return None
            return row[pos]

        for row in sheet.iter_rows(min_row=header_at + 2, values_only=True):
            part = _plant_part(cell(row, "تجهیز"))
            started = _stamp(cell(row, "تاریخ تریپ"), cell(row, "ساعت تریپ"))
            if not part or not started:
                skipped += 1
                continue
            ended = _stamp(cell(row, "تاریخ در سرویس قرار دادن"), cell(row, "ساعت در سرویس قرار دادن"))
            if ended is not None and ended < started:
                ended = None
            subject = _text(cell(row, "موضوع"))
            cause = _text(cell(row, "علت"))
            note = _text(cell(row, "توضیحات"))
            remarks = "\n".join(piece for piece in (subject, note) if piece) or None
            before = _number(cell(row, "آمپر قبل از تریپ (KA)"))
            after = _number(cell(row, "آمپر بعد از تریپ (KA)"))
            current = existing.get((part, started))
            if current is None:
                current = models.Shutdown(
                    plant_part=part,
                    shutdown_time=started,
                    startup_time=ended,
                    cause=cause,
                    remarks=remarks,
                    ka_before_trip=before,
                    ka_after_trip=after,
                )
                db.add(current)
                existing[(part, started)] = current
                created += 1
            else:
                changed = False
                if ended and not current.startup_time:
                    current.startup_time = ended
                    changed = True
                if cause and not (current.cause or "").strip():
                    current.cause = cause
                    changed = True
                if remarks and not (current.remarks or "").strip():
                    current.remarks = remarks
                    changed = True
                if before is not None and current.ka_before_trip is None:
                    current.ka_before_trip = before
                    changed = True
                if after is not None and current.ka_after_trip is None:
                    current.ka_after_trip = after
                    changed = True
                if changed:
                    updated += 1
                else:
                    skipped += 1
                    continue
            if cause and cause.casefold() not in known_causes:
                db.add(models.ShutdownCause(cause=cause, language_id=2))
                known_causes.add(cause.casefold())
            touched.append(current)

    db.flush()
    for row in sorted(touched, key=lambda item: item.shutdown_time or datetime.min):
        _apply_trip_metrics(db, row)
    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "causes": len(known_causes)}


def _open_workbook(source: str | Path | bytes):
    if isinstance(source, (bytes, bytearray)):
        return load_workbook(BytesIO(source), data_only=True)
    return load_workbook(Path(source), data_only=True)


def _train_columns(headers: list) -> dict[str, int] | None:
    """Train | Date | Shut Down | Date | Start | Duration | Cause. The two Date columns are not interchangeable."""
    labels = [str(cell or "").strip().lower() for cell in headers]
    if labels.count("date") < 2 or "shut down" not in labels or "start" not in labels:
        return None
    shut = labels.index("shut down")
    start = labels.index("start")
    dates = [index for index, name in enumerate(labels) if name == "date"]
    shut_dates = [index for index in dates if index < shut]
    start_dates = [index for index in dates if index < start and index != (shut_dates[-1] if shut_dates else -1)]
    if not shut_dates or not start_dates:
        return None
    cause = labels.index("cause") if "cause" in labels else None
    train = labels.index("train") if "train" in labels else 0
    return {
        "train": train,
        "shut_date": shut_dates[-1],
        "shut_time": shut,
        "start_date": start_dates[-1],
        "start_time": start,
        "cause": cause if cause is not None else -1,
    }


def is_train_shutdown_workbook(source: str | Path | bytes) -> bool:
    book = _open_workbook(source)
    try:
        sheet = book.worksheets[0]
        for row in sheet.iter_rows(max_row=3, values_only=True):
            if _train_columns(list(row)) is not None:
                return True
    finally:
        book.close()
    return False


def _train_part(value) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    if not text or text.lower() == "none":
        return None
    if text == "1":
        return "Train1"
    if text == "2":
        return "Train2"
    return text[:50]


def _promote_jalali_stamp(value: datetime | None) -> datetime | None:
    """A Shamsi year saved as the datetime year (1403-07-11) is not a Gregorian day."""
    if value is None or not (1200 <= value.year <= 1600):
        return value
    if not (1 <= value.month <= 12 and 1 <= value.day <= 31):
        return value
    try:
        day = jalali_to_gregorian(value.year, value.month, value.day)
    except (ValueError, OverflowError):
        return value
    return datetime(day.year, day.month, day.day, value.hour, value.minute, value.second)


def repair_shutdown_dates(db: Session) -> dict[str, int]:
    """Turn Shamsi years into real dates, and drop Excel epoch stamps that display as 1278."""
    removed = 0
    converted = 0
    for row in db.query(models.Shutdown).all():
        started = _promote_jalali_stamp(row.shutdown_time)
        ended = _promote_jalali_stamp(row.startup_time)
        if started != row.shutdown_time or ended != row.startup_time:
            row.shutdown_time = started
            row.startup_time = ended
            converted += 1
        if row.startup_time is not None and row.startup_time.year < 1990:
            row.startup_time = None
            converted += 1
        if row.shutdown_time is not None and row.shutdown_time.year < 1990:
            db.delete(row)
            removed += 1
    db.commit()
    return {"removed": removed, "converted": converted}


def import_train_shutdown_workbook(db: Session, source: str | Path | bytes) -> dict:
    """Both trains' shutdown log: Jalali date plus the clock, including minutes."""
    book = _open_workbook(source)
    created = 0
    updated = 0
    skipped = 0
    touched: list[models.Shutdown] = []
    try:
        sheet = book.worksheets[0]
        header_at = None
        columns = None
        for index, row in enumerate(sheet.iter_rows(max_row=3, values_only=True)):
            columns = _train_columns(list(row))
            if columns is not None:
                header_at = index
                break
        if header_at is None or columns is None:
            raise ValueError("This workbook is not the two-train shutdown log.")
        existing = {
            ((row.plant_part or "").strip(), row.shutdown_time): row
            for row in db.query(models.Shutdown).all()
            if row.shutdown_time
        }

        def take(row, name: str):
            pos = columns[name]
            if pos < 0 or pos >= len(row):
                return None
            return row[pos]

        for row in sheet.iter_rows(min_row=header_at + 2, values_only=True):
            part = _train_part(take(row, "train"))
            started = _stamp(take(row, "shut_date"), take(row, "shut_time"))
            if not part or started is None:
                skipped += 1
                continue
            ended = _stamp(take(row, "start_date"), take(row, "start_time"))
            if ended is not None and ended < started:
                ended = None
            cause = _text(take(row, "cause"))
            current = existing.get((part, started))
            if current is None:
                current = models.Shutdown(
                    plant_part=part,
                    shutdown_time=started,
                    startup_time=ended,
                    cause=cause,
                    remarks=cause,
                )
                db.add(current)
                existing[(part, started)] = current
                created += 1
                touched.append(current)
            else:
                changed = False
                if ended and current.startup_time != ended and (
                    current.startup_time is None or current.startup_time.minute == 0 and current.startup_time.hour == ended.hour
                ):
                    current.startup_time = ended
                    changed = True
                if cause and not (current.cause or "").strip():
                    current.cause = cause
                    current.remarks = current.remarks or cause
                    changed = True
                if changed:
                    updated += 1
                    touched.append(current)
                else:
                    skipped += 1
    finally:
        book.close()
    db.flush()
    for row in sorted(touched, key=lambda item: item.shutdown_time or datetime.min):
        _apply_trip_metrics(db, row)
    db.commit()
    return {"ok": True, "created": created, "updated": updated, "skipped": skipped}
