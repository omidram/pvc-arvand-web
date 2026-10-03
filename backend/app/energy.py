"""Electrical energy from ARIAORMS LogSheets load (kA) and voltage.

P_kW = V_total [V] × I [kA]   (kA × V = kW)
kWh  = P_kW × hours, where hours is the gap to the next reading (capped at 24 h).
Rack energy uses the same current (series circuit) and the rack cell-voltage sum.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

try:
    from zoneinfo import ZoneInfo

    _TEHRAN = ZoneInfo("Asia/Tehran")
except Exception:
    _TEHRAN = timezone(timedelta(hours=3, minutes=30))

# AriaORMS Excel often lands a day after the logsheet clock. Older than that is off.
LIVE_LAG_DAYS = 1

from sqlalchemy.orm import Session

from . import models
from .plant_topology import RACKS, all_electrolyzers, rack_of, train_of

_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")


def tehran_today() -> date:
    return datetime.now(_TEHRAN).date()


def tehran_now() -> datetime:
    return datetime.now(_TEHRAN).replace(tzinfo=None)


def as_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def is_live_day(value, today: date | None = None) -> bool:
    """True when AriaORMS has a sample for today (or yesterday while today's file is missing)."""
    today = today or tehran_today()
    day = as_date(value)
    if day is None:
        return False
    delta = (today - day).days
    return 0 <= delta <= LIVE_LAG_DAYS


def _time_hours(label: str | None) -> float | None:
    match = _TIME_RE.match((label or "").strip())
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return hour + minute / 60.0


def _slot_dt(day: datetime | None, time_label: str | None) -> datetime | None:
    if day is None:
        return None
    hours = _time_hours(time_label)
    if hours is None:
        return None
    midnight = datetime(day.year, day.month, day.day)
    return midnight + timedelta(hours=hours)


def _duration_hours(current: datetime, nxt: datetime | None, *, now: datetime | None = None) -> float:
    """Hours this reading stays in force.

    Closed intervals use the gap to the next sample (capped at 24 h). The latest
    sample is live power: count time until `now` only when it is already in the
    past, so a brand-new 06:00 reading does not add a second 24 h on top of
    yesterday's interval.
    """
    if nxt is not None:
        delta = (nxt - current).total_seconds() / 3600.0
        if delta <= 0:
            return 4.0
        return min(delta, 24.0)
    horizon = now or tehran_now()
    delta = (horizon - current).total_seconds() / 3600.0
    if delta < 0.25:
        return 0.0
    return min(max(delta, 0.0), 24.0)


def _overlap_hours(stamp: datetime, hours: float, since: datetime, until: datetime) -> float:
    if hours <= 0:
        return 0.0
    start = stamp
    end = stamp + timedelta(hours=hours)
    left = max(start, since)
    right = min(end, until)
    if right <= left:
        return 0.0
    return (right - left).total_seconds() / 3600.0


def _load_slots(db: Session, *, since: datetime | None = None, until: datetime | None = None) -> list[dict[str, Any]]:
    query = db.query(models.ElectrolyzerNormalization).filter(
        models.ElectrolyzerNormalization.electrolyzer.isnot(None),
        models.ElectrolyzerNormalization.total_voltage.isnot(None),
        models.ElectrolyzerNormalization.total_current.isnot(None),
        models.ElectrolyzerNormalization.total_voltage > 50,
        models.ElectrolyzerNormalization.total_current > 1,
    )
    if since is not None:
        day = datetime(since.year, since.month, since.day)
        query = query.filter(models.ElectrolyzerNormalization.date >= day)
    if until is not None:
        query = query.filter(models.ElectrolyzerNormalization.date <= until)
    rows = query.order_by(
        models.ElectrolyzerNormalization.electrolyzer.asc(),
        models.ElectrolyzerNormalization.date.asc(),
        models.ElectrolyzerNormalization.time.asc(),
    ).all()

    by_el: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        el = (row.electrolyzer or "").strip().upper()
        stamp = _slot_dt(row.date, row.time)
        if not el or stamp is None:
            continue
        voltage = float(row.total_voltage or 0)
        current = float(row.total_current or 0)
        count = int(row.element_count or 0) or None
        rack_a_avg = getattr(row, "rack_a_avg", None)
        rack_b_avg = getattr(row, "rack_b_avg", None)
        by_el[el].append(
            {
                "electrolyzer": el,
                "train": train_of(el),
                "stamp": stamp,
                "date": stamp.date().isoformat(),
                "time": row.time,
                "voltage": voltage,
                "current_ka": current,
                "element_count": count,
                "rack_a_avg": float(rack_a_avg) if rack_a_avg else None,
                "rack_b_avg": float(rack_b_avg) if rack_b_avg else None,
            }
        )

    slots: list[dict[str, Any]] = []
    for items in by_el.values():
        items.sort(key=lambda item: item["stamp"])
        for index, item in enumerate(items):
            nxt = items[index + 1]["stamp"] if index + 1 < len(items) else None
            hours = _duration_hours(item["stamp"], nxt)
            power = item["voltage"] * item["current_ka"]
            item["hours"] = hours
            item["power_kw"] = power
            item["energy_kwh"] = power * hours
            cells = item["element_count"] or 168
            share_a = 84 / cells if cells else 0.5
            if item["rack_a_avg"]:
                v_a = item["rack_a_avg"] * 84
            else:
                v_a = item["voltage"] * share_a
            if item["rack_b_avg"]:
                v_b = item["rack_b_avg"] * 84
            else:
                v_b = item["voltage"] * (1 - share_a)
            item["rack_a_kwh"] = v_a * item["current_ka"] * hours
            item["rack_b_kwh"] = v_b * item["current_ka"] * hours
            item["rack_a_kw"] = v_a * item["current_ka"]
            item["rack_b_kw"] = v_b * item["current_ka"]
            slots.append(item)
    return slots


def latest_by_electrolyzer(db: Session) -> dict[str, dict[str, Any]]:
    slots = _load_slots(db, since=datetime.utcnow() - timedelta(days=120))
    latest: dict[str, dict[str, Any]] = {}
    for item in slots:
        prev = latest.get(item["electrolyzer"])
        if prev is None or item["stamp"] > prev["stamp"]:
            latest[item["electrolyzer"]] = item
    return latest


def energy_since(db: Session, since: datetime, until: datetime | None = None) -> dict[str, dict[str, float]]:
    totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {"energy_kwh": 0.0, "hours": 0.0, "rack_a_kwh": 0.0, "rack_b_kwh": 0.0}
    )
    until = until or tehran_now()
    lookback = since - timedelta(days=2)
    for item in _load_slots(db, since=lookback, until=until):
        overlap = _overlap_hours(item["stamp"], item["hours"], since, until)
        if overlap <= 0:
            continue
        scale = overlap / item["hours"] if item["hours"] else 0.0
        bucket = totals[item["electrolyzer"]]
        bucket["energy_kwh"] += item["power_kw"] * overlap
        bucket["hours"] += overlap
        bucket["rack_a_kwh"] += item["rack_a_kwh"] * scale
        bucket["rack_b_kwh"] += item["rack_b_kwh"] * scale
    return totals


