"""AriaORMS shift report (گزارش کارکردی سلول‌ها).

The cell-room page lists each electrolyzer as ON or OFF, its LOAD (KA),
the train's in-service count, and the supervisor who filed the shift.
Those fields, not the voltage log sheet, are the plant's in-service count and kA.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from html.parser import HTMLParser
from io import BytesIO
from typing import Any

from sqlalchemy import String, cast
from sqlalchemy.orm import Session

from . import models
from .plant_import import parse_plant_date
from .plant_topology import all_electrolyzers, format_electrolyzer_name, train_of

_EL = r"[A-HJ-M][12]"
_EL_RE = re.compile(rf"^({_EL})$", re.I)
_LOAD_RE = re.compile(rf"^({_EL})\s*LOAD\s*\(KA\)$", re.I)
_DAY_RE = re.compile(rf"^({_EL})\s*\(DAY\)$", re.I)
_STOP_RE = re.compile(rf"^({_EL})\s*SHUT DOWN and START\s*\(TIME\)$", re.I)
_COUNT_RE = re.compile(r"Number of Electrolyzer in Service TRAIN\s*([12])", re.I)
_TRAIN_KA_RE = re.compile(r"CELLROOM TRAIN\s*([12])\s*\(KA\)", re.I)
_TRAIN_ON_RE = re.compile(r"^CELLROOM TRAIN\s*([12])$", re.I)
_TON_RE = re.compile(r"CELLROOM TRAIN\s*([12])\s*\(TON", re.I)
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and len(value) >= 10:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _clean(value: Any) -> str:
    text = "" if value is None else str(value)
    return " ".join(text.replace("\xa0", " ").split())


def _number(value: str) -> float | None:
    text = _clean(value).translate(_DIGITS).replace(",", "")
    if not text or text in {"-", "—", "*"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _on_off(value: str) -> bool | None:
    token = _clean(value).upper()
    if token == "ON":
        return True
    if token == "OFF":
        return False
    return None


class _GridParser(HTMLParser):
    """Collect text tables in document order, including nested tables."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._row.append(_clean("".join(self._cell)))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if any(cell for cell in self._row):
                if not self.tables:
                    self.tables.append([])
                self.tables[-1].append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def close_open_row(self) -> None:
        if self._row and any(cell for cell in self._row):
            if not self.tables:
                self.tables.append([])
            self.tables[-1].append(self._row)
        self._row = None


def html_grids(html: str) -> list[list[list[str]]]:
    parser = _GridParser()
    parser.feed(html)
    parser.close()
    parser.close_open_row()
    return parser.tables


