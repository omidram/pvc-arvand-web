"""Cell Health Index + peer comparison for chlor-alkali membrane cells.

Uses live AriaORMS voltage/normalization plus lab analyses when present.
Scores emphasize Trend and peer deviation over absolute calendar life.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from statistics import median
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import alerts_engine, models
from .warehouse import dol_for_element, load_shutdown_windows
from .plant_topology import arrangement_name, train_of

# Soft operating envelopes (engineering guidance — not OEM trip limits).
TEMP_WARN = (80.0, 92.0)
TEMP_DANGER = (75.0, 95.0)
NAOH_WARN = (30.0, 34.0)
DELTA_P_WARN = 50.0  # mbar-scale if populated; treated as relative flag when large
VOLTAGE_PEER_WATCH = 0.05  # V above electrolyzer median
VOLTAGE_PEER_INVESTIGATE = 0.10
VOLTAGE_PEER_CRITICAL = 0.18
TREND_WATCH_MV_DAY = 0.4  # mV/day rising
TREND_INVESTIGATE_MV_DAY = 1.0
BRINE_SOFT_LIMITS = {
    "Ca+Mg": 20.0,  # ppb-scale typical; treat as hard flag if exceeded
    "Fe": 50.0,
    "Al": 50.0,
    "SiO2": 500.0,
    "Na2SO4": 8.0,  # g/L-ish depending on lab units — flag if present & high
    "Organics": 1.0,
}


def _as_date(value: date | datetime | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _status_from_score(score: float | None) -> str:
    if score is None:
        return "unknown"
    if score >= 80:
        return "ok"
    if score >= 60:
        return "watch"
    if score >= 40:
        return "investigate"
    return "critical"


TREND_MIN_POINTS = 8
TREND_MIN_SPAN_DAYS = 14


def _linear_slope_mv_per_day(points: list[tuple[date, float]]) -> tuple[float, float] | None:
    """Least-squares slope of voltage vs day and its standard error, both in mV/day."""
    if len(points) < TREND_MIN_POINTS:
        return None
    points = sorted(points, key=lambda item: item[0])
    t0 = points[0][0].toordinal()
    xs = [p[0].toordinal() - t0 for p in points]
    if xs[-1] < TREND_MIN_SPAN_DAYS:
        return None
    ys = [p[1] for p in points]
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    denom = sum((x - mean_x) ** 2 for x in xs)
    if denom <= 0:
        return None
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denom
    intercept = mean_y - slope * mean_x
    rss = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, ys))
    se = (rss / (n - 2) / denom) ** 0.5
    return slope * 1000.0, se * 1000.0


def _latest_norm(db: Session, electrolyzer: str) -> models.ElectrolyzerNormalization | None:
    return (
        db.query(models.ElectrolyzerNormalization)
        .filter(func.upper(models.ElectrolyzerNormalization.electrolyzer) == electrolyzer)
        .order_by(models.ElectrolyzerNormalization.date.desc(), models.ElectrolyzerNormalization.id.desc())
        .first()
    )


def _latest_analysis(
    db: Session,
    electrolyzer: str,
    analysis_type: str,
) -> models.AnalysisSample | None:
    return (
        db.query(models.AnalysisSample)
        .filter(
            func.upper(models.AnalysisSample.electrolyzer) == electrolyzer,
            models.AnalysisSample.analysis_type == analysis_type,
        )
        .order_by(models.AnalysisSample.date.desc(), models.AnalysisSample.id.desc())
        .first()
    )


def _brine_impurity_flags(params: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(params, dict):
        return []
    flags: list[dict[str, Any]] = []
    for key, limit in BRINE_SOFT_LIMITS.items():
        raw = None
        for candidate in (key, key.replace("+", " + "), key.lower(), key.upper()):
            if candidate in params:
                raw = params[candidate]
                break
        value = _num(raw)
        if value is None:
            continue
        if value > limit:
            flags.append({"parameter": key, "value": value, "limit": limit, "severity": "warning"})
    return flags


def _envelope(db: Session, electrolyzer: str) -> dict[str, Any]:
    norm = _latest_norm(db, electrolyzer)
    brine = _latest_analysis(db, electrolyzer, "pure_brine")
    catholyte = _latest_analysis(db, electrolyzer, "catholyte")
    chlorine = _latest_analysis(db, electrolyzer, "chlorine_gas")
    hydrogen = _latest_analysis(db, electrolyzer, "hydrogen")

    anolyte_temp = _num(norm.anolyte_temp) if norm else None
    catholyte_temp = _num(norm.catholyte_temp) if norm else None
    current_ka = _num(norm.total_current) if norm else None
    delta_p = _num(norm.delta_p) if norm else None
    naoh = _num(norm.catholyte_conc) if norm else None
    if naoh is None and catholyte and isinstance(catholyte.parameters, dict):
        naoh = _num(catholyte.parameters.get("NaOH"))
    cl2 = _num(norm.cl2_pct) if norm else None
    h2 = _num(norm.h2_pct) if norm else None
    if cl2 is None and chlorine and isinstance(chlorine.parameters, dict):
        cl2 = _num(chlorine.parameters.get("Cl2+CO2") or chlorine.parameters.get("Cl2"))
    if h2 is None and hydrogen and isinstance(hydrogen.parameters, dict):
        h2 = _num(hydrogen.parameters.get("H2"))

    factors: list[dict[str, Any]] = []
    score = 100.0

    def add_factor(name: str, value: float | None, status: str, detail: str, weight: float = 0):
        nonlocal score
        factors.append({"name": name, "value": value, "status": status, "detail": detail})
        if status == "warning":
            score -= 8 * (weight or 1)
        elif status == "danger":
            score -= 18 * (weight or 1)

    if anolyte_temp is not None:
        if anolyte_temp < TEMP_DANGER[0] or anolyte_temp > TEMP_DANGER[1]:
            add_factor("anolyte_temp", anolyte_temp, "danger", "Outside safe temperature band", 1.2)
        elif anolyte_temp < TEMP_WARN[0] or anolyte_temp > TEMP_WARN[1]:
            add_factor("anolyte_temp", anolyte_temp, "warning", "Near edge of preferred temperature band")
        else:
            add_factor("anolyte_temp", anolyte_temp, "ok", "Within preferred band")
    else:
        add_factor("anolyte_temp", None, "unknown", "No recent AriaORMS temperature")

    if naoh is not None:
        if naoh < NAOH_WARN[0] or naoh > NAOH_WARN[1]:
            add_factor("naoh", naoh, "warning", "NaOH concentration outside preferred window")
        else:
            add_factor("naoh", naoh, "ok", "NaOH within preferred window")
    else:
        add_factor("naoh", None, "unknown", "No NaOH reading")

    if delta_p is not None:
        if abs(delta_p) >= DELTA_P_WARN:
            add_factor("delta_p", delta_p, "warning", "Elevated differential pressure / ΔP")
        else:
            add_factor("delta_p", delta_p, "ok", "ΔP present")
    else:
        add_factor("delta_p", None, "unknown", "ΔP not in latest AriaORMS row")

    brine_flags = _brine_impurity_flags(brine.parameters if brine else None)
    if brine_flags:
        add_factor("brine_impurities", len(brine_flags), "warning", "One or more brine impurities above soft limits", 1.5)
    elif brine:
        add_factor("brine_impurities", 0, "ok", "Latest pure-brine sample within soft limits")
    else:
        add_factor("brine_impurities", None, "unknown", "No pure-brine analysis linked to this electrolyzer")

    if current_ka is not None:
        add_factor("total_current", current_ka, "ok", "Electrolyzer load (kA)")
    else:
        add_factor("total_current", None, "unknown", "No load reading")

    return {
        "report_date": _as_date(norm.date).isoformat() if norm and norm.date else None,
        "total_current_ka": current_ka,
        "anolyte_temp": anolyte_temp,
        "catholyte_temp": catholyte_temp,
        "delta_p": delta_p,
        "naoh_pct": naoh,
        "cl2_pct": cl2,
        "h2_pct": h2,
        "brine_flags": brine_flags,
        "brine_date": _as_date(brine.date).isoformat() if brine and brine.date else None,
        "factors": factors,
        "envelope_score": max(0.0, min(100.0, round(score, 1))),
        "envelope_status": _status_from_score(score),
    }


def _active_elements(db: Session, electrolyzer: str) -> dict[str, models.Element]:
    rows = (
        db.query(models.Element)
        .filter(func.upper(models.Element.electrolyzer) == electrolyzer)
        .all()
    )
    out: dict[str, models.Element] = {}
    for row in rows:
        pos = alerts_engine._norm_pos(row.position)
        if not pos:
            continue
        prev = out.get(pos)
        # Prefer currently mounted (no dismantle), then newest id.
        if prev is None:
            out[pos] = row
            continue
        prev_open = prev.disassembly_date is None
        row_open = row.disassembly_date is None
        if row_open and not prev_open:
            out[pos] = row
        elif row_open == prev_open and (row.id or 0) > (prev.id or 0):
            out[pos] = row
    return out


def _element_history_counts(db: Session, electrolyzer: str) -> dict[str, int]:
    rows = (
        db.query(models.Element)
        .filter(func.upper(models.Element.electrolyzer) == electrolyzer)
        .all()
    )
    counts: dict[str, int] = {}
    for row in rows:
        pos = alerts_engine._norm_pos(row.position)
        if not pos:
            continue
        counts[pos] = counts.get(pos, 0) + 1
    return counts


def _shutdown_stats(db: Session, electrolyzer: str) -> dict[str, int]:
    aliases = {electrolyzer, electrolyzer.lower(), electrolyzer.upper()}
    arranged = arrangement_name(electrolyzer)
    if arranged:
        aliases.update({arranged, arranged.lower(), arranged.upper()})
    rows = (
        db.query(models.Shutdown)
        .filter(models.Shutdown.plant_part.in_(list(aliases)))
        .all()
    )
    trips = 0
    for row in rows:
        text = f"{row.cause or ''} {row.remarks or ''} {row.category or ''}".lower()
        if "trip" in text or "emergency" in text or "اضطراری" in text:
            trips += 1
    return {"shutdowns": len(rows), "trips": trips}


def _latest_readings_for_el(db: Session, electrolyzer: str) -> dict[str, models.VoltageReading]:
    """Latest reading per position for one electrolyzer."""
    rows = (
        db.query(models.VoltageReading)
        .filter(func.upper(models.VoltageReading.electrolyzer) == electrolyzer)
        .order_by(models.VoltageReading.date.desc(), models.VoltageReading.id.desc())
        .limit(2500)
        .all()
    )
    out: dict[str, models.VoltageReading] = {}
    for row in rows:
        pos = alerts_engine._norm_pos(row.position)
        if not pos or pos in out:
            continue
        if row.voltage is None:
            continue
        out[pos] = row
    return out


def _trend_map(db: Session, electrolyzer: str, days: int = 45) -> dict[str, tuple[float, float] | None]:
    """Peer-relative voltage trend: (slope, standard error) in mV/day of (Ui − daily electrolyzer median)."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(models.VoltageReading)
        .filter(
            func.upper(models.VoltageReading.electrolyzer) == electrolyzer,
            models.VoltageReading.date.isnot(None),
            models.VoltageReading.date >= cutoff,
            models.VoltageReading.voltage.isnot(None),
        )
        .order_by(models.VoltageReading.date.asc())
        .all()
    )
    by_day: dict[date, list[float]] = {}
    by_pos_day: dict[str, dict[date, float]] = {}
    for row in rows:
        pos = alerts_engine._norm_pos(row.position)
        day = _as_date(row.date)
        if not pos or day is None or row.voltage is None:
            continue
        value = float(row.voltage)
        by_day.setdefault(day, []).append(value)
        by_pos_day.setdefault(pos, {})[day] = value

    day_median = {day: median(vals) for day, vals in by_day.items() if vals}
    out: dict[str, tuple[float, float] | None] = {}
    for pos, series in by_pos_day.items():
        residual: list[tuple[date, float]] = []
        for day, value in sorted(series.items()):
            base = day_median.get(day)
            if base is None:
                continue
            residual.append((day, value - base))
        out[pos] = _linear_slope_mv_per_day(residual)
    return out


