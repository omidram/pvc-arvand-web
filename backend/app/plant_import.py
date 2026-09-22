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
            if ym:
                try:
                    return jalali_to_gregorian(int(ym.group(0)), mo, 1)
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
# 1) SiteMan / F2 voltage Excel
# ---------------------------------------------------------------------------

_CELL_RE = re.compile(r"^(?P<el>[A-Za-z]+\d*)-(?P<pos>\d{1,3})\b")
_EL_RE = re.compile(r"^(?P<el>[A-Za-z]+\d*)\[", re.I)


def parse_voltage_excel(content: bytes) -> dict[str, Any]:
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
    if rows and rows[0] and rows[0][0] is not None:
        reading_date = parse_plant_date(rows[0][0])

    header_idx = None
    time_cols: dict[int, str] = {}
    for i, row in enumerate(rows):
        vals = [str(c).strip() if c is not None else "" for c in row]
        if "Parameter" in vals or "parameter" in [v.lower() for v in vals]:
            header_idx = i
            for j, v in enumerate(vals):
                if re.match(r"^\d{1,2}:\d{2}$", v):
                    time_cols[j] = v
            break

    if header_idx is None:
        return {"error": "Header row with Parameter / time columns not found", "readings": [], "totals": {}}

    electrolyzer = None
    readings: list[dict[str, Any]] = []
    totals: dict[str, Any] = {}
    operators: set[str] = set()

    for row in rows[header_idx + 1 :]:
        if not row or all(c is None or str(c).strip() == "" for c in row):
            continue
        equipment = str(row[0]).strip() if row[0] is not None else ""
        parameter = str(row[1]).strip() if len(row) > 1 and row[1] is not None else ""
        if not parameter or parameter.lower() == "parameter":
            continue

        if not electrolyzer:
            m_el = _EL_RE.match(equipment) or _EL_RE.match(parameter)
            if m_el:
                electrolyzer = m_el.group("el").upper()

        # Extract operator from SiteMan-style cells
        for j in time_cols:
            raw = row[j] if j < len(row) else None
            if isinstance(raw, str) and "\n" in raw:
                op = raw.split("\n", 1)[1].strip()
                if op:
                    operators.add(op)

        cell_m = _CELL_RE.match(parameter)
        if cell_m:
            pos = str(int(cell_m.group("pos")))  # normalize 001 → 1 display? keep zero-pad from source
            pos = cell_m.group("pos")  # keep as in file e.g. 001
            el = cell_m.group("el").upper()
            electrolyzer = electrolyzer or el
            for j, tlabel in time_cols.items():
                raw = row[j] if j < len(row) else None
                voltage = parse_float_plant(raw)
                if voltage is None:
                    continue
                # skip absurd totals mistaken as cells
                if voltage > 20:
                    continue
                readings.append(
                    {
                        "electrolyzer": el,
                        "position": pos.lstrip("0") or "0",
                        "element_nr": f"{el}-{pos}",
                        "time": tlabel,
                        "voltage": voltage,
                        "date": reading_date.isoformat() if reading_date else None,
                    }
                )
            continue

        # Aggregate / plant rows
        key = parameter.lower()
        for j, tlabel in time_cols.items():
            raw = row[j] if j < len(row) else None
            voltage = parse_float_plant(raw)
            if voltage is None:
                continue
            if "electrolyzer voltage" in key or "totale voltage" in key or "total voltage" in key:
                totals.setdefault(tlabel, {})
                if "rack a" in key:
                    totals[tlabel]["rack_a"] = voltage
                elif "rack b" in key:
                    totals[tlabel]["rack_b"] = voltage
                else:
                    totals[tlabel]["total"] = voltage
            elif "anolyte temperature" in key:
                totals.setdefault(tlabel, {})["anolyte_temp"] = voltage
            elif "catholyte temperature" in key:
                totals.setdefault(tlabel, {})["catholyte_temp"] = voltage
            elif "catholyte concentration" in key:
                totals.setdefault(tlabel, {})["catholyte_conc"] = voltage
            elif key.startswith("load "):
                totals.setdefault(tlabel, {})["load"] = voltage

    return {
        "sheet": preferred,
        "electrolyzer": electrolyzer,
        "reading_date": reading_date.isoformat() if reading_date else None,
        "operators": sorted(operators),
        "readings": readings,
        "totals": totals,
        "imported_cells": len(readings),
    }


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
    y, m, d = row[year_i] if year_i < len(row) else None, row[month_i] if month_i < len(row) else None, row[day_i] if day_i < len(row) else None
    if y is None:
        return None
    try:
        yi, mi, di = int(y), int(m or 1), int(d or 1)
        if yi < 1600:
            return jalali_to_gregorian(yi, mi, di)
        return date(yi, mi, di)
    except Exception:
        return parse_plant_date(f"{y}/{m}/{d}")