def parse_grid(
    rows: list[list[str]],
    *,
    fallback_date: date | None = None,
    rotation: str = "",
    shift_index: int = 0,
) -> dict[str, Any] | None:
    """Read one shift grid. Labels and values sit side by side; the header is a column row."""
    known = set(all_electrolyzers())
    units: dict[str, dict[str, Any]] = {}
    trains: dict[str, dict[str, Any]] = {}
    supervisor = ""
    persons = ""
    found_date: date | None = None
    found_rotation = rotation

    def unit(name: str) -> dict[str, Any]:
        key = name.upper()
        bucket = units.setdefault(
            key,
            {"electrolyzer": key, "online": False, "load_ka": None, "shutdown_note": ""},
        )
        return bucket

    def train(number: str) -> dict[str, Any]:
        return trains.setdefault(number, {"on": None, "ka": None, "in_service": None})

    for index, row in enumerate(rows):
        cells = [_clean(cell) for cell in row]
        for column, label in enumerate(cells):
            lowered = label.lower()
            if lowered == "supervisor" and index + 1 < len(rows) and column < len(rows[index + 1]):
                supervisor = _clean(rows[index + 1][column])
            elif lowered == "date" and index + 1 < len(rows) and column < len(rows[index + 1]):
                found_date = parse_plant_date(rows[index + 1][column]) or found_date
            elif lowered == "rotation" and index + 1 < len(rows) and column < len(rows[index + 1]):
                below = _clean(rows[index + 1][column])
                if below:
                    found_rotation = below
        cursor = 0
        while cursor < len(cells) - 1:
            label = cells[cursor]
            value = cells[cursor + 1]
            load = _LOAD_RE.match(label)
            count = _COUNT_RE.search(label)
            train_ka = _TRAIN_KA_RE.search(label)
            train_on = _TRAIN_ON_RE.match(label)
            stop = _STOP_RE.match(label)
            named = _EL_RE.match(label)
            if load and load.group(1).upper() in known:
                unit(load.group(1))["load_ka"] = _number(value)
                cursor += 2
            elif count:
                train(count.group(1))["in_service"] = int(_number(value) or 0)
                cursor += 2
            elif train_ka:
                train(train_ka.group(1))["ka"] = _number(value)
                cursor += 2
            elif train_on:
                train(train_on.group(1))["on"] = _on_off(value)
                cursor += 2
            elif stop and stop.group(1).upper() in known:
                unit(stop.group(1))["shutdown_note"] = value
                cursor += 2
            elif named and named.group(1).upper() in known and _on_off(value) is not None:
                unit(named.group(1))["online"] = bool(_on_off(value))
                cursor += 2
            elif _DAY_RE.match(label) or _TON_RE.search(label):
                cursor += 2
            else:
                cursor += 1

    if not units and not trains:
        return None
    report_day = found_date or fallback_date
    if report_day is None:
        return None
    official = sum(int(item["in_service"]) for item in trains.values() if item.get("in_service") is not None)
    on_count = sum(1 for item in units.values() if item["online"])
    return {
        "report_date": report_day,
        "rotation": found_rotation or rotation,
        "shift_index": shift_index,
        "supervisor": supervisor,
        "shift_persons": persons,
        "in_service_count": official if official else on_count,
        "trains": trains,
        "units": {name: item for name, item in units.items() if name in known},
    }


def parse_shift_html(
    html: str,
    *,
    fallback_date: date | None = None,
    rotation: str = "",
    shift_index: int = 0,
) -> dict[str, Any] | None:
    grids = html_grids(html)
    merged_rows: list[list[str]] = []
    for grid in grids:
        merged_rows.extend(grid)
    persons = _persons_from_html(html)
    parsed = parse_grid(
        merged_rows,
        fallback_date=fallback_date,
        rotation=rotation,
        shift_index=shift_index,
    )
    if parsed is not None and persons and not parsed.get("shift_persons"):
        parsed["shift_persons"] = persons
    return parsed


def parse_shift_xlsx(
    content: bytes,
    *,
    fallback_date: date | None = None,
    rotation: str = "",
    shift_index: int = 0,
) -> dict[str, Any] | None:
    import openpyxl

    book = openpyxl.load_workbook(BytesIO(content), data_only=True, read_only=True)
    rows: list[list[str]] = []
    try:
        for sheet in book.worksheets:
            for row in sheet.iter_rows(values_only=True):
                cells = [_clean(cell) for cell in row]
                if any(cells):
                    rows.append(cells)
    finally:
        book.close()
    return parse_grid(rows, fallback_date=fallback_date, rotation=rotation, shift_index=shift_index)


def _persons_from_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html)
    text = _clean(text)
    match = re.search(r"Shift Persons\s+(.*?)\s+Normal Report", text, re.I)
    if not match:
        return ""
    names = _clean(match.group(1))
    return names[:1000]


def save_shift_reports(db: Session, reports: list[dict[str, Any]]) -> int:
    """Replace stored rows for each pulled shift. Returns the number of electrolyzer rows written."""
    written = 0
    for report in reports:
        units: dict[str, dict[str, Any]] = report.get("units") or {}
        if not units or report.get("report_date") is None:
            continue
        rotation = (report.get("rotation") or "")[:80]
        day = report["report_date"]
        (
            db.query(models.CellroomShiftLoad)
            .filter(
                models.CellroomShiftLoad.report_date == day,
                models.CellroomShiftLoad.rotation == rotation,
            )
            .delete(synchronize_session=False)
        )
        trains: dict[str, dict[str, Any]] = report.get("trains") or {}
        for name, item in units.items():
            train_no = train_of(name)
            train_info = trains.get(train_no or "", {})
            db.add(
                models.CellroomShiftLoad(
                    report_date=day,
                    rotation=rotation,
                    shift_index=int(report.get("shift_index") or 0),
                    supervisor=(report.get("supervisor") or "")[:200] or None,
                    shift_persons=report.get("shift_persons") or None,
                    electrolyzer=name,
                    in_service=bool(item.get("online")),
                    load_ka=item.get("load_ka"),
                    train=train_no,
                    train_on=train_info.get("on"),
                    train_ka=train_info.get("ka"),
                    train_in_service=train_info.get("in_service"),
                    shutdown_note=(item.get("shutdown_note") or "")[:200] or None,
                )
            )
            written += 1
    return written


