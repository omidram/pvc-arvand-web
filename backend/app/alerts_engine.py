"""Evaluate plant alert rules against voltage readings and anode/cathode status."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from . import models

DEFAULT_RULES: list[dict[str, Any]] = [
    {
        "name": "High cell voltage",
        "metric": "cell_voltage",
        "operator": "gt",
        "warning_threshold": 3.3,
        "danger_threshold": 3.5,
        "description": "Element cell voltage above warning/danger limits (V)",
    },
    {
        "name": "Low cell voltage",
        "metric": "cell_voltage",
        "operator": "lt",
        "warning_threshold": 2.7,
        "danger_threshold": 2.5,
        "description": "Element cell voltage below warning/danger limits (V)",
    },
    {
        "name": "High standardized voltage (Un)",
        "metric": "standardized_voltage",
        "operator": "gt",
        "warning_threshold": 3.2,
        "danger_threshold": 3.4,
        "description": "Standardized Un above limits (V)",
    },
    {
        "name": "Missing anode on active element",
        "metric": "missing_anode",
        "operator": "gt",
        "warning_threshold": 0,
        "danger_threshold": None,
        "description": "Active assembly row without anode number",
    },
    {
        "name": "Missing cathode on active element",
        "metric": "missing_cathode",
        "operator": "gt",
        "warning_threshold": 0,
        "danger_threshold": None,
        "description": "Active assembly row without cathode number",
    },
    {
        "name": "Decommissioned anode still installed",
        "metric": "anode_decommissioned",
        "operator": "gt",
        "warning_threshold": None,
        "danger_threshold": 0,
        "description": "Active element uses an anode marked decommissioned",
    },
    {
        "name": "Decommissioned cathode still installed",
        "metric": "cathode_decommissioned",
        "operator": "gt",
        "warning_threshold": None,
        "danger_threshold": 0,
        "description": "Active element uses a cathode marked decommissioned",
    },
]


def ensure_default_rules(db: Session) -> None:
    if db.query(models.AlertRule).count() > 0:
        return
    for spec in DEFAULT_RULES:
        db.add(models.AlertRule(**spec))
    db.commit()


def _cmp(op: str, value: float, threshold: float) -> bool:
    if op == "gte":
        return value >= threshold
    if op == "lt":
        return value < threshold
    if op == "lte":
        return value <= threshold
    return value > threshold  # gt default


def _severity_for(rule: models.AlertRule, value: float) -> str | None:
    op = (rule.operator or "gt").lower()
    danger = rule.danger_threshold
    warning = rule.warning_threshold
    # For "high" operators, danger is the higher bar; for "low", danger is the lower bar.
    if op in {"gt", "gte"}:
        if danger is not None and _cmp(op, value, float(danger)):
            return "danger"
        if warning is not None and _cmp(op, value, float(warning)):
            return "warning"
    else:
        if danger is not None and _cmp(op, value, float(danger)):
            return "danger"
        if warning is not None and _cmp(op, value, float(warning)):
            return "warning"
    return None


def _upsert_alert(db: Session, payload: dict[str, Any]) -> models.AlertEvent:
    fp = payload["fingerprint"]
    existing = (
        db.query(models.AlertEvent)
        .filter(models.AlertEvent.fingerprint == fp, models.AlertEvent.status.in_(("open", "acknowledged")))
        .first()
    )
    now = datetime.utcnow()
    if existing:
        existing.severity = payload["severity"]
        existing.value = payload.get("value")
        existing.threshold = payload.get("threshold")
        existing.message = payload.get("message")
        existing.title = payload["title"]
        existing.updated_at = now
        if existing.status == "acknowledged" and payload["severity"] == "danger":
            # escalate back to open when severity increases
            existing.status = "open"
            existing.acknowledged_at = None
        return existing

    event = models.AlertEvent(
        rule_id=payload.get("rule_id"),
        fingerprint=fp,
        severity=payload["severity"],
        category=payload["category"],
        metric=payload["metric"],
        title=payload["title"],
        message=payload.get("message"),
        electrolyzer=payload.get("electrolyzer"),
        position=payload.get("position"),
        element_nr=payload.get("element_nr"),
        component_ref=payload.get("component_ref"),
        value=payload.get("value"),
        threshold=payload.get("threshold"),
        reading_date=payload.get("reading_date"),
        reading_time=payload.get("reading_time"),
        status="open",
        created_at=now,
        updated_at=now,
    )
    db.add(event)
    return event


def _latest_voltage_rows(db: Session) -> list[models.VoltageReading]:
    """Latest reading per electrolyzer+position, without loading the full history."""
    from sqlalchemy import func

    ranked = (
        db.query(
            models.VoltageReading.id.label("id"),
            func.row_number()
            .over(
                partition_by=(models.VoltageReading.electrolyzer, models.VoltageReading.position),
                order_by=(
                    models.VoltageReading.date.desc(),
                    models.VoltageReading.time.desc(),
                    models.VoltageReading.id.desc(),
                ),
            )
            .label("rn"),
        )
        .filter(
            models.VoltageReading.voltage.isnot(None),
            models.VoltageReading.electrolyzer.isnot(None),
            models.VoltageReading.position.isnot(None),
            models.VoltageReading.position != "",
        )
        .subquery()
    )
    return (
        db.query(models.VoltageReading)
        .join(ranked, models.VoltageReading.id == ranked.c.id)
        .filter(ranked.c.rn == 1)
        .all()
    )


def _latest_normalizations(db: Session) -> dict[tuple[str, str], models.ElectrolyzerNormalization]:
    """Latest total-voltage batch per electrolyzer (history stays in the table)."""
    from sqlalchemy import func

    ranked = (
        db.query(
            models.ElectrolyzerNormalization.id.label("id"),
            func.row_number()
            .over(
                partition_by=models.ElectrolyzerNormalization.electrolyzer,
                order_by=(
                    models.ElectrolyzerNormalization.date.desc(),
                    models.ElectrolyzerNormalization.time.desc(),
                    models.ElectrolyzerNormalization.id.desc(),
                ),
            )
            .label("rn"),
        )
        .filter(models.ElectrolyzerNormalization.total_voltage.isnot(None))
        .subquery()
    )
    rows = (
        db.query(models.ElectrolyzerNormalization)
        .join(ranked, models.ElectrolyzerNormalization.id == ranked.c.id)
        .filter(ranked.c.rn == 1)
        .all()
    )
    return {((row.electrolyzer or "").upper(), row.time or ""): row for row in rows}


def evaluate_voltage_rules(db: Session, rules: list[models.AlertRule] | None = None) -> int:
    rules = rules or (
        db.query(models.AlertRule)
        .filter(models.AlertRule.enabled.is_(True), models.AlertRule.metric.in_(("cell_voltage", "standardized_voltage", "total_voltage")))
        .all()
    )
    if not rules:
        return 0

    created = 0
    readings = _latest_voltage_rows(db)
    norms = _latest_normalizations(db)

    for rule in rules:
        el_filter = (rule.electrolyzer or "").strip().upper() or None
        if rule.metric == "total_voltage":
            for (el, tlabel), norm in norms.items():
                if el_filter and el != el_filter:
                    continue
                value = norm.total_voltage
                if value is None:
                    continue
                sev = _severity_for(rule, float(value))
                if not sev:
                    continue
                thr = rule.danger_threshold if sev == "danger" else rule.warning_threshold
                date_key = norm.date.date().isoformat() if norm.date else "na"
                fp = f"r{rule.id}|total|{el}|{date_key}|{tlabel}"
                _upsert_alert(
                    db,
                    {
                        "rule_id": rule.id,
                        "fingerprint": fp,
                        "severity": sev,
                        "category": "voltage",
                        "metric": rule.metric,
                        "title": f"{rule.name}: {el}",
                        "message": f"Total voltage {value:.2f} V (limit {thr})",
                        "electrolyzer": el,
                        "value": float(value),
                        "threshold": thr,
                        "reading_date": norm.date,
                        "reading_time": tlabel or None,
                    },
                )
                created += 1
            continue

        for row in readings:
            el = (row.electrolyzer or "").strip().upper()
            if el_filter and el != el_filter:
                continue
            if rule.metric == "cell_voltage":
                value = row.voltage
            else:
                value = row.standardized_voltage
            if value is None:
                continue
            sev = _severity_for(rule, float(value))
            if not sev:
                continue
            thr = rule.danger_threshold if sev == "danger" else rule.warning_threshold
            date_key = row.date.date().isoformat() if row.date else "na"
            fp = f"r{rule.id}|{rule.metric}|{el}|{row.position}|{date_key}|{row.time or ''}"
            _upsert_alert(
                db,
                {
                    "rule_id": rule.id,
                    "fingerprint": fp,
                    "severity": sev,
                    "category": "voltage",
                    "metric": rule.metric,
                    "title": f"{rule.name}: {el}-{row.position}",
                    "message": (
                        f"Cell {el}-{row.position} = {float(value):.3f} V "
                        f"(limit {thr} V) at {row.time or '—'}"
                    ),
                    "electrolyzer": el,
                    "position": row.position,
                    "element_nr": row.element_nr,
                    "value": float(value),
                    "threshold": thr,
                    "reading_date": row.date,
                    "reading_time": row.time,
                },
            )
            created += 1
    return created


def evaluate_component_rules(db: Session, rules: list[models.AlertRule] | None = None) -> int:
    rules = rules or (
        db.query(models.AlertRule)
        .filter(
            models.AlertRule.enabled.is_(True),
            models.AlertRule.metric.in_(
                ("missing_anode", "missing_cathode", "anode_decommissioned", "cathode_decommissioned")
            ),
        )
        .all()
    )
    if not rules:
        return 0

    active_elements = (
        db.query(models.Element)
        .filter(models.Element.decommissioning_date.is_(None))
        .all()
    )
    anodes = {a.anode_nr: a for a in db.query(models.Anode).all()}
    cathodes = {c.cathode_nr: c for c in db.query(models.Cathode).all()}
    created = 0

    for rule in rules:
        el_filter = (rule.electrolyzer or "").strip().upper() or None
        for el_row in active_elements:
            el_name = (el_row.electrolyzer or "").strip().upper()
            if el_filter and el_name != el_filter:
                continue
            pos = el_row.position
            enr = el_row.element_nr
            anode_nr = (el_row.anode_nr or "").strip() or None
            cathode_nr = (el_row.cathode_nr or "").strip() or None

            hit = False
            severity = "warning"
            component_ref = None
            detail = ""
            category = "element"

            if rule.metric == "missing_anode" and not anode_nr:
                hit = True
                severity = "danger" if rule.danger_threshold is not None else "warning"
                detail = "Active element has no anode assigned"
                category = "anode"
            elif rule.metric == "missing_cathode" and not cathode_nr:
                hit = True
                severity = "danger" if rule.danger_threshold is not None else "warning"
                detail = "Active element has no cathode assigned"
                category = "cathode"
            elif rule.metric == "anode_decommissioned" and anode_nr:
                anode = anodes.get(anode_nr)
                if anode and anode.decommission_date is not None:
                    hit = True
                    severity = "danger"
                    component_ref = anode_nr
                    detail = f"Anode {anode_nr} is decommissioned but still installed"
                    category = "anode"
            elif rule.metric == "cathode_decommissioned" and cathode_nr:
                cathode = cathodes.get(cathode_nr)
                if cathode and cathode.decommission_date is not None:
                    hit = True
                    severity = "danger"
                    component_ref = cathode_nr
                    detail = f"Cathode {cathode_nr} is decommissioned but still installed"
                    category = "cathode"

            if not hit:
                continue
            fp = f"r{rule.id}|{rule.metric}|{el_name}|{pos}|{enr}|{component_ref or '-'}"
            _upsert_alert(
                db,
                {
                    "rule_id": rule.id,
                    "fingerprint": fp,
                    "severity": severity,
                    "category": category,
                    "metric": rule.metric,
                    "title": f"{rule.name}: {enr or f'{el_name}-{pos}'}",
                    "message": detail,
                    "electrolyzer": el_name or None,
                    "position": pos,
                    "element_nr": enr,
                    "component_ref": component_ref,
                    "value": 1.0,
                    "threshold": rule.danger_threshold if severity == "danger" else rule.warning_threshold,
                },
            )
            created += 1
    return created


def evaluate_all(db: Session) -> dict[str, int]:
    ensure_default_rules(db)
    v = evaluate_voltage_rules(db)
    c = evaluate_component_rules(db)
    db.commit()
    return {"voltage_alerts": v, "component_alerts": c, "total_touched": v + c}


def alert_summary(db: Session) -> dict[str, int]:
    open_q = db.query(models.AlertEvent).filter(models.AlertEvent.status == "open")
    open_danger = open_q.filter(models.AlertEvent.severity == "danger").count()
    open_warning = (
        db.query(models.AlertEvent)
        .filter(models.AlertEvent.status == "open", models.AlertEvent.severity == "warning")
        .count()
    )
    open_info = (
        db.query(models.AlertEvent)
        .filter(models.AlertEvent.status == "open", models.AlertEvent.severity == "info")
        .count()
    )
    acknowledged = db.query(models.AlertEvent).filter(models.AlertEvent.status == "acknowledged").count()
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    resolved_today = (
        db.query(models.AlertEvent)
        .filter(models.AlertEvent.status == "resolved", models.AlertEvent.resolved_at >= today)
        .count()
    )
    return {
        "open_danger": open_danger,
        "open_warning": open_warning,
        "open_info": open_info,
        "open_total": open_danger + open_warning + open_info,
        "acknowledged": acknowledged,
        "resolved_today": resolved_today,
    }


def cell_severity(value: float | None, rules: list[models.AlertRule], metric: str = "cell_voltage") -> tuple[str, float | None]:
    if value is None:
        return "unknown", None
    best = "ok"
    thr: float | None = None
    rank = {"ok": 0, "warning": 1, "danger": 2, "unknown": -1}
    for rule in rules:
        if rule.metric != metric or not rule.enabled:
            continue
        sev = _severity_for(rule, float(value))
        if sev and rank[sev] > rank[best]:
            best = sev
            thr = rule.danger_threshold if sev == "danger" else rule.warning_threshold
    return best, thr


def _sanitize_reading_dt(value: datetime | None) -> datetime | None:
    """Drop Excel-epoch / clearly invalid plant dates from the live monitor."""
    if value is None:
        return None
    try:
        if value.year < 1990:
            return None
    except Exception:
        return None
    return value


def voltage_live_stats(db: Session) -> dict[str, Any]:
    """Lightweight live voltage totals for the main dashboard (no alert write)."""
    ensure_default_rules(db)
    rules = db.query(models.AlertRule).filter(models.AlertRule.enabled.is_(True)).all()
    voltage_rules = [r for r in rules if r.metric in {"cell_voltage", "standardized_voltage"}]
    readings = _latest_voltage_rows(db)

    by_el: dict[str, list[float]] = {}
    ok = warn = danger = 0
    max_v: float | None = None
    for row in readings:
        el = (row.electrolyzer or "").strip().upper()
        if not el or row.voltage is None:
            continue
        v = float(row.voltage)
        by_el.setdefault(el, []).append(v)
        sev, _ = cell_severity(v, voltage_rules, "cell_voltage")
        if row.standardized_voltage is not None:
            sev2, _ = cell_severity(float(row.standardized_voltage), voltage_rules, "standardized_voltage")
            rank = {"ok": 0, "warning": 1, "danger": 2, "unknown": -1}
            if rank.get(sev2, 0) > rank.get(sev, 0):
                sev = sev2
        if sev == "danger":
            danger += 1
        elif sev == "warning":
            warn += 1
        elif sev == "ok":
            ok += 1
        if max_v is None or v > max_v:
            max_v = v

    electrolyzers = []
    plant_total = 0.0
    for el, vals in sorted(by_el.items()):
        total = sum(vals)
        plant_total += total
        electrolyzers.append(
            {
                "electrolyzer": el,
                "cell_count": len(vals),
                "total_voltage": round(total, 3),
                "avg_voltage": round(total / len(vals), 4) if vals else None,
                "max_voltage": round(max(vals), 4) if vals else None,
            }
        )

    cell_count = ok + warn + danger
    health_pct = round((ok / cell_count) * 100, 1) if cell_count else None
    # Typical single-cell scale for gauges (V)
    cell_gauge_max = 4.0
    danger_limit = 3.5
    for r in voltage_rules:
        if r.metric == "cell_voltage" and (r.operator or "gt") in {"gt", "gte"} and r.danger_threshold is not None:
            danger_limit = float(r.danger_threshold)
            break

    return {
        "plant_total_voltage": round(plant_total, 2),
        "cell_count": cell_count,
        "ok_count": ok,
        "warning_count": warn,
        "danger_count": danger,
        "health_pct": health_pct,
        "max_voltage": round(max_v, 4) if max_v is not None else None,
        "avg_voltage": round(plant_total / cell_count, 4) if cell_count else None,
        "danger_limit": danger_limit,
        "cell_gauge_max": cell_gauge_max,
        "electrolyzers": electrolyzers,
    }


def _norm_pos(value) -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        return ""
    try:
        return str(int(float(text)))
    except (TypeError, ValueError):
        return text


def _prefer_element(current: models.Element, candidate: models.Element) -> models.Element:
    def rank(row: models.Element):
        active = 1 if row.disassembly_date is None else 0
        stamp = row.commissioning_date or row.assembly_date or date.min
        return (active, stamp, row.id or 0)

    return candidate if rank(candidate) >= rank(current) else current


def build_snapshot(db: Session, *, evaluate: bool = True) -> dict[str, Any]:
    ensure_default_rules(db)
    # Keep alert inbox severities aligned with current thresholds / readings
    if evaluate:
        try:
            evaluate_voltage_rules(db)
            evaluate_component_rules(db)
            db.commit()
        except Exception:
            db.rollback()

    rules = db.query(models.AlertRule).filter(models.AlertRule.enabled.is_(True)).all()
    voltage_rules = [r for r in rules if r.metric in {"cell_voltage", "standardized_voltage"}]
    readings = _latest_voltage_rows(db)

    # Map element assembly for anode/cathode refs
    elements = (
        db.query(models.Element)
        .filter(models.Element.decommissioning_date.is_(None))
        .all()
    )
    el_map: dict[tuple[str, str], models.Element] = {}
    for e in elements:
        key = ((e.electrolyzer or "").strip().upper(), _norm_pos(e.position))
        if not key[0] or not key[1]:
            continue
        prev = el_map.get(key)
        el_map[key] = e if prev is None else _prefer_element(prev, e)

    by_el: dict[str, list[dict[str, Any]]] = {}
    for row in readings:
        el = (row.electrolyzer or "").strip().upper()
        pos = _norm_pos(row.position)
        sev, thr = cell_severity(row.voltage, voltage_rules, "cell_voltage")
        if row.standardized_voltage is not None:
            sev2, thr2 = cell_severity(row.standardized_voltage, voltage_rules, "standardized_voltage")
            rank = {"ok": 0, "warning": 1, "danger": 2, "unknown": -1}
            if rank[sev2] > rank[sev]:
                sev, thr = sev2, thr2
        asm = el_map.get((el, pos))
        cell = {
            "electrolyzer": el,
            "position": pos,
            "element_nr": row.element_nr or (asm.element_nr if asm else None),
            "anode_nr": asm.anode_nr if asm else None,
            "cathode_nr": asm.cathode_nr if asm else None,
            "membrane_nr": asm.membrane_nr if asm else None,
            "membrane_type": asm.membrane_type if asm else None,
            "voltage": row.voltage,
            "standardized_voltage": row.standardized_voltage,
            "reading_date": _sanitize_reading_dt(row.date),
            "reading_time": row.time if _sanitize_reading_dt(row.date) else None,
            "severity": sev,
            "threshold": thr,
        }
        by_el.setdefault(el, []).append(cell)

    blocks = []
    total_cells = ok = warn = danger = 0
    max_v: float | None = None
    for el, cells in sorted(by_el.items()):
        cells_sorted = sorted(cells, key=lambda c: int(c["position"]) if str(c["position"]).isdigit() else str(c["position"]))
        voltages = [c["voltage"] for c in cells_sorted if c["voltage"] is not None]
        oc = sum(1 for c in cells_sorted if c["severity"] == "ok")
        wc = sum(1 for c in cells_sorted if c["severity"] == "warning")
        dc = sum(1 for c in cells_sorted if c["severity"] == "danger")
        ok += oc
        warn += wc
        danger += dc
        total_cells += len(cells_sorted)
        el_max = max(voltages) if voltages else None
        if el_max is not None and (max_v is None or el_max > max_v):
            max_v = el_max
        latest_date = cells_sorted[0]["reading_date"] if cells_sorted else None
        latest_time = cells_sorted[0]["reading_time"] if cells_sorted else None
        for c in cells_sorted:
            if c["reading_date"] and (latest_date is None or c["reading_date"] > latest_date):
                latest_date = c["reading_date"]
                latest_time = c["reading_time"]
        blocks.append(
            {
                "electrolyzer": el,
                "reading_date": latest_date,
                "reading_time": latest_time,
                "cell_count": len(cells_sorted),
                "ok_count": oc,
                "warning_count": wc,
                "danger_count": dc,
                "max_voltage": el_max,
                "avg_voltage": (sum(voltages) / len(voltages)) if voltages else None,
                "total_voltage": sum(voltages) if voltages else None,
                "cells": cells_sorted,
            }
        )

    # Component issues (for dashboard panel; alerts also generated separately)
    anodes = {a.anode_nr: a for a in db.query(models.Anode).all()}
    cathodes = {c.cathode_nr: c for c in db.query(models.Cathode).all()}
    issues: list[dict[str, Any]] = []
    for e in elements:
        el_name = (e.electrolyzer or "").strip().upper() or None
        if not (e.anode_nr or "").strip():
            issues.append(
                {
                    "kind": "missing_anode",
                    "severity": "warning",
                    "electrolyzer": el_name,
                    "position": e.position,
                    "element_nr": e.element_nr,
                    "component_ref": None,
                    "detail": "No anode assigned",
                }
            )
        else:
            a = anodes.get(e.anode_nr.strip())
            if a and a.decommission_date is not None:
                issues.append(
                    {
                        "kind": "anode_decommissioned",
                        "severity": "danger",
                        "electrolyzer": el_name,
                        "position": e.position,
                        "element_nr": e.element_nr,
                        "component_ref": e.anode_nr,
                        "detail": f"Anode {e.anode_nr} decommissioned",
                    }
                )
        if not (e.cathode_nr or "").strip():
            issues.append(
                {
                    "kind": "missing_cathode",
                    "severity": "warning",
                    "electrolyzer": el_name,
                    "position": e.position,
                    "element_nr": e.element_nr,
                    "component_ref": None,
                    "detail": "No cathode assigned",
                }
            )
        else:
            c = cathodes.get(e.cathode_nr.strip())
            if c and c.decommission_date is not None:
                issues.append(
                    {
                        "kind": "cathode_decommissioned",
                        "severity": "danger",
                        "electrolyzer": el_name,
                        "position": e.position,
                        "element_nr": e.element_nr,
                        "component_ref": e.cathode_nr,
                        "detail": f"Cathode {e.cathode_nr} decommissioned",
                    }
                )

    recent = (
        db.query(models.AlertEvent)
        .order_by(models.AlertEvent.created_at.desc())
        .limit(40)
        .all()
    )

    summary = alert_summary(db)
    return {
        "generated_at": datetime.utcnow(),
        "summary": summary,
        "voltage": {
            "cell_count": total_cells,
            "ok_count": ok,
            "warning_count": warn,
            "danger_count": danger,
            "max_voltage": max_v,
            "electrolyzer_count": len(blocks),
            "active_elements": len(elements),
            "anode_count": len(anodes),
            "cathode_count": len(cathodes),
            "component_issue_count": len(issues),
        },
        "electrolyzers": blocks,
        "component_issues": issues[:100],
        "recent_alerts": recent,
    }
