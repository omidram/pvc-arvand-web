from datetime import datetime
from statistics import mean, pstdev

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..auth import require_any_form_access, require_form_access
from ..calculations import installation_dol
from ..database import get_db

router = APIRouter(prefix="/statistics", tags=["statistics"])


def _safe_count(db: Session, model) -> int:
    try:
        return db.query(model).count()
    except Exception:
        return 0


def _stats(values: list[float]) -> dict:
    clean = [float(v) for v in values if v is not None]
    if not clean:
        return {"min": None, "max": None, "avg": None, "std": None, "count": 0}
    avg = mean(clean)
    std = pstdev(clean) if len(clean) > 1 else 0.0
    return {
        "min": round(min(clean), 3),
        "max": round(max(clean), 3),
        "avg": round(avg, 3),
        "std": round(std, 3),
        "count": len(clean),
    }


def _dol_bucket(dols: list[int]) -> dict:
    st = _stats([float(d) for d in dols])
    return {
        "number": len(dols),
        "dol": {"min": st["min"], "max": st["max"], "avg": st["avg"], "std": st["std"]},
    }


# Voltage-only roles (e.g. Inspector) still need the live voltage strip on Main Menu.
@router.get("/dashboard", dependencies=[Depends(require_any_form_access("dashboard", "voltage"))])
def dashboard(db: Session = Depends(get_db)):
    from .. import alerts_engine

    settings_row = db.query(models.PlantSettings).first()
    active_elements = db.query(models.Element).filter(models.Element.disassembly_date.is_(None)).count()
    try:
        voltage = alerts_engine.voltage_live_stats(db)
    except Exception:
        voltage = None
    return {
        "customer": settings_row.customer if settings_row else None,
        "uan": settings_row.uan if settings_row else None,
        "plant_type": settings_row.plant_type if settings_row else None,
        "counts": {
            "electrolyzers": _safe_count(db, models.Electrolyzer),
            "elements_total": _safe_count(db, models.Element),
            "elements_active": active_elements,
            "anodes": _safe_count(db, models.Anode),
            "cathodes": _safe_count(db, models.Cathode),
            "membranes": _safe_count(db, models.Membrane),
            "shutdowns": _safe_count(db, models.Shutdown),
            "inspections": _safe_count(db, models.InspectionReport),
            "analysis_samples": _safe_count(db, models.AnalysisSample),
            "voltage_readings": _safe_count(db, models.VoltageReading),
        },
        "voltage": voltage,
    }


@router.get("/dol-by-membrane-type", dependencies=[Depends(require_form_access("statistics"))])
def dol_by_membrane_type(db: Session = Depends(get_db)):
    """Access Membrane Statistics (frmStatistikMembran / DOL) layout."""
    elements = db.query(models.Element).filter(models.Element.membrane_type.isnot(None)).all()
    grouped: dict[str, dict] = {}
    for e in elements:
        key = e.membrane_type or "?"
        entry = grouped.setdefault(
            key,
            {
                "membrane_type": key,
                "total": 0,
                "without_dol": 0,
                "active_dols": [],
                "passive_dols": [],
                # Legacy chart fields
                "active": 0,
                "passive": 0,
                "total_dol_days": 0,
            },
        )
        active = e.disassembly_date is None
        entry["total"] += 1
        entry["active" if active else "passive"] += 1
        dol = installation_dol(e.assembly_date, e.commissioning_date, e.disassembly_date, e.decommissioning_date)
        if dol is None:
            entry["without_dol"] += 1
            continue
        entry["total_dol_days"] += dol
        (entry["active_dols"] if active else entry["passive_dols"]).append(dol)

    rows = []
    for entry in grouped.values():
        active_bucket = _dol_bucket(entry["active_dols"])
        passive_bucket = _dol_bucket(entry["passive_dols"])
        combined_bucket = _dol_bucket(entry["active_dols"] + entry["passive_dols"])
        rows.append(
            {
                "membrane_type": entry["membrane_type"],
                "total": entry["total"],
                "without_dol": entry["without_dol"],
                "active": active_bucket,
                "passive": passive_bucket,
                "combined": combined_bucket,
                # Keep legacy keys for any older clients
                "active_count": entry["active"],
                "passive_count": entry["passive"],
                "total_dol_days": entry["total_dol_days"],
            }
        )
    rows.sort(key=lambda r: r["membrane_type"] or "")
    return rows