def attach_to_snapshot(db: Session, blocks: list[dict[str, Any]]) -> dict[str, Any]:
    slots = _load_slots(db, since=datetime.utcnow() - timedelta(days=120))
    latest: dict[str, dict[str, Any]] = {}
    for item in slots:
        prev = latest.get(item["electrolyzer"])
        if prev is None or item["stamp"] > prev["stamp"]:
            latest[item["electrolyzer"]] = item
    today = tehran_today()
    plant_now = tehran_now()
    t24 = plant_now - timedelta(hours=24)
    t30 = plant_now - timedelta(days=30)
    energy_24h: dict[str, dict[str, float]] = defaultdict(
        lambda: {"energy_kwh": 0.0, "rack_a_kwh": 0.0, "rack_b_kwh": 0.0}
    )
    energy_30d: dict[str, dict[str, float]] = defaultdict(
        lambda: {"energy_kwh": 0.0, "rack_a_kwh": 0.0, "rack_b_kwh": 0.0}
    )
    for item in slots:
        h24 = _overlap_hours(item["stamp"], item["hours"], t24, plant_now)
        h30 = _overlap_hours(item["stamp"], item["hours"], t30, plant_now)
        if h30 > 0 and item["hours"]:
            scale = h30 / item["hours"]
            bucket = energy_30d[item["electrolyzer"]]
            bucket["energy_kwh"] += item["power_kw"] * h30
            bucket["rack_a_kwh"] += item["rack_a_kwh"] * scale
            bucket["rack_b_kwh"] += item["rack_b_kwh"] * scale
        if h24 > 0 and item["hours"]:
            scale = h24 / item["hours"]
            bucket = energy_24h[item["electrolyzer"]]
            bucket["energy_kwh"] += item["power_kw"] * h24
            bucket["rack_a_kwh"] += item["rack_a_kwh"] * scale
            bucket["rack_b_kwh"] += item["rack_b_kwh"] * scale
    have = {(block.get("electrolyzer") or "").strip().upper() for block in blocks}
    for name in all_electrolyzers():
        if name in have:
            continue
        blocks.append(
            {
                "electrolyzer": name,
                "reading_date": None,
                "reading_time": None,
                "cell_count": 0,
                "ok_count": 0,
                "warning_count": 0,
                "danger_count": 0,
                "max_voltage": None,
                "avg_voltage": None,
                "total_voltage": None,
                "cells": [],
            }
        )

    plant_kw = 0.0
    plant_ka = 0.0
    plant_kwh_24h = 0.0
    plant_kwh_30d = 0.0
    for block in blocks:
        el = (block.get("electrolyzer") or "").strip().upper()
        live = latest.get(el) or {}
        cells = block.get("cells") or []
        live_cells = [cell for cell in cells if cell.get("live")]
        if live and not is_live_day(live.get("stamp"), today):
            live = {}
        current = live.get("current_ka")
        cell_v = block.get("total_voltage")
        logsheet_v = live.get("voltage")
        total_v = cell_v or logsheet_v
        if live.get("stamp") and not block.get("reading_date"):
            block["reading_date"] = live["stamp"]
            block["reading_time"] = live.get("time")
        power = (total_v * current) if total_v and current else None
        online = bool(live_cells) or bool(live)
        racks = []
        for rack in RACKS:
            rack_cells = [
                cell
                for cell in live_cells
                if rack_of(cell.get("position")) and rack_of(cell.get("position")).get("id") == rack["id"]
            ]
            rack_v = sum(float(cell["voltage"]) for cell in rack_cells if cell.get("voltage") is not None)
            rack_kw = (rack_v * current) if current and rack_v else None
            energy_key = "rack_a_kwh" if rack["id"] == "1" else "rack_b_kwh"
            racks.append(
                {
                    "id": rack["id"],
                    "start": rack["start"],
                    "end": rack["end"],
                    "cell_count": len(rack_cells),
                    "total_voltage": round(rack_v, 3) if rack_v else None,
                    "avg_voltage": round(rack_v / len(rack_cells), 4) if rack_cells and rack_v else None,
                    "power_kw": round(rack_kw, 2) if rack_kw is not None else None,
                    "energy_kwh_24h": round((energy_24h.get(el) or {}).get(energy_key) or 0.0, 1) if live else None,
                    "energy_kwh_30d": round((energy_30d.get(el) or {}).get(energy_key) or 0.0, 1) if live else None,
                }
            )
        kwh_24h = ((energy_24h.get(el) or {}).get("energy_kwh") or 0.0) if live else 0.0
        kwh_30d = ((energy_30d.get(el) or {}).get("energy_kwh") or 0.0) if live else 0.0
        block["online"] = online
        block["current_ka"] = round(current, 3) if current else None
        block["power_kw"] = round(power, 2) if power is not None else None
        block["energy_kwh_24h"] = round(kwh_24h, 1) if live else None
        block["energy_kwh_30d"] = round(kwh_30d, 1) if live else None
        block["racks"] = racks
        if online and power:
            plant_kw += power
        if online and current:
            plant_ka += current
        if online:
            plant_kwh_24h += kwh_24h
            plant_kwh_30d += kwh_30d

    return {
        "current_ka": round(plant_ka, 3) if plant_ka else None,
        "power_kw": round(plant_kw, 1) if plant_kw else None,
        "energy_kwh_24h": round(plant_kwh_24h, 1),
        "energy_kwh_30d": round(plant_kwh_30d, 1),
    }