def parse_assembly_excel(content: bytes) -> dict[str, Any]:
    wb = load_workbook(BytesIO(content), data_only=True, read_only=True)
    # Main sheet is first
    ws = wb[wb.sheetnames[0]]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    if len(rows) < 3:
        return {"elements": [], "imported": 0, "error": "Empty workbook"}

    # Column layout from analyzed file (0-based, with leading empty col):
    # 1 row#, 2 anode, 3 cathode, 4 membrane type, 5 use N/N1/N2, 6 membrane code,
    # 7 status/source, 8 element_nr, 9/10/11 assembly d/m/y, 12 work order,
    # 13 electrolyzer, 14 position, 16/17/18 install d/m/y, 20 service status,
    # 21 dismantle date, 22 remarks
    elements: list[dict[str, Any]] = []
    for row in rows[2:]:
        if not row or len(row) < 9:
            continue
        anode = str(row[2]).strip() if row[2] else ""
        cathode = str(row[3]).strip() if len(row) > 3 and row[3] else ""
        element_nr = str(row[8]).strip() if len(row) > 8 and row[8] else ""
        if not anode and not cathode and not element_nr:
            continue
        membrane_type = str(row[4]).strip() if len(row) > 4 and row[4] else None
        membrane_use = str(row[5]).strip() if len(row) > 5 and row[5] else None
        membrane_nr = str(row[6]).strip() if len(row) > 6 and row[6] else None
        source_status = str(row[7]).strip() if len(row) > 7 and row[7] else None
        assembly_date = _ymd_from_row(row, 9, 10, 11)
        electrolyzer = str(row[13]).strip().upper() if len(row) > 13 and row[13] else None
        position = str(row[14]).strip() if len(row) > 14 and row[14] else None
        install_date = _ymd_from_row(row, 16, 17, 18)
        service_status = str(row[20]).strip() if len(row) > 20 and row[20] else None
        dismantle = parse_plant_date(row[21]) if len(row) > 21 else None
        remarks = str(row[22]).strip() if len(row) > 22 and row[22] else None

        membrane_info_parts = []
        if membrane_use:
            membrane_info_parts.append(f"use={membrane_use}")
        if source_status:
            membrane_info_parts.append(f"source={source_status}")
        if service_status:
            membrane_info_parts.append(f"site={service_status}")

        elements.append(
            {
                "element_nr": element_nr or None,
                "anode_nr": anode or None,
                "cathode_nr": cathode or None,
                "membrane_type": membrane_type,
                "membrane_nr": membrane_nr if membrane_nr not in {"―", "-", "XXXXX"} else None,
                "membrane_info": "; ".join(membrane_info_parts) or None,
                "electrolyzer": electrolyzer,
                "position": position,
                "assembly_date": assembly_date.isoformat() if assembly_date else None,
                "commissioning_date": install_date.isoformat() if install_date else None,
                "disassembly_date": dismantle.isoformat() if dismantle else None,
                "decommissioning_date": dismantle.isoformat() if dismantle else (
                    install_date.isoformat() if service_status and "OUT OF SERVICE" in service_status.upper() and dismantle is None else None
                ),
                "remarks": remarks,
            }
        )

    return {"elements": elements, "imported": len(elements), "sheet": "assembly"}


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
