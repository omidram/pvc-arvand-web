"""Load the plant monthly trip workbook (one sheet per Shamsi month) into shutdowns."""
from __future__ import annotations

import re
from datetime import date, datetime, time
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


def _clock(value) -> time:
    if isinstance(value, datetime):
        return value.time()
    if isinstance(value, time):
        return value
    text = str(value or "").strip()
    match = re.match(r"^(\d{1,2}):(\d{2})", text)
    if not match:
        return time(0, 0)
    return time(int(match.group(1)), int(match.group(2)))


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