def plant_timeseries(
    db: Session,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    scope: str = "plant",
    electrolyzer: str | None = None,
    train: str | None = None,
    limit: int = 500,
) -> dict[str, Any]:
    """Time series of voltage / current / power for plant, train, or one electrolyzer."""
    since = start or (datetime.utcnow() - timedelta(days=30))
    until = end
    slots = _load_slots(db, since=since - timedelta(days=1), until=until)
    scope_key = (scope or "plant").strip().lower()
    el_filter = (electrolyzer or "").strip().upper() or None
    train_filter = (train or "").strip() or None
    if train_filter and train_filter[-1] in {"1", "2"}:
        train_filter = train_filter[-1]

    filtered: list[dict[str, Any]] = []
    for item in slots:
        if el_filter and item["electrolyzer"] != el_filter:
            continue
        if train_filter and str(item.get("train") or "") != train_filter:
            continue
        if scope_key == "electrolyzer" and not el_filter:
            continue
        if scope_key == "train" and not train_filter and not el_filter:
            continue
        if until is not None and item["stamp"] > until:
            continue
        if item["stamp"] < since:
            continue
        filtered.append(item)

    buckets: dict[str, dict[str, Any]] = {}
    for item in filtered:
        key = f"{item['date']}|{(item.get('time') or '').strip()}"
        bucket = buckets.setdefault(
            key,
            {
                "date": item["date"],
                "time": item.get("time"),
                "stamp": item["stamp"],
                "voltage_sum": 0.0,
                "current_ka": 0.0,
                "power_kw": 0.0,
                "count": 0,
            },
        )
        bucket["voltage_sum"] += float(item["voltage"] or 0)
        bucket["current_ka"] += float(item["current_ka"] or 0)
        bucket["power_kw"] += float(item["power_kw"] or 0)
        bucket["count"] += 1

    points = []
    for bucket in sorted(buckets.values(), key=lambda row: row["stamp"]):
        count = bucket["count"] or 1
        points.append(
            {
                "date": bucket["date"],
                "time": bucket["time"],
                "voltage": round(bucket["voltage_sum"] / count, 3),
                "voltage_sum": round(bucket["voltage_sum"], 2),
                "current_ka": round(bucket["current_ka"], 3),
                "power_kw": round(bucket["power_kw"], 2),
                "electrolyzers": count,
            }
        )

    total = len(points)
    if total > limit and limit >= 2:
        step = (total - 1) / (limit - 1)
        points = [points[round(i * step)] for i in range(limit)]

    title = "Plant"
    if scope_key == "electrolyzer" and el_filter:
        title = el_filter
    elif scope_key == "train" and train_filter:
        title = f"Train {train_filter}"
    elif el_filter:
        title = el_filter

    return {
        "scope": scope_key,
        "title": title,
        "electrolyzer": el_filter,
        "train": train_filter,
        "date_from": since.date().isoformat(),
        "date_to": (until.date().isoformat() if until else datetime.utcnow().date().isoformat()),
        "total": total,
        "points": points,
    }