def _band_score(value: float, bands: list[tuple[float, float]]) -> float:
    """bands are (upper_inclusive, score) ordered ascending."""
    for upper, score in bands:
        if value <= upper:
            return score
    return bands[-1][1]


def _ce_score(pct: float) -> float:
    if pct >= 96:
        return 100
    if pct >= 94:
        return 86
    if pct >= 92:
        return 72
    if pct >= 90:
        return 58
    return 42


def _un_score(un: float) -> float:
    return _band_score(un, [(3.05, 100), (3.15, 86), (3.25, 72), (3.40, 58), (9, 40)])


def _current_score(ka: float) -> float:
    if 8 <= ka <= 16:
        return 100
    if 6 <= ka < 8 or 16 < ka <= 18:
        return 80
    if ka > 18:
        return 60
    return 72


def _spc_score(spc: float) -> float:
    return _band_score(spc, [(2100, 100), (2300, 86), (2500, 70), (100_000, 52)])


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _window_avgs(db: Session, electrolyzer: str, days: int = 30) -> tuple[dict[str, float], dict[str, float], float | None]:
    """Per-position average Ui, average Un, and electrolyzer average current (kA)."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(models.VoltageReading)
        .filter(
            func.upper(models.VoltageReading.electrolyzer) == electrolyzer,
            models.VoltageReading.date.isnot(None),
            models.VoltageReading.date >= cutoff,
            models.VoltageReading.voltage.isnot(None),
        )
        .all()
    )
    volts: dict[str, list[float]] = {}
    uns: dict[str, list[float]] = {}
    for row in rows:
        pos = alerts_engine._norm_pos(row.position)
        if not pos:
            continue
        volts.setdefault(pos, []).append(float(row.voltage))
        if row.standardized_voltage is not None:
            uns.setdefault(pos, []).append(float(row.standardized_voltage))
    avg_v = {pos: sum(vals) / len(vals) for pos, vals in volts.items()}
    avg_un = {pos: sum(vals) / len(vals) for pos, vals in uns.items()}

    norms = (
        db.query(models.ElectrolyzerNormalization)
        .filter(
            func.upper(models.ElectrolyzerNormalization.electrolyzer) == electrolyzer,
            models.ElectrolyzerNormalization.date.isnot(None),
            models.ElectrolyzerNormalization.date >= cutoff,
            models.ElectrolyzerNormalization.total_current.isnot(None),
        )
        .all()
    )
    currents = [float(row.total_current) for row in norms if row.total_current is not None]
    avg_ka = (sum(currents) / len(currents)) if currents else None
    return avg_v, avg_un, avg_ka


def _latest_ce_map(db: Session, electrolyzer: str) -> tuple[dict[str, float], float | None]:
    rows = (
        db.query(models.CurrentEfficiencyEntry)
        .filter(
            models.CurrentEfficiencyEntry.value_pct.isnot(None),
            func.upper(models.CurrentEfficiencyEntry.scope_ref) == electrolyzer,
        )
        .order_by(models.CurrentEfficiencyEntry.date.desc(), models.CurrentEfficiencyEntry.id.desc())
        .limit(400)
        .all()
    )
    by_pos: dict[str, float] = {}
    el_ce: float | None = None
    for row in rows:
        if row.value_pct is None:
            continue
        if (row.scope or "") == "element":
            pos = alerts_engine._norm_pos(row.position)
            if pos and pos not in by_pos:
                by_pos[pos] = float(row.value_pct)
        elif el_ce is None and (row.scope or "") == "electrolyzer":
            el_ce = float(row.value_pct)
    return by_pos, el_ce


def _latest_test_run(db: Session, electrolyzer: str) -> tuple[float | None, float | None]:
    needle = electrolyzer.lower()
    rows = (
        db.query(models.PerformanceTest)
        .filter(models.PerformanceTest.plant_part.isnot(None))
        .order_by(models.PerformanceTest.date.desc(), models.PerformanceTest.id.desc())
        .limit(80)
        .all()
    )
    for row in rows:
        part = (row.plant_part or "").lower()
        if needle in part or part in needle:
            ce = float(row.ce_pct) if row.ce_pct is not None else None
            spc = float(row.spc_kwh) if row.spc_kwh is not None else None
            return ce, spc
    return None, None


def _lab_score(envelope: dict[str, Any]) -> float | None:
    flags = envelope.get("brine_flags") or []
    naoh = envelope.get("naoh_pct")
    if not flags and naoh is None and not envelope.get("brine_date"):
        return None
    score = 100.0
    score -= min(48.0, 12.0 * len(flags))
    if naoh is not None and (naoh < NAOH_WARN[0] or naoh > NAOH_WARN[1]):
        score -= 12
    return max(0.0, score)


# Cell-specific evidence dominates; conditions shared by the whole electrolyzer count once.
WEIGHTS = {
    "peer_voltage": 3,
    "voltage_trend": 2,
    "un_ce": 2,
    "current_efficiency": 2,
    "life": 1,
    "electrolyzer": 1,
}


def _peer_score(delta_v: float) -> float:
    """Average voltage against the electrolyzer median: high = losses, far below = possible short / pinhole."""
    if delta_v >= 0:
        return _band_score(delta_v, [(0.02, 100), (VOLTAGE_PEER_WATCH, 85), (VOLTAGE_PEER_INVESTIGATE, 65), (VOLTAGE_PEER_CRITICAL, 45), (99, 25)])
    return _band_score(-delta_v, [(0.10, 100), (0.20, 75), (0.35, 50), (99, 30)])


def _trend_score(mv_per_day: float, se: float) -> float:
    """A rise only counts when it is at least twice its standard error; otherwise the cell is treated as steady."""
    if mv_per_day <= 0 or mv_per_day < 2 * se:
        return 100
    return _band_score(mv_per_day, [(0.2, 100), (TREND_WATCH_MV_DAY, 85), (TREND_INVESTIGATE_MV_DAY, 65), (2.0, 45), (1e9, 25)])


def _life_score(pct: float) -> float:
    return _band_score(pct, [(50, 100), (75, 90), (90, 75), (100, 60), (1e9, 45)])


def electrolyzer_score(
    *, el_ce: float | None, test_ce: float | None, test_spc: float | None, lab_score: float | None, avg_current_ka: float | None
) -> tuple[float | None, list[str]]:
    """One score for the conditions every cell of the electrolyzer shares, and which inputs it used."""
    parts: list[float] = []
    used: list[str] = []
    if el_ce is not None:
        parts.append(_ce_score(el_ce))
        used.append(f"CE {el_ce:.1f}%")
    if test_ce is not None:
        parts.append(_ce_score(test_ce))
        used.append(f"test CE {test_ce:.1f}%")
    if test_spc is not None:
        parts.append(_spc_score(test_spc))
        used.append(f"SPC {test_spc:.0f}")
    if lab_score is not None:
        parts.append(lab_score)
        used.append(f"lab {lab_score:.0f}")
    if avg_current_ka is not None:
        parts.append(_current_score(avg_current_ka))
        used.append(f"{avg_current_ka:.1f} kA")
    return (round(sum(parts) / len(parts), 1) if parts else None), used


def score_cell(
    *,
    peer_delta_v: float | None,
    trend_mv_day: float | None,
    trend_se: float | None,
    un_avg: float | None,
    cell_ce: float | None,
    life_pct: float | None,
    dol_days: int | None,
    plant_score: float | None,
    plant_inputs: list[str] | None = None,
) -> dict[str, Any]:
    """Weighted average of the factors that have data (weights in ``WEIGHTS``)."""
    factors: list[dict[str, Any]] = []
    total = weight_sum = 0.0
    reasons: list[tuple[float, str]] = []

    def add(name: str, value: float | None, score: float | None, scope: str, reason: str | None = None, detail: str | None = None):
        weight = WEIGHTS[name]
        if score is None or value is None:
            factors.append({"name": name, "status": "unknown", "value": value, "score": None, "weight": weight, "scope": scope, "detail": detail})
            return
        nonlocal total, weight_sum
        total += score * weight
        weight_sum += weight
        status = _status_from_score(score)
        factors.append({"name": name, "status": status, "value": round(value, 4), "score": round(score, 1), "weight": weight, "scope": scope, "detail": detail})
        if reason and status != "ok":
            reasons.append((score, reason))

    add(
        "peer_voltage",
        peer_delta_v,
        _peer_score(peer_delta_v) if peer_delta_v is not None else None,
        "cell",
        (f"{peer_delta_v * 1000:+.0f} mV against the electrolyzer median" if peer_delta_v is not None else None),
    )
    add(
        "voltage_trend",
        trend_mv_day,
        _trend_score(trend_mv_day, trend_se or 0.0) if trend_mv_day is not None else None,
        "cell",
        (f"Voltage rising {trend_mv_day:.2f} mV/day faster than its peers" if trend_mv_day is not None else None),
        (f"± {trend_se:.2f} mV/day" if trend_se is not None else None),
    )
    add("un_ce", un_avg, _un_score(un_avg) if un_avg is not None else None, "cell", (f"Average Un {un_avg:.3f} V" if un_avg is not None else None))
    add(
        "current_efficiency",
        cell_ce,
        _ce_score(cell_ce) if cell_ce is not None else None,
        "cell",
        (f"Element current efficiency {cell_ce:.1f}%" if cell_ce is not None else None),
    )
    add(
        "life",
        life_pct,
        _life_score(life_pct) if life_pct is not None else None,
        "cell",
        (f"{life_pct:.0f}% of the membrane life used ({dol_days} days)" if life_pct is not None else None),
        f"{dol_days} days" if dol_days is not None else None,
    )
    add("electrolyzer", plant_score, plant_score, "electrolyzer", "Electrolyzer conditions off target", ", ".join(plant_inputs or []) or None)

    if not weight_sum:
        return {"health_score": None, "status": "unknown", "reasons": ["No health inputs yet"], "factors": factors}
    score = max(0.0, min(100.0, round(total / weight_sum, 1)))
    reasons.sort(key=lambda r: r[0])
    return {"health_score": score, "status": _status_from_score(score), "reasons": [r[1] for r in reasons], "factors": factors}


def build_cell_health_board(db: Session, electrolyzer: str) -> dict[str, Any]:
    el = (electrolyzer or "").strip().upper()
    if not el:
        raise ValueError("electrolyzer is required")

    envelope = _envelope(db, el)
    readings = _latest_readings_for_el(db, el)
    elements = _active_elements(db, el)
    history_counts = _element_history_counts(db, el)
    shutdowns = _shutdown_stats(db, el)
    avg_v, avg_un, avg_ka = _window_avgs(db, el)
    ce_by_pos, el_ce = _latest_ce_map(db, el)
    test_ce, test_spc = _latest_test_run(db, el)
    lab = _lab_score(envelope)
    trends = _trend_map(db, el)
    plant_score, plant_inputs = electrolyzer_score(el_ce=el_ce, test_ce=test_ce, test_spc=test_spc, lab_score=lab, avg_current_ka=avg_ka)
    from .element_dashboard import get_settings, settings_dict

    membrane_life = settings_dict(get_settings(db)).get("membrane_life_days")

    voltages = list(avg_v.values()) or [float(row.voltage) for row in readings.values() if row.voltage is not None]
    median_v = median(voltages) if voltages else None

    positions = set(readings) | set(elements)
    windows = load_shutdown_windows(db)
    cells: list[dict[str, Any]] = []
    for pos in sorted(positions, key=lambda item: int(item) if str(item).isdigit() else str(item)):
        row = readings.get(pos)
        asm = elements.get(pos)
        dol = None
        if asm:
            dol = dol_for_element(asm, windows)
        cell_ce = ce_by_pos.get(pos)
        ce = cell_ce if cell_ce is not None else el_ce
        un_avg = avg_un.get(pos)
        if un_avg is None and row is not None and row.standardized_voltage is not None:
            un_avg = float(row.standardized_voltage)
        avg_voltage = avg_v.get(pos)
        if avg_voltage is None and row is not None and row.voltage is not None:
            avg_voltage = float(row.voltage)
        peer_delta = round(avg_voltage - median_v, 4) if avg_voltage is not None and median_v is not None else None
        trend_fit = trends.get(pos)
        trend, trend_se = trend_fit if trend_fit else (None, None)
        life_pct = round(dol * 100.0 / membrane_life, 1) if dol is not None and membrane_life else None
        scored = score_cell(
            peer_delta_v=peer_delta,
            trend_mv_day=trend,
            trend_se=trend_se,
            un_avg=un_avg,
            cell_ce=cell_ce,
            life_pct=life_pct,
            dol_days=dol,
            plant_score=plant_score,
            plant_inputs=plant_inputs,
        )
        cells.append(
            {
                "electrolyzer": el,
                "position": pos,
                "position_label": pos.zfill(3) if pos.isdigit() else pos,
                "element_nr": (row.element_nr if row else None) or (asm.element_nr if asm else None),
                "anode_nr": asm.anode_nr if asm else None,
                "cathode_nr": asm.cathode_nr if asm else None,
                "membrane_nr": asm.membrane_nr if asm else None,
                "membrane_type": asm.membrane_type if asm else None,
                "voltage": avg_voltage,
                "standardized_voltage": un_avg,
                "reading_date": _as_date(row.date).isoformat() if row and row.date else None,
                "median_voltage": round(median_v, 4) if median_v is not None else None,
                "operating_hours": int(dol * 24) if dol is not None else None,
                "dol_days": dol,
                "install_cycles": history_counts.get(pos, 0),
                "ce_pct": ce,
                "un_avg": un_avg,
                "avg_voltage": avg_voltage,
                "avg_current_ka": avg_ka,
                "test_ce_pct": test_ce,
                "test_spc_kwh": test_spc,
                "lab_score": lab,
                "health_score": scored["health_score"],
                "status": scored["status"],
                "peer_delta_v": peer_delta,
                "trend_mv_day": round(trend, 3) if trend is not None else None,
                "life_pct": life_pct,
                "reasons": scored["reasons"],
                "factors": scored["factors"],
            }
        )

    cells.sort(key=lambda c: int(c["position"]) if str(c["position"]).isdigit() else str(c["position"]))
    investigation = [c for c in cells if c["status"] in {"watch", "investigate", "critical"}]
    investigation.sort(key=lambda c: (c["health_score"] is None, c["health_score"] if c["health_score"] is not None else 999))

    summary = {
        "cells": len(cells),
        "ok": sum(1 for c in cells if c["status"] == "ok"),
        "watch": sum(1 for c in cells if c["status"] == "watch"),
        "investigate": sum(1 for c in cells if c["status"] == "investigate"),
        "critical": sum(1 for c in cells if c["status"] == "critical"),
        "unknown": sum(1 for c in cells if c["status"] == "unknown"),
        "median_voltage": round(median_v, 4) if median_v is not None else None,
    }

    return {
        "electrolyzer": el,
        "train": train_of(el),
        "arrangement": arrangement_name(el),
        "median_voltage": summary["median_voltage"],
        "envelope": envelope,
        "shutdown_stats": shutdowns,
        "summary": summary,
        "investigation": investigation[:40],
        "cells": cells,
        "levels": {
            "l1_online": "Average voltage, average current, Un and CE from AriaORMS",
            "l2_condition": "Laboratory analyses plus current-efficiency and Un/CE review",
            "l3_overhaul": "Test-run results and operating hours drive overhaul, not peer voltage alone",
        },
    }


def build_cell_health(db: Session, electrolyzer: str, position: str) -> dict[str, Any]:
    board = build_cell_health_board(db, electrolyzer)
    pos = alerts_engine._norm_pos(position)
    match = next((c for c in board["cells"] if c["position"] == pos), None)
    return {
        "electrolyzer": board["electrolyzer"],
        "train": board["train"],
        "envelope": board["envelope"],
        "shutdown_stats": board["shutdown_stats"],
        "median_voltage": board["median_voltage"],
        "cell": match,
        "levels": board["levels"],
    }
