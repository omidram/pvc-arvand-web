"""Cathodic (NaOH) current efficiency for Train 1 and Train 2.

The sheet is the plant workbook "فرمت خام محاسبه بازده کاتدیک".
Yellow hour cells (08:00, 16:00, 24:00) are the three daily readings from the
instrument guide. Every other hour column is optional. Column J and the
result block are the workbook formulas, unchanged.

Instrument tags for production, temperature and concentration on Train 2 come
from the guide (the Train 2 workbook is a copy and still shows the Train 1 tags).
"""
from __future__ import annotations

from typing import Any

LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M"]
HOURS = ["08:00", "16:00", "24:00"]
YELLOW_HOURS = HOURS

AREA_M2 = 2.72
ELEMENTS = 163
FARADAY = 1.4923

# Word guide, in electrolyzer order A … M (I is not used).
_EI = {
    1: [
        "41EI811106",
        "41EI0812101",
        "41EI0811301",
        "41EI0811401",
        "41EI0811501",
        "41EI0811601",
        "41EI0811701",
        "41EI0811801",
        "41EI0811901",
        "41EI0812001",
        "41EI0812101",
        "41EI0812201",
    ],
    2: [
        "41EI821106",
        "41EI0822101",
        "41EI0821301",
        "41EI0821401",
        "41EI0821501",
        "41EI0821601",
        "41EI0821701",
        "41EI0821801",
        "41EI0821901",
        "41EI0822001",
        "41EI0822101",
        "41EI0822201",
    ],
}


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def _avg(hour_map: dict | None, hours: list[str]) -> float | None:
    """Excel ``SUM(range)/COUNT(range)``. Empty range is a division error."""
    values = []
    for hour in hours:
        number = _num((hour_map or {}).get(hour))
        if number is not None:
            values.append(number)
    if not values:
        return None
    return sum(values) / len(values)


def _div(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def train_tags(train: int) -> dict[str, str]:
    production = "41FQ3110201" if train == 1 else "41FQ3120201"
    temperature = "41TI3110103" if train == 1 else "41TI3120103"
    concentration = "41FY3110201" if train == 1 else "41FY3120201"
    return {"production": production, "temperature": temperature, "concentration": concentration}


def sheet_rows(train: int) -> list[dict[str, str]]:
    tags = train_tags(train)
    rows: list[dict[str, str]] = []
    for index, letter in enumerate(LETTERS):
        unit = 11 + index
        rows.append(
            {
                "code": f"L{letter}",
                "kind": "load",
                "letter": letter,
                "label": f"A.L.{letter}",
                "description": f"Avg. Load Rectifier {letter} (KA),41II08{train}{unit}01",
                "tag": f"41II08{train}{unit}01",
            }
        )
    for index, letter in enumerate(LETTERS):
        rows.append(
            {
                "code": f"V{letter}",
                "kind": "voltage",
                "letter": letter,
                "label": f"A.V.{letter}",
                "description": f"Avg. Total Voltage Electrolyzer {letter}(V),Measured at Electrolyzer Terminals",
                "tag": _EI[train][index],
            }
        )
    rows.append(
        {
            "code": "TEMP",
            "kind": "temp",
            "letter": "",
            "label": "A.T",
            "description": f"NaOH Average temperature(°C), {tags['temperature']}",
            "tag": tags["temperature"],
        }
    )
    rows.append(
        {
            "code": "CONC",
            "kind": "conc",
            "letter": "",
            "label": "A.Conc.",
            "description": f"NaOH Average Concentration(Wt %), {tags['concentration']}",
            "tag": tags["concentration"],
        }
    )
    return rows


def displays(train: int) -> list[dict[str, str]]:
    """Instruments the guide says must be read, and how often."""
    tags = train_tags(train)
    rows = sheet_rows(train)
    out = [{"tag": tags["production"], "how_often": "1 per day", "what": "NaOH production"}]
    for row in rows:
        if row["kind"] == "load":
            out.append({"tag": row["tag"], "how_often": "3 times per day", "what": row["label"]})
    out.append({"tag": tags["temperature"], "how_often": "3 times per day", "what": "NaOH temperature"})
    out.append({"tag": tags["concentration"], "how_often": "3 times per day", "what": "NaOH concentration"})
    for row in rows:
        if row["kind"] == "voltage":
            out.append({"tag": row["tag"], "how_often": "3 times per day", "what": row["label"]})
    return out


def calculate(
    train: int,
    readings: dict | None,
    online: dict | None,
    initial_reading: Any,
    final_reading: Any,
    test_hours: Any,
) -> dict[str, Any]:
    """Same formulas as blank (4), using only 08:00, 16:00 and 24:00.

    An electrolyzer is on when its load row (the first block) has a number,
    and off when that row is empty. Off units are left out of the sums and
    out of COUNT(on/off).
    """
    del online  # on/off is derived from the load readings
    rows = sheet_rows(train)
    readings = readings or {}
    averages: dict[str, float | None] = {}
    for row in rows:
        averages[row["code"]] = _avg(readings.get(row["code"]), HOURS)

    on_letters = [
        row["letter"]
        for row in rows
        if row["kind"] == "load" and averages[row["code"]] is not None
    ]
    on_count = len(on_letters)
    count = float(on_count) if on_count else None
    missing = [
        row["code"]
        for row in rows
        if row["kind"] == "voltage" and row["letter"] in on_letters and averages[row["code"]] is None
    ]
    if on_letters and averages.get("TEMP") is None:
        missing.append("TEMP")

    sum_loads = sum(averages[f"L{letter}"] or 0 for letter in on_letters) if on_letters else None
    volts_ok = all(averages[f"V{letter}"] is not None for letter in on_letters)
    sum_volts = sum(averages[f"V{letter}"] or 0 for letter in on_letters) if on_letters and volts_ok else None

    j30 = _div(sum_loads, None if count is None else AREA_M2 * count)
    j33 = _div(sum_volts, count)
    j34 = _div(j33, float(ELEMENTS))
    j35 = _div(sum_loads, count)
    j28 = averages.get("TEMP")
    j2 = _num(initial_reading)
    j3 = _num(final_reading)
    j31 = _num(test_hours)
    j37 = _div(None if j2 is None or j3 is None else (j3 - j2) * 24, j31)

    q32 = None if j30 is None else (0.1265 * j30 + 2.4) * 1000 / (FARADAY * 0.95)
    q33 = None
    if j33 is not None and count is not None and j35 is not None and j37 is not None:
        q33 = _div(j33 * count * j35 * 24, j37)
    q34 = None
    if q33 is not None and j28 is not None and j30 is not None:
        q34 = q33 - ((90 - j28) * 7 * j30 / 3)
    q35 = None if q32 is None or q34 is None else _div(q32, q34)
    if q35 is not None:
        q35 *= 100
    q37 = None
    if j37 is not None and j35 is not None and count is not None:
        q37 = _div(100 * j37 * 1000, j35 * 24 * FARADAY * ELEMENTS * count)
    q39 = None
    if j37 is not None and j30 is not None and count is not None:
        q39 = _div(j37 * 5.46 * 12, j30 * count)

    return {
        "averages": averages,
        "on_count": on_count,
        "missing": missing,
        "j30": j30,
        "j31": j31,
        "j33": j33,
        "j34": j34,
        "j35": j35,
        "j37": j37,
        "q32": q32,
        "q33": q33,
        "q34": q34,
        "q35": q35,
        "q37": q37,
        "q39": q39,
    }