def report(
    db: Session,
    *,
    start: datetime | None,
    end: datetime | None,
    group: str = "electrolyzer",
) -> dict[str, Any]:
    """Aggregate kWh for the Power Consumption form."""
    since = start or (datetime.utcnow() - timedelta(days=730))
    until = end
    slots = _load_slots(db, since=since, until=until)
    grouped: dict[str, dict[str, Any]] = {}
    kind = (group or "electrolyzer").strip().lower()
    for item in slots:
        if kind == "plant":
            key = "plant"
        elif kind == "train":
            key = f"Train {item['train']}" if item["train"] else "—"
        elif kind == "rack":
            train = item["train"] or "?"
            el = item["electrolyzer"]
            for rack_id, energy in (("1", item["rack_a_kwh"]), ("2", item["rack_b_kwh"])):
                rack_key = f"{el} rack {rack_id}"
                bucket = grouped.setdefault(
                    rack_key,
                    {
                        "key": rack_key,
                        "train": train,
                        "electrolyzer": el,
                        "rack": rack_id,
                        "energy_kwh": 0.0,
                        "hours": 0.0,
                        "samples": 0,
                    },
                )
                bucket["energy_kwh"] += energy
                bucket["hours"] += item["hours"]
                bucket["samples"] += 1
                bucket["current_ka"] = item["current_ka"]
                bucket["voltage"] = item["voltage"]
                bucket["power_kw"] = item["power_kw"]
            continue
        else:
            key = item["electrolyzer"]
        bucket = grouped.setdefault(
            key,
            {
                "key": key,
                "train": item["train"] if kind != "plant" else None,
                "electrolyzer": item["electrolyzer"] if kind == "electrolyzer" else None,
                "energy_kwh": 0.0,
                "hours": 0.0,
                "samples": 0,
            },
        )
        bucket["energy_kwh"] += item["energy_kwh"]
        bucket["hours"] += item["hours"]
        bucket["samples"] += 1
        bucket["current_ka"] = item["current_ka"]
        bucket["voltage"] = item["voltage"]
        bucket["power_kw"] = item["power_kw"]

    rows = []
    for bucket in grouped.values():
        rows.append(
            {
                **bucket,
                "energy_kwh": round(bucket["energy_kwh"], 1),
                "hours": round(bucket["hours"], 2),
                "avg_kw": round(bucket["energy_kwh"] / bucket["hours"], 2) if bucket["hours"] else None,
            }
        )
    rows.sort(key=lambda row: (str(row.get("train") or ""), str(row.get("key") or "")))
    return {
        "from": since.date().isoformat(),
        "till": (until.date().isoformat() if until else datetime.utcnow().date().isoformat()),
        "group": kind,
        "formula": "kWh = V_total × I_kA × hours  (Load A from LogSheets; hours = interval to next reading, max 24 h)",
        "total_kwh": round(sum(row["energy_kwh"] for row in rows), 1),
        "rows": rows,
    }
