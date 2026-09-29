"""Parsers for plant Excel files used at PVC Arvand (SiteMan voltage, LIMS lab, assembly, TAFKIK)."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from io import BytesIO
from typing import Any

from openpyxl import load_workbook

# ---------------------------------------------------------------------------
# Jalali (Persian) calendar helpers — sufficient for plant dates 1300–1500
# ---------------------------------------------------------------------------

def _div(a: int, b: int) -> int:
    return a // b


def jalali_to_gregorian(jy: int, jm: int, jd: int) -> date:
    """Convert Jalali y/m/d to Gregorian date (algorithm from jalaali-js)."""
    if jy > 979:
        gy = 1600
        jy -= 979
    else:
        gy = 621
    days = 365 * jy + _div(jy, 33) * 8 + _div((jy % 33) + 3, 4) + 78 + jd + (31 * (jm - 1) if jm < 7 else (186 + 30 * (jm - 7)))
    gy += 400 * _div(days, 146097)
    days %= 146097
    if days > 36524:
        gy += 100 * _div(days - 1, 36524)
        days = (days - 1) % 36524
        if days >= 365:
            days += 1
    gy += 4 * _div(days, 1461)
    days %= 1461
    if days > 365:
        gy += _div(days - 1, 365)
        days = (days - 1) % 365
    gd = days + 1
    sal_a = [0, 31, 29 if (gy % 4 == 0 and gy % 100 != 0) or (gy % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    gm = 1
    while gm <= 12 and gd > sal_a[gm]:
        gd -= sal_a[gm]
        gm += 1
    return date(gy, gm, gd)


def parse_plant_date(value: Any) -> date | None:
    """Parse Jalali or Gregorian dates from plant Excel cells."""
    if value is None or value == "" or value == "*":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text or text in {"*", "―", "-", "—"}:
        return None
    # Excel serial number
    if isinstance(value, (int, float)) and 20000 < float(value) < 80000:
        try:
            return (datetime(1899, 12, 30) + timedelta(days=float(value))).date()
        except Exception:
            pass
    # YYYY-MM-DD or YYYY/MM/DD (Gregorian if year > 1600)
    m = re.match(r"^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})", text)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y >= 1600:
            try:
                return date(y, mo, d)
            except ValueError:
                return None
        if 1300 <= y <= 1500:
            try:
                return jalali_to_gregorian(y, mo, d)
            except Exception:
                return None
    # YY.MM.DD Jalali short (e.g. 00.11.18 → 1400/11/18 if yy<=80 else 13yy)
    m = re.match(r"^(\d{2})[./\-](\d{1,2})[./\-](\d{1,2})$", text)
    if m:
        yy, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y = 1400 + yy if yy <= 80 else 1300 + yy
        try:
            return jalali_to_gregorian(y, mo, d)
        except Exception:
            return None
    # Persian month name + year e.g. آبان 1397
    persian_months = {
        "فروردین": 1, "فروزدین": 1,
        "اردیبهشت": 2, "اردیبهشتا": 2,
        "خرداد": 3,
        "تیر": 4,
        "مرداد": 5,
        "شهریور": 6,
        "مهر": 7,
        "آبان": 8, "ابان": 8,
        "آذر": 9, "اذر": 9,
        "دی": 10,
        "بهمن": 11,
        "اسفند": 12,
    }
    for name, mo in persian_months.items():
        if name in text:
            ym = re.search(r"(13|14)\d{2}", text)
            if not ym:
                continue
            # ARIAORMS header: "یکشنبه 5 ام مهر ماه 1405"
            day = 1
            day_m = re.search(rf"(\d{{1,2}})\s*(?:ام|م)?\s*{re.escape(name)}", text)
            if day_m:
                day = int(day_m.group(1))
            else:
                day_m = re.search(r"(\d{1,2})\s*ام", text)
                if day_m:
                    day = int(day_m.group(1))
            try:
                return jalali_to_gregorian(int(ym.group(0)), mo, day)
            except Exception:
                return None
    return None


def parse_plant_datetime(text: Any) -> datetime | None:
    if text is None:
        return None
    if isinstance(text, datetime):
        return text
    s = str(text).strip()
    # 1405/06/03 08:00
    m = re.match(r"^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?", s)
    if m:
        d = parse_plant_date(f"{m.group(1)}/{m.group(2)}/{m.group(3)}")
        if not d:
            return None
        hh = int(m.group(4) or 0)
        mm = int(m.group(5) or 0)
        return datetime(d.year, d.month, d.day, hh, mm)
    d = parse_plant_date(s)
    if d:
        return datetime(d.year, d.month, d.day)
    return None


def parse_float_plant(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip()
    # SiteMan: "3/02\nبهزاد..." or "494/4 بهزاد"
    text = text.split("\n", 1)[0].strip()
    text = re.split(r"\s+", text, maxsplit=1)[0]
    text = text.replace(",", ".").replace("/", ".")
    text = re.sub(r"[^\d.\-]", "", text)
    if not text or text in {".", "-", "-."}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _sheet_rows(wb, sheet_name: str | None = None) -> list[list[Any]]:
    ws = wb[sheet_name] if sheet_name else wb[wb.sheetnames[0]]
    return [list(r) for r in ws.iter_rows(values_only=True)]


# ---------------------------------------------------------------------------
# 1) SiteMan / F2 / ARIAORMS LogSheets voltage Excel
# ---------------------------------------------------------------------------

_CELL_RE = re.compile(r"^(?P<el>[A-Za-z]+\d*)-(?P<pos>\d{1,3})\b")
_RECT_ITEM_RE = re.compile(r"^(?P<el>[A-Za-z]+\d+)\s*\[(?P<what>[^\]]+)\]", re.I)
_DATE_ROW_RE = re.compile(r"^\d{4}[./\-]\d{1,2}[./\-]\d{1,2}$")
_EL_RE = re.compile(r"^(?P<el>[A-Za-z]+\d*)\[", re.I)
_EL_VOLTAGE_RE = re.compile(r"electrolyzer\s+voltage\s+(?P<el>[A-Za-z]+\d*)", re.I)
_EL_IN_TEXT_RE = re.compile(r"(?:ELECTROLYZER|EL)\s*(?P<el>[A-Za-z]+\d*)", re.I)


def _col_index(vals_lower: list[str], *names: str) -> int | None:
    for name in names:
        try:
            return vals_lower.index(name.lower())
        except ValueError:
            continue
    return None


def _detect_electrolyzer(*texts: str) -> str | None:
    for text in texts:
        if not text:
            continue
        for rx in (_EL_VOLTAGE_RE, _EL_RE, _EL_IN_TEXT_RE, _CELL_RE):
            m = rx.search(text)
            if m:
                return m.group("el").upper()
    return None


def parse_voltage_excel(content: bytes) -> dict[str, Any]:
    """Parse SiteMan / F2 / ARIAORMS LogSheetsReports Excel exports.

    ARIAORMS wide layout (typical):
      No | Unit | Equipment | Tag | Parameter | Unit | Normal Range | 02:00 | 06:00 | …
    Rows: "Electrolyzer voltage A2" (total) + "A2-001" … element cells.
    """
    wb = load_workbook(BytesIO(content), data_only=True, read_only=True)
    # Prefer clean numeric sheet over SiteMan annotated sheet
    preferred = None
    for name in wb.sheetnames:
        lower = name.lower()
        if "siteman" in lower or "whit" in lower:
            continue
        preferred = name
        break
    if preferred is None:
        preferred = wb.sheetnames[0]

    rows = _sheet_rows(wb, preferred)
    wb.close()

    reading_date: date | None = None
    for row in rows[:12]:
        for cell in row or []:
            if cell is None:
                continue
            d = parse_plant_date(cell)
            if d:
                reading_date = d
                break
        if reading_date:
            break

    header_idx = None
    time_cols: dict[int, str] = {}
    tag_col: int | None = None
    param_col: int | None = None
    equip_col: int | None = None
    for i, row in enumerate(rows):
        vals = [str(c).strip() if c is not None else "" for c in row]
        vals_lower = [v.lower() for v in vals]
        if "parameter" not in vals_lower and "tag" not in vals_lower:
            continue
        tag_col = _col_index(vals_lower, "tag")
        param_col = _col_index(vals_lower, "parameter")
        equip_col = _col_index(vals_lower, "equipment")
        # SiteMan legacy: Parameter often in column 1 without named Tag
        if param_col is None and tag_col is None and len(vals) > 1:
            param_col = 1
            equip_col = equip_col if equip_col is not None else 0
        for j, v in enumerate(vals):
            if re.match(r"^\d{1,2}:\d{2}$", v):
                time_cols[j] = v
        if time_cols and (param_col is not None or tag_col is not None):
            header_idx = i
            break

    if header_idx is None:
        return {"error": "Header row with Parameter/Tag / time columns not found", "readings": [], "totals": {}}

    electrolyzer = None
    readings: list[dict[str, Any]] = []
    totals: dict[str, Any] = {}
    total_slots: dict[tuple[str, str], dict[str, Any]] = {}
    operators: set[str] = set()
    out_of_range: list[dict[str, Any]] = []
    _date_row = _DATE_ROW_RE

    for row in rows[header_idx + 1 :]:
        if not row or all(c is None or str(c).strip() == "" for c in row):
            continue

        # ARIAORMS stacks one day per block: a date row, then the same header, then values.
        first_text = ""
        for cell in row[:3]:
            if cell is not None and str(cell).strip():
                first_text = str(cell).strip()
                break
        if _date_row.match(first_text):
            parsed_day = parse_plant_date(first_text)
            if parsed_day:
                reading_date = parsed_day
            continue
        header_vals = [str(c).strip().lower() if c is not None else "" for c in row]
        if "parameter" in header_vals and any(re.match(r"^\d{1,2}:\d{2}$", v) for v in header_vals):
            continue

        def _cell(idx: int | None) -> str:
            if idx is None or idx >= len(row) or row[idx] is None:
                return ""
            return str(row[idx]).strip()

        equipment = _cell(equip_col if equip_col is not None else 0)
        tag = _cell(tag_col)
        parameter = _cell(param_col if param_col is not None else (1 if equip_col is None else None))
        label = parameter or tag
        if not label or label.lower() in {"parameter", "tag"}:
            continue

        if not electrolyzer:
            electrolyzer = _detect_electrolyzer(equipment, tag, parameter, label)

        # Extract operator from SiteMan-style cells
        for j in time_cols:
            raw = row[j] if j < len(row) else None
            if isinstance(raw, str) and "\n" in raw:
                op = raw.split("\n", 1)[1].strip()
                if op:
                    operators.add(op)

        cell_m = _CELL_RE.match(label) or _CELL_RE.match(tag) or _CELL_RE.match(parameter)
        if cell_m:
            pos_raw = cell_m.group("pos")
            el = cell_m.group("el").upper()
            electrolyzer = electrolyzer or el
            pos = pos_raw.lstrip("0") or "0"
            for j, tlabel in time_cols.items():
                raw = row[j] if j < len(row) else None
                voltage = parse_float_plant(raw)
                if voltage is None:
                    continue
                # skip absurd totals mistaken as cells
                if voltage > 20:
                    continue
                entry = {
                    "electrolyzer": el,
                    "position": pos,
                    "element_nr": f"{el}-{pos_raw}",
                    "time": tlabel,
                    "voltage": voltage,
                    "date": reading_date.isoformat() if reading_date else None,
                }
                readings.append(entry)
                # Normal Range column often sits just before first time slot
                if time_cols:
                    first_time = min(time_cols.keys())
                    nr_idx = first_time - 1
                    if nr_idx >= 0 and nr_idx < len(row):
                        limit = parse_float_plant(row[nr_idx])
                        # ARIAORMS shows "-3.5" as max delta style; flag high cell voltage
                        if limit is not None and limit < 0 and voltage >= abs(limit):
                            out_of_range.append({**entry, "normal_range": limit})
            continue

        # Aggregate / plant rows (total voltage, temps, load)
        key = label.lower()
        el_from_label = _detect_electrolyzer(label, tag, parameter, equipment)
        if el_from_label:
            electrolyzer = electrolyzer or el_from_label
        day_iso = reading_date.isoformat() if reading_date else ""
        for j, tlabel in time_cols.items():
            raw = row[j] if j < len(row) else None
            voltage = parse_float_plant(raw)
            if voltage is None:
                continue
            slot = total_slots.setdefault(day_iso + "|" + tlabel, {"date": day_iso or None, "time": tlabel})
            if "electrolyzer voltage" in key or "totale voltage" in key or "total voltage" in key:
                if "rack a" in key:
                    slot["rack_a"] = voltage
                elif "rack b" in key:
                    slot["rack_b"] = voltage
                else:
                    slot["total"] = voltage
                totals.setdefault(tlabel, {})
                totals[tlabel].update({k: slot[k] for k in ("rack_a", "rack_b", "total") if k in slot})
            elif "anolyte temperature" in key:
                slot["anolyte_temp"] = voltage
            elif "catholyte temperature" in key:
                slot["catholyte_temp"] = voltage
            elif "catholyte concentration" in key:
                slot["catholyte_conc"] = voltage
            elif key.startswith("load "):
                slot["load"] = voltage

    return {
        "sheet": preferred,
        "electrolyzer": electrolyzer,
        "reading_date": reading_date.isoformat() if reading_date else None,
        "operators": sorted(operators),
        "readings": readings,
        "totals": totals,
        "total_slots": list(total_slots.values()),
        "out_of_range": out_of_range,
        "imported_cells": len(readings),
        "times": sorted(set(time_cols.values())),
        "dates": sorted({r["date"] for r in readings if r.get("date")}),
    }


def parse_rectifier_excel(content: bytes) -> dict[str, Any]:
    """Parse Rectifier Room Train log sheets.

    Keeps only DC bus voltage and current (kA). Status and temperature rows
    stay out of the cell-voltage tables.
    """
    wb = load_workbook(BytesIO(content), data_only=True, read_only=True)
    preferred = None
    for name in wb.sheetnames:
        lower = name.lower()
        if "siteman" in lower or "whit" in lower:
            continue
        preferred = name
        break
    if preferred is None:
        preferred = wb.sheetnames[0]
    rows = _sheet_rows(wb, preferred)
    wb.close()

    reading_date: date | None = None
    time_cols: dict[int, str] = {}
    param_col = 1
    header_found = False
    slots: dict[tuple[str, str, str], dict[str, Any]] = {}

    for row in rows:
        if not row or all(c is None or str(c).strip() == "" for c in row):
            continue
        first_text = ""
        for cell in row[:3]:
            if cell is not None and str(cell).strip():
                first_text = str(cell).strip()
                break
        if _DATE_ROW_RE.match(first_text):
            parsed_day = parse_plant_date(first_text)
            if parsed_day:
                reading_date = parsed_day
            continue
        vals = [str(c).strip() if c is not None else "" for c in row]
        vals_lower = [v.lower() for v in vals]
        if "parameter" in vals_lower and any(re.match(r"^\d{1,2}:\d{2}$", v) for v in vals):
            found = _col_index(vals_lower, "parameter")
            if found is not None:
                param_col = found
            time_cols = {j: v for j, v in enumerate(vals) if re.match(r"^\d{1,2}:\d{2}$", v)}
            header_found = bool(time_cols)
            continue
        if not header_found or not time_cols or reading_date is None:
            continue
        if param_col >= len(row) or row[param_col] is None:
            continue
        parameter = str(row[param_col]).strip()
        match = _RECT_ITEM_RE.match(parameter)
        if not match:
            continue
        what = match.group("what").lower()
        if "voltage" in what and "vdc" in what:
            field = "voltage_vdc"
        elif "current" in what and "ka" in what:
            field = "current_ka"
        else:
            continue
        electrolyzer = match.group("el").upper()
        day = reading_date.isoformat()
        for col, tlabel in time_cols.items():
            raw = row[col] if col < len(row) else None
            value = parse_float_plant(raw)
            if value is None:
                continue
            slot = slots.setdefault(
                (electrolyzer, day, tlabel),
                {
                    "electrolyzer": electrolyzer,
                    "date": day,
                    "time": tlabel,
                    "voltage_vdc": None,
                    "current_ka": None,
                },
            )
            slot[field] = value

    if not header_found:
        return {"error": "Header row with Parameter/Tag / time columns not found", "rows": []}
    return {"sheet": preferred, "rows": list(slots.values()), "error": None}


# ---------------------------------------------------------------------------
# 2) Hierarchical lab analysis Excel
# ---------------------------------------------------------------------------

_ANALYTE_KEYS = {"NaOH", "NaCl", "NaClO3", "Ni", "Fe", "NaOCl", "HCl", "pH", "Na2SO4", "Na2CO3"}


def parse_lab_analysis_excel(content: bytes) -> dict[str, Any]:
    wb = load_workbook(BytesIO(content), data_only=True, read_only=True)
    rows = _sheet_rows(wb)
    wb.close()

    samples: list[dict[str, Any]] = []
    ctx: dict[str, Any] = {
        "unit_category": None,
        "unit_tag": None,
        "sc_no": None,
        "fluid": None,
        "sampling": None,
        "remark": None,
    }
    current_params: dict[str, Any] = {}
    current_meta: dict[str, Any] = {}

    def flush():
        nonlocal current_params, current_meta
        if not ctx["sampling"] or not current_params:
            current_params = {}
            current_meta = {}
            return
        fluid = (ctx["fluid"] or "").lower()
        if "caustic" in fluid:
            analysis_type = "caustic_feed"
        elif "anolyt" in fluid:
            analysis_type = "anolyte"
        elif "katholyt" in fluid or "catholyte" in fluid:
            analysis_type = "catholyte"
        elif "brine" in fluid or "sole" in fluid:
            analysis_type = "pure_brine"
        elif "chlor" in fluid:
            analysis_type = "chlorine_gas"
        elif "hcl" in fluid:
            analysis_type = "hcl"
        else:
            analysis_type = "caustic_feed"
        dt = parse_plant_datetime(ctx["sampling"])
        params = dict(current_params)
        params["_meta"] = {
            "unit_category": ctx["unit_category"],
            "unit_tag": ctx["unit_tag"],
            "sc_no": ctx["sc_no"],
            "fluid": ctx["fluid"],
            "remark_supervisor": ctx["remark"],
            "specs": current_meta.get("specs", {}),
            "methods": current_meta.get("methods", {}),
        }
        samples.append(
            {
                "analysis_type": analysis_type,
                "scope": "sub_plant",
                "sub_plant": ctx["unit_tag"] or "Train 1",
                "date": dt.isoformat() if dt else None,
                "time": dt.strftime("%H:%M") if dt else None,
                "parameters": params,
            }
        )
        current_params = {}
        current_meta = {"specs": {}, "methods": {}}

    for row in rows:
        cells = [c for c in row if c is not None and str(c).strip() != ""]
        if not cells:
            continue
        # Flatten row text for context lines
        joined = " | ".join(str(c) for c in row if c is not None)
        joined_clean = re.sub(r"<[^>]+>", "", joined)

        if "Unit Category:" in joined_clean:
            flush()
            ctx["unit_category"] = joined_clean.split("Unit Category:", 1)[1].strip().split("|")[0].strip()
            continue
        if "Unit Tag:" in joined_clean:
            flush()
            ctx["unit_tag"] = joined_clean.split("Unit Tag:", 1)[1].strip().split("|")[0].strip()
            continue
        if "SCNo:" in joined_clean:
            flush()
            sc = joined_clean.split("SCNo:", 1)[1]
            sc = re.sub(r"<[^>]+>", "", sc).strip()
            ctx["sc_no"] = sc.split("|")[0].strip()
            continue
        if "Sampling Time:" in joined_clean:
            flush()
            rest = joined_clean.split("Sampling Time:", 1)[1]
            rest = re.sub(r"<[^>]+>", "", rest)
            # 1405/06/03 08:00 Fluid : Caustic
            m = re.match(r"\s*([0-9./\-: ]+?)\s*(?:Fluid\s*:?\s*(.+))?$", rest.strip(), re.I)
            if m:
                ctx["sampling"] = m.group(1).strip()
                if m.group(2):
                    ctx["fluid"] = m.group(2).strip()
            else:
                ctx["sampling"] = rest.strip()
            current_params = {}
            current_meta = {"specs": {}, "methods": {}}
            continue
        if "Remark Supervisor:" in joined_clean:
            ctx["remark"] = joined_clean.split("Remark Supervisor:", 1)[1].strip()
            continue
        if "Analysis" in joined_clean and "Unit Measurement" in joined_clean:
            continue

        # Analyte row: name in col ~5-6, value, unit, spec, method
        # From sample: blank cols then NaOH, O.S, wt%, 31-33, method
        name = None
        value = None
        unit = None
        spec = None
        method = None
        nonempty = [(i, c) for i, c in enumerate(row) if c is not None and str(c).strip() != ""]
        if len(nonempty) >= 2:
            # find analyte name among known keys
            for i, c in nonempty:
                token = str(c).strip()
                token_key = token.replace(" ", "")
                if token_key in _ANALYTE_KEYS or token in _ANALYTE_KEYS:
                    name = token_key if token_key in _ANALYTE_KEYS else token
                    # next cells
                    rest = [x for j, x in nonempty if j > i]
                    if rest:
                        value = rest[0]
                    if len(rest) > 1:
                        unit = str(rest[1]).strip()
                    if len(rest) > 2:
                        spec = str(rest[2]).strip()
                    if len(rest) > 3:
                        method = str(rest[3]).strip()
                    break
        if name:
            raw_val = str(value).strip() if value is not None else None
            num = parse_float_plant(raw_val) if raw_val and raw_val.upper() not in {"O.S", "OS", "N/A", "ND"} else None
            current_params[name] = num if num is not None else (raw_val or "O.S")
            current_meta.setdefault("specs", {})[name] = spec
            current_meta.setdefault("methods", {})[name] = method
            if unit:
                current_meta.setdefault("units", {})[name] = unit

    flush()
    return {"samples": samples, "imported_samples": len(samples)}


# ---------------------------------------------------------------------------
# 3) Assembly / install / dismantle Excel
# ---------------------------------------------------------------------------

def _ymd_from_row(row: list[Any], day_i: int, month_i: int, year_i: int) -> date | None:
    if year_i >= len(row):
        return None
    y = row[year_i] if year_i < len(row) else None
    m = row[month_i] if month_i < len(row) else None
    d = row[day_i] if day_i < len(row) else None
    if y in (None, "") or m in (None, "") or d in (None, ""):
        return None
    try:
        yi, mi, di = int(y), int(m), int(d)
    except (TypeError, ValueError):
        return parse_plant_date(f"{y}/{m}/{d}")
    if yi <= 0 or mi <= 0 or di <= 0:
        return None
    if yi < 100:
        yi = 1400 + yi if yi <= 80 else 1300 + yi
    try:
        if yi < 1600:
            if not 1300 <= yi <= 1500:
                return None
            return jalali_to_gregorian(yi, mi, di)
        if not 1990 <= yi <= 2045:
            return None
        return date(yi, mi, di)
    except Exception:
        return None


def _header_key(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\u200c", "").replace("ي", "ی").replace("ك", "ک").replace("آ", "ا").replace("أ", "ا")
    return re.sub(r"\s+", "", text).lower()


def _clean_code(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, float) and value.is_integer():
        text = str(int(value))
    elif isinstance(value, int) and not isinstance(value, bool):
        text = str(value)
    else:
        text = re.sub(r"\s+", " ", str(value)).strip()
    if not text or text in {"*", "―", "-", "—", "XXXXX", "xxxxx"}:
        return None
    return text


def _assembly_columns(header: list[Any], sub: list[Any] | None) -> dict[str, Any] | None:
    keys = [_header_key(cell) for cell in header]
    blob = " ".join(keys)
    if "anode" not in blob and "cathode" not in blob:
        return None
    if not any(token in blob for token in ("مونتاژ", "شمارهالمنت", "دیمونتاژ", "نصب", "تاریخ")):
        return None

    def find(pred) -> int | None:
        for index, key in enumerate(keys):
            if key and pred(key):
                return index
        return None

    def ymd_at(start: int | None) -> tuple[int, int, int] | None:
        if start is None:
            return None
        sub_key = _header_key(sub[start]) if sub and start < len(sub) else ""
        if sub_key in {"روز", "day"}:
            return start, start + 1, start + 2
        return None

    status_cols = [index for index, key in enumerate(keys) if key == "وضعیت"]
    assembly_at = find(lambda key: "دیمونتاژ" not in key and "مونتاژ" in key and "تاریخ" in key)
    install_at = find(lambda key: "نصب" in key and "تاریخ" in key)
    dismantle_at = find(lambda key: "دیمونتاژ" in key or ("دی" in key and "مونتاژ" in key and "تاریخ" in key))
    columns: dict[str, Any] = {
        "anode": find(lambda key: key == "anode" or key.startswith("anode")),
        "cathode": find(lambda key: key == "cathode" or key.startswith("cathode")),
        "membrane_type": find(lambda key: "نوعممبران" in key or "membranetype" in key),
        "membrane_use": find(lambda key: "استفاده" in key or "ممبراننو" in key),
        "membrane_nr": find(lambda key: "کدممبران" in key or "شمارهوکد" in key),
        "element_nr": find(lambda key: "شمارهالمنت" in key or key in {"elementnr", "element_nr"}),
        "electrolyzer": find(
            lambda key: key in {"el", "electrolyzer", "elektrolyseur"}
            or ("الکترولایزر" in key and "موقعیت" not in key and "تاریخ" not in key)
        ),
        "position": find(lambda key: "موقعیت" in key or key in {"position", "p"}),
        "remarks": find(lambda key: key in {"توضیحات", "ملاحظات", "remarks"}),
        "assembly_ymd": ymd_at(assembly_at),
        "install_ymd": ymd_at(install_at),
        "dismantle": dismantle_at,
        "source": status_cols[0] if status_cols else None,
        "site": status_cols[1] if len(status_cols) > 1 else None,
    }
    if columns["anode"] is None and columns["element_nr"] is None:
        return None
    return columns


def _cell(row: list[Any], index: int | None) -> Any:
    if index is None or index >= len(row):
        return None
    return row[index]


def _parse_assembly_sheet(rows: list[list[Any]]) -> list[dict[str, Any]] | None:
    header_at = None
    columns = None
    for index, row in enumerate(rows[:12]):
        sub = rows[index + 1] if index + 1 < len(rows) else None
        found = _assembly_columns(row, sub)
        if found:
            header_at = index
            columns = found
            break
    if columns is None or header_at is None:
        return None

    data_at = header_at + (2 if columns["assembly_ymd"] or columns["install_ymd"] else 1)
    elements: list[dict[str, Any]] = []
    for row in rows[data_at:]:
        if not row:
            continue
        anode = _clean_code(_cell(row, columns["anode"]))
        cathode = _clean_code(_cell(row, columns["cathode"]))
        element_nr = _clean_code(_cell(row, columns["element_nr"]))
        if not anode and not cathode and not element_nr:
            continue
        membrane_type = _clean_code(_cell(row, columns["membrane_type"]))
        membrane_use = _clean_code(_cell(row, columns["membrane_use"]))
        membrane_nr = _clean_code(_cell(row, columns["membrane_nr"]))
        source = _clean_code(_cell(row, columns["source"]))
        site = _clean_code(_cell(row, columns["site"]))
        electrolyzer = _clean_code(_cell(row, columns["electrolyzer"]))
        position = _clean_code(_cell(row, columns["position"]))
        remarks = _clean_code(_cell(row, columns["remarks"]))
        assembly = _ymd_from_row(row, *columns["assembly_ymd"]) if columns["assembly_ymd"] else None
        installed = _ymd_from_row(row, *columns["install_ymd"]) if columns["install_ymd"] else None
        dismantle = parse_plant_date(_cell(row, columns["dismantle"]))

        info = []
        if membrane_use:
            info.append(f"use={membrane_use}")
        if source:
            info.append(f"source={source}")
        extra_remarks = []
        if remarks:
            extra_remarks.append(remarks)
        if site and site.upper() not in {"IN SERVICE", "OUT OF SERVICE"}:
            extra_remarks.append(site)
        generation = source if source and "نسل" in source else None

        elements.append(
            {
                "element_nr": element_nr,
                "anode_nr": anode,
                "cathode_nr": cathode,
                "membrane_type": membrane_type,
                "membrane_nr": membrane_nr,
                "membrane_info": "; ".join(info) or None,
                "generation": generation,
                "electrolyzer": electrolyzer.upper() if electrolyzer else None,
                "position": position,
                "assembly_date": assembly.isoformat() if assembly else None,
                "commissioning_date": installed.isoformat() if installed else None,
                "disassembly_date": dismantle.isoformat() if dismantle else None,
                "remarks": "\n".join(extra_remarks) or None,
            }
        )
    return elements


def parse_assembly_excel(content: bytes) -> dict[str, Any]:
    """Read the plant montage / demontage workbook into assembly-form fields.

    The sheet keeps Jalali day, month and year in separate columns under
    تاریخ مونتاژ and تاریخ نصب, plus a single تاریخ دی مونتاژ column.
    """
    wb = load_workbook(BytesIO(content), data_only=True, read_only=True)
    elements: list[dict[str, Any]] = []
    recognized = False
    try:
        for name in wb.sheetnames:
            rows = [list(r) for r in wb[name].iter_rows(values_only=True)]
            parsed = _parse_assembly_sheet(rows)
            if parsed is None:
                continue
            recognized = True
            elements.extend(parsed)
    finally:
        wb.close()
    if not recognized:
        return {"elements": [], "recognized": False, "imported": 0}
    if not elements:
        return {
            "elements": [],
            "recognized": True,
            "imported": 0,
            "error": "No assembly rows found. هیچ ردیف مونتاژ یا دمونتاژ در فایل پیدا نشد.",
        }
    return {"elements": elements, "recognized": True, "imported": len(elements), "sheet": "assembly"}


# ---------------------------------------------------------------------------
# 4) TAFKIK segregation Excel
# ---------------------------------------------------------------------------

def parse_tafkik_excel(content: bytes, sheet: str | None = None) -> dict[str, Any]:
    wb = load_workbook(BytesIO(content), data_only=True, read_only=True)
    name = sheet if sheet and sheet in wb.sheetnames else wb.sheetnames[0]
    rows = _sheet_rows(wb, name)
    wb.close()
    if len(rows) < 3:
        return {"records": [], "imported": 0}

    records: list[dict[str, Any]] = []
    for row in rows[2:]:
        if not row or row[1] is None:
            continue
        serial = str(row[1]).strip()
        if not serial:
            continue
        # inspection date from day/month/year cols 6,7,8
        insp = None
        try:
            if len(row) > 8 and row[8] is not None:
                insp = jalali_to_gregorian(int(row[8]), int(row[7] or 1), int(row[6] or 1))
        except Exception:
            insp = None

        # Infer electrode kind from serial prefix
        compact = serial.upper().replace(" ", "")
        if compact.startswith(("UA", "DA", "PA", "LA", "HA")) or (compact.startswith("A") and not compact.startswith("UC")):
            kind = "anode"
        elif compact.startswith(("UC", "DC", "PC", "LC", "HC")) or compact.startswith("C"):
            kind = "cathode"
        else:
            kind = "unknown"

        install = parse_plant_date(row[4]) if len(row) > 4 else None
        dismantle = parse_plant_date(row[5]) if len(row) > 5 else None

        records.append(
            {
                "serial_nr": serial,
                "electrode_kind": kind,
                "company": str(row[2]).strip() if len(row) > 2 and row[2] else None,
                "service_life": str(row[3]).strip() if len(row) > 3 and row[3] else None,
                "install_date": install.isoformat() if install else None,
                "dismantle_date": dismantle.isoformat() if dismantle else None,
                "inspection_date": insp.isoformat() if insp else None,
                "xrf": str(row[9]).strip() if len(row) > 9 and row[9] else None,
                "voltage_quality": str(row[10]).strip() if len(row) > 10 and row[10] else None,
                "warranty": str(row[11]).strip() if len(row) > 11 and row[11] else None,
                "coating_quality": str(row[12]).strip() if len(row) > 12 and row[12] else None,
                "decision": str(row[13]).strip() if len(row) > 13 and row[13] else None,
                "problems": str(row[14]).strip() if len(row) > 14 and row[14] else None,
                "segregation": str(row[15]).strip() if len(row) > 15 and row[15] else None,
                "pallet": str(row[16]).strip() if len(row) > 16 and row[16] else None,
            }
        )

    return {"records": records, "imported": len(records), "sheet": name}