@router.get("/power-consumption", dependencies=[Depends(require_form_access("statistics"))])
def power_consumption(
    electrolyzer: str | None = None,
    group: str = "electrolyzer",
    date_from: str | None = None,
    date_till: str | None = None,
    db: Session = Depends(get_db),
):
    """kWh from LogSheets load (kA) and total voltage: kWh = V × I_kA × hours."""
    from ..energy import report

    start = datetime.fromisoformat(date_from) if date_from else None
    end = datetime.fromisoformat(date_till) if date_till else None
    data = report(db, start=start, end=end, group=group)
    if electrolyzer:
        el = electrolyzer.strip().upper()
        data["rows"] = [
            row
            for row in data["rows"]
            if str(row.get("electrolyzer") or "").upper() == el or str(row.get("key") or "").upper().startswith(el)
        ]
        data["total_kwh"] = round(sum(row["energy_kwh"] for row in data["rows"]), 1)
    return data


def _el_aliases(name: str | None) -> set[str]:
    if not name:
        return set()
    n = str(name).strip().upper()
    if not n:
        return set()
    aliases = {n}
    letters = "".join(c for c in n if c.isalpha())
    digits = "".join(c for c in n if c.isdigit())
    if letters and digits:
        aliases.add(f"{letters}{digits}")
        aliases.add(f"{digits}{letters}")
    return aliases


def _canonical_electrolyzer(name: str | None, master: dict[str, str]) -> str | None:
    """Map A2/2A style names onto the plant Electrolyzer master list when possible."""
    aliases = _el_aliases(name)
    if not aliases:
        return None
    for alias in aliases:
        if alias in master:
            return master[alias]
    # Prefer digit+letter (1A) over letter+digit (A1)
    for alias in aliases:
        if len(alias) >= 2 and alias[0].isdigit() and alias[-1].isalpha():
            return alias
    return next(iter(aliases))


def _plausible_cell_un(total_voltage: float | None, element_count: int | None) -> float | None:
    """Access Un ≈ U_gesamt / Elementzahl — skip corrupted counts that explode Un."""
    if total_voltage is None:
        return None
    tv = float(total_voltage)
    # Already a per-cell voltage
    if 1.2 <= tv <= 5.5:
        return tv
    if element_count and element_count > 0:
        un = tv / float(element_count)
        if 1.2 <= un <= 5.5:
            return un
        # Stack voltage with bad element_count (e.g. 524 V / 1) → use typical Uhde count
        if tv >= 50 and element_count < 80:
            un2 = tv / 163.0
            if 1.2 <= un2 <= 5.5:
                return un2
    return None


