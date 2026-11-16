"""AriaORMS shift report (گزارش کارکردی سلول‌ها).

The cell-room page lists each electrolyzer as ON or OFF, its LOAD (KA),
the train's in-service count, and the supervisor who filed the shift.
Those fields, not the voltage log sheet, are the plant's in-service count and kA.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from io import BytesIO
from typing import Any

from sqlalchemy.orm import Session

from . import models
from .plant_import import parse_plant_date
from .plant_topology import all_electrolyzers, format_electrolyzer_name, train_of

_EL = r"[A-HJ-M][12]"
_EL_RE = re.compile(rf"^({_EL})$", re.I)
_LOAD_RE = re.compile(rf"^({_EL})\s*LOAD\s*\(KA\)$", re.I)
_DAY_RE = re.compile(rf"^({_EL})\s*\(DAY\)$", re.I)
_STOP_RE = re.compile(rf"^({_EL})\s*SHUT DOWN\s*(?:\(TIME\))?\s*and START\s*\(TIME\)$", re.I)
# AriaORMS spells train 2 "Electrolyer", so accept any spelling between "Electroly" and "in Service".
_COUNT_RE = re.compile(r"Number of Electroly\w* in Service TRAIN\s*([12])", re.I)
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
            {"electrolyzer": key, "online": None, "load_ka": None, "shutdown_note": ""},
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
                bucket = unit(load.group(1))
                bucket["load_ka"] = _number(value)
                if (bucket["load_ka"] or 0) > 0:
                    bucket["online"] = True
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
            elif _TON_RE.search(label):
                ton = _TON_RE.search(label)
                train(ton.group(1))["ton_h"] = _number(value)
                cursor += 2
            elif stop and stop.group(1).upper() in known:
                unit(stop.group(1))["shutdown_note"] = value
                cursor += 2
            elif named and named.group(1).upper() in known and _on_off(value) is not None:
                unit(named.group(1))["online"] = bool(_on_off(value))
                cursor += 2
            elif _DAY_RE.match(label):
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


def is_shift_workbook(content: bytes) -> bool:
    """True for the AriaORMS cell-room shift report export (has an OperationInfo sheet)."""
    import openpyxl

    try:
        book = openpyxl.load_workbook(BytesIO(content), read_only=True)
    except Exception:  # noqa: BLE001
        return False
    try:
        return any(name.strip().lower() == "operationinfo" for name in book.sheetnames)
    finally:
        book.close()


def _rotation_index(text: str) -> int:
    """Order of the rotation inside its day, so the latest shift wins (day < evening < night)."""
    value = _clean(text)
    if any(word in value for word in ("روز", "صبح")):
        return 1
    if "عصر" in value:
        return 2
    if "شب" in value:
        return 3
    return 0


def parse_shift_xlsx(
    content: bytes,
    *,
    fallback_date: date | None = None,
    rotation: str = "",
    shift_index: int = 0,
) -> dict[str, Any] | None:
    """Read an AriaORMS shift-report workbook.

    The export has an ``OperationInfo`` sheet (label / value rows: ON/OFF, LOAD (KA), in-service
    counts), an ``Actions`` sheet that carries the shift date, rotation and supervisor, and a
    ``PresentPersons`` sheet. An older single-grid workbook is still read as before.
    """
    import openpyxl

    book = openpyxl.load_workbook(BytesIO(content), data_only=True, read_only=True)
    info_rows: list[list[str]] = []
    other_rows: list[list[str]] = []
    actions: list[list[str]] = []
    persons: list[str] = []
    try:
        for sheet in book.worksheets:
            key = sheet.title.strip().lower()
            for row in sheet.iter_rows(values_only=True):
                cells = [_clean(cell) for cell in row]
                if not any(cells):
                    continue
                if key == "operationinfo":
                    info_rows.append(cells)
                elif key == "actions":
                    actions.append(cells)
                elif key == "presentpersons":
                    persons.append(" ".join(c for c in cells[:2] if c))
                else:
                    other_rows.append(cells)
    finally:
        book.close()
    if not info_rows:
        return parse_grid(other_rows + actions, fallback_date=fallback_date, rotation=rotation, shift_index=shift_index)

    supervisor = ""
    day = fallback_date
    found_rotation = rotation
    if len(actions) >= 2:
        head = [c.lower() for c in actions[0]]
        first = actions[1]

        def at(name: str) -> str:
            return first[head.index(name)] if name in head and head.index(name) < len(first) else ""

        supervisor = at("supervisor")
        day = parse_plant_date(at("shift")) or day
        if at("shift") and len(first) > 1 and first[1]:
            found_rotation = first[1]
    parsed = parse_grid(info_rows, fallback_date=day, rotation=found_rotation, shift_index=shift_index or _rotation_index(found_rotation))
    if parsed is not None:
        parsed["supervisor"] = supervisor or parsed.get("supervisor") or ""
        names = [n for n in persons[1:] if n]
        if names:
            parsed["shift_persons"] = "، ".join(names)[:1000]
    return parsed

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
                    in_service=item.get("online") is True,
                    load_ka=item.get("load_ka"),
                    train=train_no,
                    train_on=train_info.get("on"),
                    train_ka=train_info.get("ka"),
                    train_in_service=train_info.get("in_service"),
                    train_ton_h=train_info.get("ton_h"),
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
    trains: dict[str, dict[str, Any]] = {}
    for row in chosen:
        if not row.train:
            continue
        bucket = trains.setdefault(row.train, {"on": None, "ka": None, "in_service": None, "ton_h": None})
        if row.train_on is not None:
            bucket["on"] = bool(row.train_on)
        if row.train_ka is not None:
            bucket["ka"] = float(row.train_ka)
        if row.train_in_service is not None:
            bucket["in_service"] = int(row.train_in_service)
        ton = getattr(row, "train_ton_h", None)
        if ton is not None:
            bucket["ton_h"] = float(ton)
    official = sum(item["in_service"] for item in trains.values() if item.get("in_service") is not None)
    if not official:
        official = sum(1 for row in chosen if row.in_service)
    return {
        "report_date": chosen[0].report_date,
        "rotation": chosen[0].rotation,
        "shift_index": int(chosen[0].shift_index or 0),
        "supervisor": chosen[0].supervisor or "",
        "shift_persons": chosen[0].shift_persons or "",
        "in_service_count": official,
        "has_unit_loads": any((unit["load_ka"] or 0) > 0 or unit["online"] for unit in units.values()),
        "trains": trains,
        "units": units,
    }


MORNING = "morning"
NIGHT = "night"
_KIND_ID = {MORNING: "5", NIGHT: "6"}


def rotation_kind(text: str) -> str | None:
    """12 صبح is the day shift filed at 19:00. 12 شب is the night shift filed at 07:00 the next morning."""
    value = _clean(text)
    compact = value.replace(" ", "")
    if "صبح" in compact or "روز" in value or "morning" in value.lower():
        return MORNING
    if "شب" in value or "night" in value.lower():
        return NIGHT
    return None


def _clock_pair(times: str | None) -> tuple[int, int]:
    """Minutes past midnight of the morning pull and the evening pull."""
    slots: list[int] = []
    for part in (times or "07:00,19:00").replace(";", ",").split(","):
        part = part.strip()
        if ":" not in part:
            continue
        hour_s, minute_s = part.split(":", 1)
        try:
            slots.append(int(hour_s) * 60 + int(minute_s))
        except ValueError:
            continue
    morning = slots[0] if slots else 7 * 60
    evening = slots[1] if len(slots) > 1 else 19 * 60
    return morning, evening


def due_shift(now: datetime | None = None, times: str | None = None) -> tuple[date, str]:
    """Which written report the dashboard should show.

    From the evening clock onward: today's 12 صبح.
    From the morning clock until the evening clock: yesterday's 12 شب.
    Before the morning clock the night report is not written yet, so yesterday's 12 صبح stays.
    """
    if now is None:
        from .energy import tehran_now

        now = tehran_now()
    morning, evening = _clock_pair(times)
    minutes = now.hour * 60 + now.minute
    if minutes >= evening:
        return now.date(), MORNING
    if minutes >= morning:
        return now.date() - timedelta(days=1), NIGHT
    return now.date() - timedelta(days=1), MORNING


def pick_rotations(rotations: list[tuple[str, str]], kind: str) -> list[tuple[str, str]]:
    """The page option for this shift. Falls back to the known AriaORMS ids 5 and 6."""
    matched = [(value, label) for value, label in rotations if rotation_kind(label) == kind]
    if matched:
        return matched
    wanted = _KIND_ID.get(kind)
    by_id = [(value, label) for value, label in rotations if value == wanted]
    if by_id:
        return by_id
    if wanted and not rotations:
        label = "12 صبح" if kind == MORNING else "12 شب"
        return [(wanted, label)]
    return []


def _has_load(packed: dict[str, Any] | None) -> bool:
    if not packed:
        return False
    if any((item.get("ka") or 0) > 0 for item in (packed.get("trains") or {}).values()):
        return True
    return any((unit.get("load_ka") or 0) > 0 for unit in (packed.get("units") or {}).values())


def _rows_between(db: Session, start_day: date, end_day: date) -> list[models.CellroomShiftLoad]:
    return (
        db.query(models.CellroomShiftLoad)
        .filter(
            models.CellroomShiftLoad.report_date >= start_day,
            models.CellroomShiftLoad.report_date < end_day,
        )
        .all()
    )


def _pack_kind(rows: list[models.CellroomShiftLoad], kind: str) -> dict[str, Any] | None:
    picked = [row for row in rows if rotation_kind(row.rotation or "") == kind]
    if not picked:
        wanted = 1 if kind == MORNING else 3
        picked = [row for row in rows if int(row.shift_index or 0) == wanted]
    return _pack(picked)


def current_shift(db: Session, now: datetime | None = None) -> dict[str, Any] | None:
    """The shift the live dashboard is based on. Never a blank one while an older report still has kA."""
    settings = db.query(models.VoltageSyncSettings).first()
    day, kind = due_shift(now, settings.shift_report_times if settings is not None else None)
    window = _rows_between(db, day - timedelta(days=4), day + timedelta(days=1))
    primary = _pack_kind([row for row in window if row.report_date == day], kind)
    if _has_load(primary):
        return primary
    grouped: dict[tuple[date, str], list[models.CellroomShiftLoad]] = {}
    for row in window:
        grouped.setdefault((row.report_date, row.rotation or ""), []).append(row)
    candidates = [packed for packed in (_pack(items) for items in grouped.values()) if _has_load(packed)]
    if candidates:
        return max(candidates, key=lambda item: (item["report_date"], int(item.get("shift_index") or 0)))
    return primary


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


# One electrolyzer is about 15 kA. A larger figure on a unit row is the train
# current copied onto every electrolyzer, or the same shift added more than once.
UNIT_KA_LIMIT = 30.0


def combine_train_power(pairs: list[tuple[float, float]], train_ka: float | None) -> float:
    """kW for one train. Each pair is one electrolyzer's stack voltage and its own kA.

    The train current is counted once. Unit currents are summed only when each
    one is a real electrolyzer load. If every row carries more than a unit can
    draw, that number is the train current repeated on each read: use it once.
    If the unit loads add up to more than the official train kA, scale them
    back so the same kiloamperes are not added again.
    """
    usable = [(float(v), float(i)) for v, i in pairs if v and i and float(v) > 50 and float(i) > 0]
    if not usable:
        return 0.0
    currents = [i for _, i in usable]
    unit_sum = sum(currents)
    official = float(train_ka) if train_ka else 0.0
    if len(usable) >= 2 and min(currents) > UNIT_KA_LIMIT:
        ka = official if official > 0 else unit_sum / len(usable)
        mean_v = sum(v for v, _ in usable) / len(usable)
        return mean_v * ka
    if official > 0 and unit_sum > official * 1.5:
        return sum(v * i for v, i in usable) * (official / unit_sum)
    return sum(v * i for v, i in usable)


def _clock_minutes(label: str | None) -> int:
    text = _clean(label)
    if ":" not in text:
        return -1
    hour_s, minute_s = text.split(":", 1)
    try:
        return int(hour_s) * 60 + int(minute_s[:2])
    except ValueError:
        return -1


def averaged_shift_loads(rows: list) -> dict[date, dict[str, Any]]:
    """One kiloampere per electrolyzer per day.

    A repeated pull of the same shift keeps one row. Morning and night are
    averaged, not added. Train kA is stored on every electrolyzer row; it is
    recorded once per train per shift, then averaged across that day's shifts.
    """
    grouped: dict[date, dict[str, dict[str, tuple[int, float | None, bool]]]] = {}
    train_samples: dict[date, dict[str, dict[str, float]]] = {}
    for row in rows:
        day = _as_date(getattr(row, "report_date", None))
        name = format_electrolyzer_name(getattr(row, "electrolyzer", None))
        if day is None or not name:
            continue
        rotation = (getattr(row, "rotation", None) or "") or str(getattr(row, "shift_index", "") or "")
        slot = grouped.setdefault(day, {}).setdefault(rotation, {})
        row_id = int(getattr(row, "id", 0) or 0)
        prev = slot.get(name)
        if prev is not None and prev[0] >= row_id:
            continue
        raw_ka = getattr(row, "load_ka", None)
        ka = float(raw_ka) if raw_ka is not None else None
        online = bool(getattr(row, "in_service", False)) or (ka or 0) > 0
        slot[name] = (row_id, ka, online)
        train = str(getattr(row, "train", None) or train_of(name) or "")
        raw_train = getattr(row, "train_ka", None)
        if train and raw_train is not None and float(raw_train) > 0:
            train_samples.setdefault(day, {}).setdefault(rotation, {})[train] = float(raw_train)

    out: dict[date, dict[str, Any]] = {}
    for day, rotations in grouped.items():
        unit_values: dict[str, list[float]] = {}
        for units in rotations.values():
            for name, (_row_id, ka, _online) in units.items():
                # A shift with no load is skipped. Two real shifts are averaged, not added.
                if ka is None or ka <= 0:
                    continue
                unit_values.setdefault(name, []).append(ka)
        units_out = {
            name: sum(values) / len(values)
            for name, values in unit_values.items()
            if values and sum(values) / len(values) > 0
        }
        by_train: dict[str, list[float]] = {}
        for rotation_trains in (train_samples.get(day) or {}).values():
            for train, ka in rotation_trains.items():
                by_train.setdefault(train, []).append(ka)
        trains_out = {train: sum(values) / len(values) for train, values in by_train.items() if values}
        if units_out or trains_out:
            out[day] = {"units": units_out, "trains": trains_out}
    return out


def shift_power_by_day(db: Session, start_day: date, end_day: date) -> dict[date, float]:
    """Daily plant kW. Each day is one sample: averaged shift kA times that day's latest stack voltage."""
    loads = averaged_shift_loads(_rows_between(db, start_day, end_day))
    if not loads:
        return {}
    from .sqlite_dates import stored_between

    voltage_rows = (
        db.query(models.ElectrolyzerNormalization)
        .filter(
            stored_between(models.ElectrolyzerNormalization.date, start_day, end_day),
            models.ElectrolyzerNormalization.total_voltage.isnot(None),
            models.ElectrolyzerNormalization.total_voltage > 50,
        )
        .all()
    )
    # Latest stack that day, not the highest spike and not a sum of every reading.
    volts: dict[tuple[str, date], tuple[tuple[int, int], float]] = {}
    for row in voltage_rows:
        sample_day = _as_date(row.date)
        if sample_day is None or sample_day not in loads or row.electrolyzer is None:
            continue
        name = format_electrolyzer_name(row.electrolyzer)
        if name not in loads[sample_day]["units"]:
            continue
        stamp = (_clock_minutes(getattr(row, "time", None)), int(getattr(row, "id", 0) or 0))
        value = float(row.total_voltage or 0)
        prev = volts.get((name, sample_day))
        if prev is None or stamp > prev[0]:
            volts[(name, sample_day)] = (stamp, value)
    out: dict[date, float] = {}
    for day, packed in loads.items():
        by_train: dict[str, list[tuple[float, float]]] = {}
        for name, ka in packed["units"].items():
            voltage = volts.get((name, day), (None, 0.0))[1]
            if ka > 0 and voltage > 50:
                by_train.setdefault(train_of(name) or "", []).append((voltage, float(ka)))
        total = 0.0
        for train, pairs in by_train.items():
            total += combine_train_power(pairs, packed["trains"].get(train))
        if total > 0:
            out[day] = total
    return out