def _pack(rows: list[models.CellroomShiftLoad]) -> dict[str, Any] | None:
    if not rows:
        return None
    best_index = max(int(row.shift_index or 0) for row in rows)
    candidates = [row for row in rows if int(row.shift_index or 0) == best_index]
    rotation = candidates[0].rotation
    chosen = [row for row in candidates if row.rotation == rotation]
    units = {
        row.electrolyzer: {
            "online": bool(row.in_service),
            "load_ka": float(row.load_ka) if row.load_ka is not None else None,
        }
        for row in chosen
    }
    train_counts: dict[str, int] = {}
    for row in chosen:
        if row.train and row.train_in_service is not None:
            train_counts[row.train] = int(row.train_in_service)
    official = sum(train_counts.values()) if train_counts else sum(1 for row in chosen if row.in_service)
    return {
        "report_date": chosen[0].report_date,
        "rotation": chosen[0].rotation,
        "supervisor": chosen[0].supervisor or "",
        "shift_persons": chosen[0].shift_persons or "",
        "in_service_count": official,
        "units": units,
    }


def day_shift(db: Session, day: date | None) -> dict[str, Any] | None:
    """Latest stored shift for that Gregorian day, or None when the report was not pulled."""
    if day is None:
        return None
    rows = (
        db.query(models.CellroomShiftLoad)
        .filter(models.CellroomShiftLoad.report_date == day)
        .all()
    )
    return _pack(rows)


def shifts_between(db: Session, start_day: date, end_day: date) -> dict[date, dict[str, Any]]:
    """One shift per day, inclusive of start_day and exclusive of end_day."""
    rows = (
        db.query(models.CellroomShiftLoad)
        .filter(
            models.CellroomShiftLoad.report_date >= start_day,
            models.CellroomShiftLoad.report_date < end_day,
        )
        .all()
    )
    grouped: dict[date, list[models.CellroomShiftLoad]] = {}
    for row in rows:
        grouped.setdefault(row.report_date, []).append(row)
    return {day: packed for day, packed in ((day, _pack(items)) for day, items in grouped.items()) if packed}


def shift_power_by_day(db: Session, start_day: date, end_day: date) -> dict[date, float]:
    """Daily plant kW from shift-report kA times that day's stack voltage."""
    shifts = shifts_between(db, start_day, end_day)
    if not shifts:
        return {}
    stored = cast(models.ElectrolyzerNormalization.date, String)
    voltage_rows = (
        db.query(models.ElectrolyzerNormalization)
        .filter(
            stored >= start_day.isoformat(),
            stored < end_day.isoformat(),
            models.ElectrolyzerNormalization.total_voltage.isnot(None),
            models.ElectrolyzerNormalization.total_voltage > 50,
        )
        .all()
    )
    volts: dict[tuple[str, date], float] = {}
    for row in voltage_rows:
        sample_day = _as_date(row.date)
        if sample_day is None or row.electrolyzer is None:
            continue
        name = format_electrolyzer_name(row.electrolyzer)
        if name not in shifts.get(sample_day, {}).get("units", {}):
            continue
        prev = volts.get((name, sample_day))
        value = float(row.total_voltage or 0)
        if prev is None or value > prev:
            volts[(name, sample_day)] = value
    out: dict[date, float] = {}
    for day, shift in shifts.items():
        total = 0.0
        used = False
        for name, unit in shift["units"].items():
            if not unit.get("online"):
                continue
            ka = float(unit.get("load_ka") or 0)
            voltage = volts.get((name, day)) or 0
            if ka > 0 and voltage > 50:
                total += voltage * ka
                used = True
        if used:
            out[day] = total
    return out