@router.get("/average-power", dependencies=[Depends(require_form_access("statistics"))])
def average_power(
    date_from: str | None = Query(default=None),
    date_till: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Access Average Power Consumption form: i / Un / CE / SPC per electrolyzer."""
    masters = db.query(models.Electrolyzer).order_by(models.Electrolyzer.nr).all()
    master_map: dict[str, str] = {}
    ordered_names: list[str] = []
    for el in masters:
        name = (el.name or str(el.nr) or "").strip()
        if not name:
            continue
        ordered_names.append(name)
        for alias in _el_aliases(name):
            master_map[alias] = name

    q = db.query(models.ElectrolyzerNormalization).filter(models.ElectrolyzerNormalization.electrolyzer.isnot(None))
    start = datetime.fromisoformat(date_from) if date_from else None
    end = datetime.fromisoformat(date_till) if date_till else None
    if start:
        q = q.filter(models.ElectrolyzerNormalization.date >= start)
    if end:
        q = q.filter(models.ElectrolyzerNormalization.date <= end)

    by_el: dict[str, dict[str, list[float]]] = {name: {"i": [], "un": [], "ce": [], "spc": []} for name in ordered_names}
    for row in q.all():
        el = _canonical_electrolyzer(row.electrolyzer, master_map)
        if not el:
            continue
        bucket = by_el.setdefault(el, {"i": [], "un": [], "ce": [], "spc": []})
        i_val = row.reference_current_density
        if i_val is None and row.total_current is not None:
            # Access Cc fallback: plant active area ≈ 2.7 m² bipolar stack reference
            i_val = row.total_current / 2.7
        if i_val is not None and 0.1 <= float(i_val) <= 20:
            bucket["i"].append(float(i_val))
        un = _plausible_cell_un(row.total_voltage, row.element_count)
        if un is not None:
            bucket["un"].append(un)

    ce_rows = db.query(models.CurrentEfficiencyEntry).filter(
        models.CurrentEfficiencyEntry.scope == "electrolyzer",
        models.CurrentEfficiencyEntry.value_pct.isnot(None),
    )
    if start:
        ce_rows = ce_rows.filter(models.CurrentEfficiencyEntry.date >= start)
    if end:
        ce_rows = ce_rows.filter(models.CurrentEfficiencyEntry.date <= end)
    for ce in ce_rows.all():
        el = _canonical_electrolyzer(ce.scope_ref, master_map)
        if not el or el not in by_el or ce.value_pct is None:
            continue
        if 0 < float(ce.value_pct) <= 120:
            by_el[el]["ce"].append(float(ce.value_pct))

    # SPC [kWh/t NaOH] ≈ Un * 1000 / (1.492 * CE/100)
    for el, bucket in by_el.items():
        if bucket["un"] and bucket["ce"]:
            avg_un = mean(bucket["un"])
            avg_ce = mean(bucket["ce"])
            if avg_ce:
                bucket["spc"].append((avg_un * 1000.0) / (1.492 * (avg_ce / 100.0)))

    display_order = ordered_names + [name for name in sorted(by_el.keys()) if name not in ordered_names]
    rows = []
    plant_avgs = {"i": [], "un": [], "ce": [], "spc": []}
    for el in display_order:
        bucket = by_el.get(el) or {"i": [], "un": [], "ce": [], "spc": []}
        i_st = _stats(bucket["i"])
        un_st = _stats(bucket["un"])
        ce_st = _stats(bucket["ce"])
        spc_st = _stats(bucket["spc"])
        records = max(i_st["count"], un_st["count"], ce_st["count"])
        rows.append(
            {
                "electrolyzer": el,
                "records": records,
                "i": i_st,
                "un": un_st,
                "ce": ce_st,
                "spc": spc_st,
            }
        )
        if i_st["avg"] is not None:
            plant_avgs["i"].append(i_st["avg"])
        if un_st["avg"] is not None:
            plant_avgs["un"].append(un_st["avg"])
        if ce_st["avg"] is not None:
            plant_avgs["ce"].append(ce_st["avg"])
        if spc_st["avg"] is not None:
            plant_avgs["spc"].append(spc_st["avg"])

    def plant_block(key: str) -> dict:
        vals = plant_avgs[key]
        if not vals:
            return {"avg": None, "std": None}
        return {
            "avg": round(mean(vals), 3),
            "std": round(pstdev(vals), 3) if len(vals) > 1 else 0.0,
        }

    return {
        "date_from": date_from,
        "date_till": date_till,
        "basis": "Basis: Table Un Electrolyzers, CE from Anodic Balance Electrolyzers",
        "rows": rows,
        "plant_total": {
            "i": plant_block("i"),
            "un": plant_block("un"),
            "ce": plant_block("ce"),
            "spc": plant_block("spc"),
        },
    }


@router.get("/groups", dependencies=[Depends(require_form_access("statistics"))])
def group_statistics(db: Session = Depends(get_db)):
    rows = (
        db.query(models.Element.group_nr, func.count(models.Element.id))
        .filter(models.Element.group_nr.isnot(None))
        .group_by(models.Element.group_nr)
        .all()
    )
    definitions = {d.group_nr: d for d in db.query(models.GroupDefinition).all()}
    result = []
    for group_nr, count in rows:
        d = definitions.get(group_nr)
        result.append(
            {
                "group_nr": group_nr,
                "element_count": count,
                "anode_coating": d.anode_coating if d else None,
                "cathode_coating": d.cathode_coating if d else None,
                "membrane_type": d.membrane_type if d else None,
                "gap_mm": d.gap_mm if d else None,
            }
        )
    return result


def _el_aliases(name: str | None) -> set[str]:
    if not name:
        return set()
    n = str(name).strip().upper()
    if not n:
        return set()
    aliases = {n}
    letters = "".join(c for c in n if c.isalpha())
    digits = "".join(c for c in n if c.isdigit())
    if letters and digits:
        aliases.add(f"{letters}{digits}")
        aliases.add(f"{digits}{letters}")
    return aliases


def _parse_stat_day(value):
    from datetime import date as date_cls

    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date_cls):
        return value
    text = str(value).strip()
    if not text:
        return None
    if "T" in text:
        text = text.split("T", 1)[0]
    if " " in text:
        text = text.split(" ", 1)[0]
    try:
        return date_cls.fromisoformat(text[:10])
    except ValueError:
        return None


def _reading_un(row: models.VoltageReading) -> float | None:
    if row.standardized_voltage is not None:
        return float(row.standardized_voltage)
    if row.voltage is not None:
        return float(row.voltage)
    return None


@router.get("/group-voltages", dependencies=[Depends(require_form_access("statistics"))])
def group_voltages(
    mode: str = Query("avg-date", description="avg-date | by-date | avg-el-date"),
    date: str | None = None,
    electrolyzer: str | None = None,
    db: Session = Depends(get_db),
):
    """Access Statistics → Groups (Uhde manual):

    - avg-date: Group Avg. Sel. by Date — Un average per group for one day
    - by-date: Group Sel. by Date — Un average per group × electrolyzer
    - avg-el-date: Group Avg. Sel. by El. and Date — Un avg per group for one electrolyzer
    """
    from ..plant_topology import format_electrolyzer_name

    mode_key = (mode or "avg-date").strip().lower()
    if mode_key not in {"avg-date", "by-date", "avg-el-date"}:
        mode_key = "avg-date"

    value_ok = (
        models.VoltageReading.standardized_voltage.isnot(None)
        | models.VoltageReading.voltage.isnot(None)
    )
    day = _parse_stat_day(date)
    if day is None:
        latest = db.query(func.max(models.VoltageReading.date)).filter(value_ok).scalar()
        day = _parse_stat_day(latest)

    empty = {
        "mode": mode_key,
        "date": day.isoformat() if day else None,
        "electrolyzer": electrolyzer,
        "rows": [],
    }
    if day is None:
        return empty

    day_text = day.isoformat()
    # Prefer SQL date filter; fall back to Python if dialect returns nothing.
    readings = (
        db.query(models.VoltageReading)
        .filter(value_ok)
        .filter(func.date(models.VoltageReading.date) == day_text)
        .all()
    )
    if not readings:
        readings = [
            row
            for row in db.query(models.VoltageReading).filter(value_ok).limit(500000).all()
            if _parse_stat_day(row.date) == day
        ]

    el_filter = _el_aliases(electrolyzer) if mode_key == "avg-el-date" else set()
    if mode_key == "avg-el-date" and el_filter:
        readings = [r for r in readings if (r.electrolyzer or "").strip().upper() in el_filter]

    # Map element_nr and electrolyzer+position → group
    elements = (
        db.query(models.Element)
        .filter(models.Element.group_nr.isnot(None), models.Element.group_nr != "")
        .all()
    )
    by_nr: dict[str, models.Element] = {}
    by_el_pos: dict[tuple[str, str], models.Element] = {}
    for el in elements:
        if el.element_nr:
            by_nr[str(el.element_nr).strip().upper()] = el
        for alias in _el_aliases(el.electrolyzer):
            by_el_pos[(alias, str(el.position or "").strip())] = el

    definitions = {d.group_nr: d for d in db.query(models.GroupDefinition).all()}

    # Accumulate Un values keyed by aggregation level
    buckets: dict[tuple, list[float]] = {}
    for row in readings:
        un = _reading_un(row)
        if un is None:
            continue
        el = None
        if row.element_nr:
            el = by_nr.get(str(row.element_nr).strip().upper())
        if el is None:
            pos = str(row.position or "").strip()
            for alias in _el_aliases(row.electrolyzer):
                el = by_el_pos.get((alias, pos))
                if el:
                    break
        if el is None or not el.group_nr:
            continue
        group_nr = str(el.group_nr).strip()
        el_name = (row.electrolyzer or el.electrolyzer or "").strip()
        el_disp = format_electrolyzer_name(el_name) or el_name
        if mode_key == "by-date":
            key = (group_nr, el_disp)
        else:
            key = (group_nr,)
        buckets.setdefault(key, []).append(un)

    out_rows = []
    for key, values in buckets.items():
        group_nr = key[0]
        d = definitions.get(group_nr)
        st = _stats(values)
        item = {
            "group_nr": group_nr,
            "electrolyzer": key[1] if mode_key == "by-date" else (format_electrolyzer_name(electrolyzer) if mode_key == "avg-el-date" else None),
            "readings": st["count"],
            "un_min": st["min"],
            "un_max": st["max"],
            "un_avg": st["avg"],
            "un_std": st["std"],
            "anode_coating": d.anode_coating if d else None,
            "cathode_coating": d.cathode_coating if d else None,
            "membrane_type": d.membrane_type if d else None,
            "gap_mm": d.gap_mm if d else None,
        }
        out_rows.append(item)

    out_rows.sort(key=lambda r: (str(r["group_nr"]), str(r.get("electrolyzer") or "")))
    return {
        "mode": mode_key,
        "date": day_text,
        "electrolyzer": format_electrolyzer_name(electrolyzer) if electrolyzer else None,
        "rows": out_rows,
    }

