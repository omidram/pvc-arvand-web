"""Plant monitoring snapshot + configurable alert rules / inbox."""
import json
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from .. import alerts_engine, models, schemas
from ..calculations import installation_dol
from ..database import get_db
from ..export_utils import ExportFilters, build_export_meta, export_pdf, export_xlsx
from ..plant_topology import arrangement_name, rack_of, train_of
from ..warehouse import compact_nr

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


def _position_keys(position: str | None) -> list[str]:
    raw = (position or "").strip()
    if not raw:
        return []
    keys = {raw}
    try:
        number = str(int(float(raw)))
        keys.add(number)
        keys.add(number.zfill(3))
    except (TypeError, ValueError):
        pass
    return [key for key in keys if key]


@router.get("/snapshot", response_model=schemas.MonitoringSnapshot)
def monitoring_snapshot(db: Session = Depends(get_db)):
    data = alerts_engine.build_snapshot(db, evaluate=False)
    return schemas.MonitoringSnapshot.model_validate(data)


@router.get("/import-progress")
def import_progress():
    """How many of the 24 electrolyzer x 25 month AriaORMS jobs are stored."""
    path = Path(__file__).resolve().parents[2] / "instance" / "ariaorms_history_state.json"
    total = 24 * 25
    if not path.is_file():
        return {"active": False, "done": 0, "total": total, "names": []}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"active": False, "done": 0, "total": total, "names": []}
    done_map = state.get("done") or {}
    finished = 0
    names: set[str] = set()
    for key, value in done_map.items():
        text_value = str(value)
        if text_value == "ok" or "Header row" in text_value:
            finished += 1
        if text_value == "ok":
            names.add(str(key).split("|", 1)[0])
    return {
        "active": finished < total,
        "done": finished,
        "total": total,
        "names": sorted(names),
    }


def _export_date(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    return text[:10] if text else None


def _monitoring_export_pack(
    db: Session,
    *,
    scope: str,
    train: str | None,
    electrolyzer: str | None,
    position: str | None,
    status: str | None,
    span: str,
) -> tuple[list[dict], list[str], str]:
    kind = (scope or "plant").strip().lower()
    el = (electrolyzer or "").strip().upper() or None
    train_id = (train or "").strip() or (train_of(el) if el else None)

    if kind == "rules":
        alerts_engine.ensure_default_rules(db)
        rows = [
            {
                "name": row.name,
                "metric": row.metric,
                "operator": row.operator,
                "warning_threshold": row.warning_threshold,
                "danger_threshold": row.danger_threshold,
                "electrolyzer": row.electrolyzer,
                "enabled": row.enabled,
                "notify": row.notify,
                "description": row.description,
            }
            for row in db.query(models.AlertRule).order_by(models.AlertRule.id.asc()).all()
        ]
        return rows, list(rows[0].keys()) if rows else ["name"], "monitoring-thresholds"

    if kind == "alerts":
        query = db.query(models.AlertEvent)
        if status and status != "all":
            query = query.filter(models.AlertEvent.status == status)
        items = query.order_by(models.AlertEvent.created_at.desc()).limit(5000).all()
        rows = [
            {
                "id": row.id,
                "severity": row.severity,
                "status": row.status,
                "title": row.title,
                "message": row.message,
                "electrolyzer": row.electrolyzer,
                "position": row.position,
                "element_nr": row.element_nr,
                "component_ref": row.component_ref,
                "value": row.value,
                "threshold": row.threshold,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in items
        ]
        fields = [
            "id",
            "severity",
            "status",
            "title",
            "message",
            "electrolyzer",
            "position",
            "element_nr",
            "component_ref",
            "value",
            "threshold",
            "created_at",
        ]
        return rows, fields, f"monitoring-alerts-{status or 'all'}"

    if kind == "history":
        if not el:
            raise HTTPException(status_code=400, detail="electrolyzer is required")
        history = voltage_history(el, position, span, db=db)
        rows = [
            {"date": point.get("date"), "time": point.get("time"), "voltage": point.get("voltage"), "series": "cell"}
            for point in history.get("points") or []
        ]
        for point in history.get("rectifier_points") or []:
            rows.append(
                {"date": point.get("date"), "time": point.get("time"), "voltage": point.get("voltage"), "series": "rectifier"}
            )
        title = str(history.get("title") or el).replace(" ", "")
        return rows, ["date", "time", "voltage", "series"], f"monitoring-history-{title}"

    data = alerts_engine.build_snapshot(db, evaluate=False)
    blocks = data.get("electrolyzers") or []
    if kind == "train" and train_id in {"1", "2"}:
        blocks = [block for block in blocks if train_of(block.get("electrolyzer") or "") == train_id]
    if kind in {"electrolyzer", "cells"} and el:
        blocks = [block for block in blocks if str(block.get("electrolyzer") or "").upper() == el]

    if kind == "issues":
        issues = data.get("component_issues") or []
        if train_id in {"1", "2"}:
            issues = [row for row in issues if train_of(row.get("electrolyzer") or "") == train_id]
        if el:
            issues = [row for row in issues if str(row.get("electrolyzer") or "").upper() == el]
        rows = [
            {
                "kind": row.get("kind"),
                "severity": row.get("severity"),
                "electrolyzer": row.get("electrolyzer"),
                "position": row.get("position"),
                "element_nr": row.get("element_nr"),
                "component_ref": row.get("component_ref"),
                "detail": row.get("detail"),
            }
            for row in issues
        ]
        return rows, ["kind", "severity", "electrolyzer", "position", "element_nr", "component_ref", "detail"], "monitoring-issues"

    if kind in {"electrolyzer", "cells"}:
        rows = []
        for block in blocks:
            for cell in block.get("cells") or []:
                rows.append(
                    {
                        "electrolyzer": cell.get("electrolyzer") or block.get("electrolyzer"),
                        "position": cell.get("position"),
                        "voltage": cell.get("voltage"),
                        "severity": cell.get("severity"),
                        "element_nr": cell.get("element_nr"),
                        "anode_nr": cell.get("anode_nr"),
                        "cathode_nr": cell.get("cathode_nr"),
                        "membrane_nr": cell.get("membrane_nr"),
                        "membrane_type": cell.get("membrane_type"),
                        "reading_date": _export_date(cell.get("reading_date")),
                        "reading_time": cell.get("reading_time"),
                    }
                )
        fields = [
            "electrolyzer",
            "position",
            "voltage",
            "severity",
            "element_nr",
            "anode_nr",
            "cathode_nr",
            "membrane_nr",
            "membrane_type",
            "reading_date",
            "reading_time",
        ]
        label = el or train_id or "all"
        return rows, fields, f"monitoring-cells-{label}"

    rows = [
        {
            "electrolyzer": block.get("electrolyzer"),
            "train": train_of(block.get("electrolyzer") or "") or "",
            "cell_count": block.get("cell_count"),
            "ok_count": block.get("ok_count"),
            "warning_count": block.get("warning_count"),
            "danger_count": block.get("danger_count"),
            "avg_voltage": block.get("avg_voltage"),
            "max_voltage": block.get("max_voltage"),
            "total_voltage": block.get("total_voltage"),
            "current_ka": block.get("current_ka"),
            "power_kw": block.get("power_kw"),
            "energy_kwh_24h": block.get("energy_kwh_24h"),
            "energy_kwh_30d": block.get("energy_kwh_30d"),
            "reading_date": _export_date(block.get("reading_date")),
            "reading_time": block.get("reading_time"),
        }
        for block in blocks
    ]
    fields = [
        "electrolyzer",
        "train",
        "cell_count",
        "ok_count",
        "warning_count",
        "danger_count",
        "avg_voltage",
        "max_voltage",
        "total_voltage",
        "current_ka",
        "power_kw",
        "energy_kwh_24h",
        "energy_kwh_30d",
        "reading_date",
        "reading_time",
    ]
    label = f"train{train_id}" if kind == "train" and train_id else "plant"
    return rows, fields, f"monitoring-{label}"


@router.get("/export.meta", include_in_schema=False)
def export_monitoring_meta(
    db: Session = Depends(get_db),
    scope: str = Query(default="plant"),
    train: str | None = None,
    electrolyzer: str | None = None,
    position: str | None = None,
    status: str | None = Query(default="open"),
    span: str = Query(default="30"),
):
    _, fields, _ = _monitoring_export_pack(
        db, scope=scope, train=train, electrolyzer=electrolyzer, position=position, status=status, span=span
    )
    return build_export_meta(fields)


@router.get("/export.xlsx", include_in_schema=False)
def export_monitoring_xlsx(
    db: Session = Depends(get_db),
    scope: str = Query(default="plant"),
    train: str | None = None,
    electrolyzer: str | None = None,
    position: str | None = None,
    status: str | None = Query(default="open"),
    span: str = Query(default="30"),
    filters: ExportFilters = Depends(),
):
    rows, fields, title = _monitoring_export_pack(
        db, scope=scope, train=train, electrolyzer=electrolyzer, position=position, status=status, span=span
    )
    rows, fields = filters.apply(rows, fields)
    return export_xlsx(rows, fields, title)


@router.get("/export.pdf", include_in_schema=False)
def export_monitoring_pdf(
    db: Session = Depends(get_db),
    scope: str = Query(default="plant"),
    train: str | None = None,
    electrolyzer: str | None = None,
    position: str | None = None,
    status: str | None = Query(default="open"),
    span: str = Query(default="30"),
    filters: ExportFilters = Depends(),
):
    rows, fields, title = _monitoring_export_pack(
        db, scope=scope, train=train, electrolyzer=electrolyzer, position=position, status=status, span=span
    )
    rows, fields = filters.apply(rows, fields)
    return export_pdf(rows[:2000], fields, title)


@router.get("/summary", response_model=schemas.AlertSummary)
def monitoring_summary(db: Session = Depends(get_db)):
    alerts_engine.ensure_default_rules(db)
    return schemas.AlertSummary(**alerts_engine.alert_summary(db))


@router.post("/evaluate")
def run_evaluation(db: Session = Depends(get_db)):
    result = alerts_engine.evaluate_all(db)
    return {"ok": True, **result, "summary": alerts_engine.alert_summary(db)}


@router.get("/rules", response_model=list[schemas.AlertRuleRead])
def list_rules(db: Session = Depends(get_db)):
    alerts_engine.ensure_default_rules(db)
    return db.query(models.AlertRule).order_by(models.AlertRule.id.asc()).all()


@router.post("/rules", response_model=schemas.AlertRuleRead)
def create_rule(payload: schemas.AlertRuleBase, db: Session = Depends(get_db)):
    obj = models.AlertRule(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/rules/{rule_id}", response_model=schemas.AlertRuleRead)
def update_rule(rule_id: int, payload: schemas.AlertRuleUpdate, db: Session = Depends(get_db)):
    obj = db.query(models.AlertRule).filter(models.AlertRule.id == rule_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Rule not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    # Re-score inbox immediately so KPI / badges match new limits
    alerts_engine.evaluate_all(db)
    return obj


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.AlertRule).filter(models.AlertRule.id == rule_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(obj)
    db.commit()
    return {"ok": True}


@router.get("/alerts", response_model=list[schemas.AlertEventRead])
def list_alerts(
    db: Session = Depends(get_db),
    status: str | None = Query(default="open"),
    severity: str | None = None,
    category: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    q = db.query(models.AlertEvent)
    if status and status != "all":
        q = q.filter(models.AlertEvent.status == status)
    if severity:
        q = q.filter(models.AlertEvent.severity == severity)
    if category:
        q = q.filter(models.AlertEvent.category == category)
    return q.order_by(models.AlertEvent.created_at.desc()).limit(limit).all()


@router.post("/alerts/{alert_id}/acknowledge", response_model=schemas.AlertEventRead)
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.AlertEvent).filter(models.AlertEvent.id == alert_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Alert not found")
    obj.status = "acknowledged"
    obj.acknowledged_at = datetime.utcnow()
    obj.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/alerts/{alert_id}/resolve", response_model=schemas.AlertEventRead)
def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.AlertEvent).filter(models.AlertEvent.id == alert_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Alert not found")
    obj.status = "resolved"
    obj.resolved_at = datetime.utcnow()
    obj.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/alerts/resolve-all")
def resolve_all_open(db: Session = Depends(get_db), severity: str | None = None):
    q = db.query(models.AlertEvent).filter(models.AlertEvent.status.in_(("open", "acknowledged")))
    if severity:
        q = q.filter(models.AlertEvent.severity == severity)
    now = datetime.utcnow()
    count = 0
    for obj in q.all():
        obj.status = "resolved"
        obj.resolved_at = now
        obj.updated_at = now
        count += 1
    db.commit()
    return {"ok": True, "resolved": count}


def _rectifier_voltage_points(db: Session, electrolyzer: str) -> list[dict]:
    exists = db.execute(
        text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rectifier_readings'")
    ).scalar()
    if not exists:
        return []
    rows = db.execute(
        text(
            """
            SELECT date, time, voltage_vdc
            FROM rectifier_readings
            WHERE upper(electrolyzer) = :el AND voltage_vdc IS NOT NULL
            ORDER BY date, time, id
            """
        ),
        {"el": electrolyzer},
    ).fetchall()
    points: list[dict] = []
    for raw_date, raw_time, voltage in rows:
        if hasattr(raw_date, "date"):
            iso = raw_date.date().isoformat()
        elif isinstance(raw_date, str) and raw_date:
            iso = raw_date[:10]
        else:
            iso = None
        points.append({"date": iso, "time": raw_time, "voltage": voltage})
    return points


def _sample_points(points: list[dict], limit: int) -> list[dict]:
    if len(points) <= limit:
        return points
    if limit < 2:
        return points[:1]
    step = (len(points) - 1) / (limit - 1)
    return [points[round(i * step)] for i in range(limit)]


@router.get("/voltage-history")
def voltage_history(
    electrolyzer: str,
    position: str | None = None,
    span: str = Query(default="30"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Cell or electrolyzer voltage history for the monitoring chart.

    span 10 or 30 means the last N readings. 90, 365 and 730 are day windows.
    Pass date_from / date_to (with span=custom or any span) for an explicit calendar range.
    """
    el = (electrolyzer or "").strip().upper()
    if not el:
        raise HTTPException(status_code=400, detail="electrolyzer is required")
    custom = bool(date_from or date_to) or span == "custom"
    if span == "custom" and not date_from and not date_to:
        raise HTTPException(status_code=400, detail="date_from or date_to is required for custom range")
    tail = (not custom) and span in {"10", "30"}
    days = {"90": 90, "365": 365, "730": 730}.get(span, 730 if not tail else 800)
    since = datetime.utcnow() - timedelta(days=days)
    pos = None
    pos_keys: list[str] = []
    if position:
        pos = position.strip()
        if pos.isdigit() or (pos.replace(".", "", 1).isdigit()):
            pos = pos.lstrip("0") or "0"
        pos_keys = _position_keys(pos)

    def _apply_window(query, date_col):
        if custom:
            if date_from is not None:
                query = query.filter(date_col >= datetime.combine(date_from, datetime.min.time()))
            if date_to is not None:
                query = query.filter(date_col <= datetime.combine(date_to, datetime.max.time()))
            return query
        if not tail:
            query = query.filter(date_col >= since)
        return query

    if pos:
        query = (
            db.query(models.VoltageReading)
            .filter(
                models.VoltageReading.electrolyzer == el,
                models.VoltageReading.position.in_(pos_keys),
                models.VoltageReading.voltage.isnot(None),
            )
            .order_by(models.VoltageReading.date.asc(), models.VoltageReading.time.asc(), models.VoltageReading.id.asc())
        )
        query = _apply_window(query, models.VoltageReading.date)
        rows = query.all()
        points = [
            {
                "date": row.date.date().isoformat() if row.date else None,
                "time": row.time,
                "voltage": row.voltage,
            }
            for row in rows
            if row.voltage is not None
        ]
        if tail:
            points = points[-int(span) :]
        title = f"{el}-{pos.zfill(3)}"
        kind = "cell"
    else:
        query = (
            db.query(models.ElectrolyzerNormalization)
            .filter(
                models.ElectrolyzerNormalization.electrolyzer == el,
                models.ElectrolyzerNormalization.total_voltage.isnot(None),
            )
            .order_by(
                models.ElectrolyzerNormalization.date.asc(),
                models.ElectrolyzerNormalization.time.asc(),
                models.ElectrolyzerNormalization.id.asc(),
            )
        )
        query = _apply_window(query, models.ElectrolyzerNormalization.date)
        rows = query.all()
        points = [
            {
                "date": row.date.date().isoformat() if row.date else None,
                "time": row.time,
                "voltage": row.total_voltage,
                "current_ka": float(row.total_current) if row.total_current is not None else None,
            }
            for row in rows
            if row.total_voltage is not None
        ]
        if tail:
            points = points[-int(span) :]
        title = f"Electrolyzer voltage {el}"
        kind = "total"

    # Attach electrolyzer load (kA) to every point (same date+time) for cell tooltips.
    # Include two days before the first point so "previous day" tooltip values resolve.
    load_by_slot: dict[tuple[str, str], float] = {}
    if points:
        day_keys = sorted({p["date"] for p in points if p.get("date")})
        if day_keys:
            first_day = datetime.fromisoformat(day_keys[0]).date() - timedelta(days=2)
            last_day = datetime.fromisoformat(day_keys[-1]).date()
            norm_q = (
                db.query(models.ElectrolyzerNormalization)
                .filter(
                    models.ElectrolyzerNormalization.electrolyzer == el,
                    models.ElectrolyzerNormalization.total_current.isnot(None),
                    models.ElectrolyzerNormalization.date
                    >= datetime.combine(first_day, datetime.min.time()),
                    models.ElectrolyzerNormalization.date
                    <= datetime.combine(last_day, datetime.max.time()),
                )
            )
            for row in norm_q.all():
                if row.date is None or row.total_current is None:
                    continue
                day = row.date.date().isoformat() if isinstance(row.date, datetime) else str(row.date)[:10]
                tlabel = (row.time or "").strip()
                load_by_slot[(day, tlabel)] = float(row.total_current)
        for point in points:
            day = point.get("date") or ""
            tlabel = (point.get("time") or "").strip()
            if point.get("current_ka") is None:
                if (day, tlabel) in load_by_slot:
                    point["current_ka"] = load_by_slot[(day, tlabel)]
                else:
                    day_loads = [v for (d, _t), v in load_by_slot.items() if d == day]
                    if day_loads:
                        point["current_ka"] = day_loads[-1]
            # Previous calendar days at the same clock slot (for chart tooltip).
            if day:
                try:
                    base = datetime.fromisoformat(day).date()
                except ValueError:
                    base = None
                if base is not None:
                    prev = (base - timedelta(days=1)).isoformat()
                    prev2 = (base - timedelta(days=2)).isoformat()
                    point["prev_day_ka"] = load_by_slot.get((prev, tlabel))
                    point["prev2_day_ka"] = load_by_slot.get((prev2, tlabel))
                    if point["prev_day_ka"] is None:
                        day_loads = [v for (d, _t), v in load_by_slot.items() if d == prev]
                        point["prev_day_ka"] = day_loads[-1] if day_loads else None
                    if point["prev2_day_ka"] is None:
                        day_loads = [v for (d, _t), v in load_by_slot.items() if d == prev2]
                        point["prev2_day_ka"] = day_loads[-1] if day_loads else None

    rectifier_points: list[dict] = []
    if not pos:
        rectifier_points = _rectifier_voltage_points(db, el)
        if custom:
            lo = date_from.isoformat() if date_from else ""
            hi = date_to.isoformat() if date_to else "9999-12-31"
            rectifier_points = [
                point
                for point in rectifier_points
                if (not lo or (point.get("date") or "") >= lo) and (not date_to or (point.get("date") or "") <= hi)
            ]
            rectifier_points = _sample_points(rectifier_points, 360)
        elif tail:
            rectifier_points = rectifier_points[-int(span) :]
        else:
            cutoff = since.date().isoformat()
            rectifier_points = [point for point in rectifier_points if (point.get("date") or "") >= cutoff]
            rectifier_points = _sample_points(rectifier_points, 360)

    total = len(points)
    shown = points if (tail or custom) else _sample_points(points, 360)
    if custom and len(shown) > 2000:
        shown = _sample_points(shown, 2000)
    return {
        "electrolyzer": el,
        "position": pos,
        "title": title,
        "kind": kind,
        "unit": "V",
        "span": "custom" if custom else span,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "total": total,
        "points": shown,
        "rectifier_points": rectifier_points,
    }


def _stamp(value):
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    return datetime.min


def _iso(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def _element_brief(row: models.Element) -> dict:
    pos = alerts_engine._norm_pos(row.position)
    rack = rack_of(pos)
    return {
        "id": row.id,
        "element_nr": row.element_nr,
        "electrolyzer": (row.electrolyzer or "").strip().upper() or None,
        "position": pos or None,
        "train": train_of(row.electrolyzer or ""),
        "rack": rack["id"] if rack else None,
        "anode_nr": row.anode_nr,
        "cathode_nr": row.cathode_nr,
        "membrane_nr": row.membrane_nr,
        "membrane_type": row.membrane_type,
        "assembly_date": _iso(row.assembly_date),
        "commissioning_date": _iso(row.commissioning_date),
        "disassembly_date": _iso(row.disassembly_date),
        "dol_days": installation_dol(
            row.assembly_date,
            row.commissioning_date,
            row.disassembly_date,
            row.decommissioning_date,
        ),
        "active": row.disassembly_date is None,
        "anode_coating": row.anode_coating,
        "cathode_coating": row.cathode_coating,
        "gap_mm": row.gap_mm,
        "remarks": row.remarks,
    }


@router.get("/cell")
def cell_properties(
    electrolyzer: str,
    position: str,
    db: Session = Depends(get_db),
):
    """Mounted element and earlier installations for one cell slot."""
    el = (electrolyzer or "").strip().upper()
    pos = alerts_engine._norm_pos(position)
    if not el or not pos:
        raise HTTPException(status_code=400, detail="electrolyzer and position are required")
    rows = (
        db.query(models.Element)
        .filter(func.upper(models.Element.electrolyzer) == el)
        .all()
    )
    matched = [row for row in rows if alerts_engine._norm_pos(row.position) == pos]
    matched.sort(
        key=lambda row: (
            _stamp(row.commissioning_date or row.assembly_date),
            row.id or 0,
        ),
        reverse=True,
    )
    current = next((row for row in matched if row.disassembly_date is None), None)
    rack = rack_of(pos)
    return {
        "electrolyzer": el,
        "position": pos,
        "position_label": pos.zfill(3),
        "train": train_of(el),
        "arrangement": arrangement_name(el),
        "rack": rack["id"] if rack else None,
        "rack_start": rack["start"] if rack else None,
        "rack_end": rack["end"] if rack else None,
        "current": _element_brief(current) if current else None,
        "history": [_element_brief(row) for row in matched],
    }


@router.get("/cell-health")
def cell_health(
    electrolyzer: str,
    position: str,
    db: Session = Depends(get_db),
):
    """Cell Health Index + operating history for one slot (peer-aware)."""
    from ..cell_health import build_cell_health

    el = (electrolyzer or "").strip().upper()
    pos = alerts_engine._norm_pos(position)
    if not el or not pos:
        raise HTTPException(status_code=400, detail="electrolyzer and position are required")
    try:
        return build_cell_health(db, el, pos)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/cell-health-board")
def cell_health_board(
    electrolyzer: str,
    db: Session = Depends(get_db),
):
    """Peer comparison board + investigation list for one electrolyzer."""
    from ..cell_health import build_cell_health_board

    el = (electrolyzer or "").strip().upper()
    if not el:
        raise HTTPException(status_code=400, detail="electrolyzer is required")
    try:
        return build_cell_health_board(db, el)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _count_map(pairs: list) -> list[dict]:
    return [{"label": label or "—", "count": int(count)} for label, count in pairs if count]


def _electrolyzer_aliases(el: str) -> list[str]:
    aliases = {el, el.lower(), el.upper()}
    arranged = arrangement_name(el)
    if arranged:
        aliases.update({arranged, arranged.lower(), arranged.upper()})
    train = train_of(el)
    if train == "1":
        aliases.update({"081", "Train I", "train i", "I"})
    elif train == "2":
        aliases.update({"082", "Train II", "train ii", "II"})
    return [item for item in aliases if item]


@router.get("/electrolyzer")
def electrolyzer_properties(electrolyzer: str, db: Session = Depends(get_db)):
    """Assembly, plant layout, voltage, CE, analyses, alerts and shutdowns for one electrolyzer."""
    el = (electrolyzer or "").strip().upper()
    if not el:
        raise HTTPException(status_code=400, detail="electrolyzer is required")
    aliases = _electrolyzer_aliases(el)
    arranged = arrangement_name(el)
    train = train_of(el)

    layout_rows = (
        db.query(models.ElectrolyzerArrangement)
        .filter(func.upper(models.ElectrolyzerArrangement.name) == (arranged or el).upper())
        .order_by(models.ElectrolyzerArrangement.block.asc(), models.ElectrolyzerArrangement.id.asc())
        .all()
    )
    layout = [
        {
            "block": row.block,
            "transformer": row.transformer,
            "rectifier": row.rectifier,
            "sub_plant": row.sub_plant,
            "start_position": row.start_position,
            "end_position": row.end_position,
        }
        for row in layout_rows
    ]

    elements = (
        db.query(models.Element)
        .filter(func.upper(models.Element.electrolyzer) == el)
        .all()
    )
    active = [row for row in elements if row.disassembly_date is None]
    dismantled = [row for row in elements if row.disassembly_date is not None]
    occupied = {
        alerts_engine._norm_pos(row.position)
        for row in active
        if alerts_engine._norm_pos(row.position)
    }
    dol_values = [
        installation_dol(row.assembly_date, row.commissioning_date, row.disassembly_date, row.decommissioning_date)
        for row in active
    ]
    dol_values = [value for value in dol_values if value is not None]
    membrane_types = (
        db.query(models.Element.membrane_type, func.count())
        .filter(func.upper(models.Element.electrolyzer) == el, models.Element.disassembly_date.is_(None))
        .group_by(models.Element.membrane_type)
        .order_by(func.count().desc())
        .all()
    )
    coatings = (
        db.query(models.Element.anode_coating, func.count())
        .filter(func.upper(models.Element.electrolyzer) == el, models.Element.disassembly_date.is_(None))
        .group_by(models.Element.anode_coating)
        .order_by(func.count().desc())
        .limit(8)
        .all()
    )
    recent_installs = sorted(
        active,
        key=lambda row: (_stamp(row.commissioning_date or row.assembly_date), row.id or 0),
        reverse=True,
    )[:8]
    recent_dismantles = sorted(
        dismantled,
        key=lambda row: (_stamp(row.disassembly_date or row.decommissioning_date), row.id or 0),
        reverse=True,
    )[:8]

    norm = (
        db.query(models.ElectrolyzerNormalization)
        .filter(func.upper(models.ElectrolyzerNormalization.electrolyzer) == el)
        .order_by(models.ElectrolyzerNormalization.date.desc(), models.ElectrolyzerNormalization.id.desc())
        .first()
    )
    ce = (
        db.query(models.CurrentEfficiencyEntry)
        .filter(
            models.CurrentEfficiencyEntry.scope == "electrolyzer",
            func.upper(models.CurrentEfficiencyEntry.scope_ref).in_([item.upper() for item in aliases]),
        )
        .order_by(models.CurrentEfficiencyEntry.date.desc(), models.CurrentEfficiencyEntry.id.desc())
        .first()
    )
    analyses = (
        db.query(models.AnalysisSample)
        .filter(
            models.AnalysisSample.scope == "electrolyzer",
            func.upper(models.AnalysisSample.electrolyzer) == el,
        )
        .order_by(models.AnalysisSample.date.desc(), models.AnalysisSample.id.desc())
        .limit(8)
        .all()
    )
    alerts = (
        db.query(models.AlertEvent)
        .filter(func.upper(models.AlertEvent.electrolyzer) == el, models.AlertEvent.status != "resolved")
        .order_by(models.AlertEvent.created_at.desc(), models.AlertEvent.id.desc())
        .limit(8)
        .all()
    )
    shutdowns = (
        db.query(models.Shutdown)
        .filter(models.Shutdown.plant_part.in_(aliases))
        .order_by(models.Shutdown.shutdown_time.desc(), models.Shutdown.nr.desc())
        .limit(8)
        .all()
    )
    inspections = (
        db.query(models.InspectionReport)
        .filter(func.upper(models.InspectionReport.electrolyzer) == el)
        .order_by(models.InspectionReport.inspection_date.desc(), models.InspectionReport.id.desc())
        .limit(8)
        .all()
    )

    return {
        "electrolyzer": el,
        "train": train,
        "arrangement": arranged,
        "layout": layout,
        "summary": {
            "installations": len(elements),
            "active_cells": len(active),
            "occupied_positions": len(occupied),
            "empty_positions": max(0, 168 - len(occupied)),
            "dismantled": len(dismantled),
            "avg_dol_days": round(sum(dol_values) / len(dol_values)) if dol_values else None,
            "membrane_types": _count_map(membrane_types),
            "anode_coatings": _count_map(coatings),
        },
        "normalization": None
        if norm is None
        else {
            "date": _iso(norm.date),
            "time": norm.time,
            "total_current": norm.total_current,
            "total_voltage": norm.total_voltage,
            "element_count": norm.element_count,
            "anolyte_temp": norm.anolyte_temp,
            "catholyte_temp": norm.catholyte_temp,
            "catholyte_conc": norm.catholyte_conc,
            "cl2_pct": norm.cl2_pct,
            "h2_pct": norm.h2_pct,
            "rack_a_avg": norm.rack_a_avg,
            "rack_b_avg": norm.rack_b_avg,
        },
        "current_efficiency": None
        if ce is None
        else {"date": _iso(ce.date), "value_pct": ce.value_pct, "scope_ref": ce.scope_ref},
        "analyses": [
            {
                "id": row.id,
                "analysis_type": row.analysis_type,
                "date": _iso(row.date),
                "time": row.time,
                "parameters": row.parameters or {},
            }
            for row in analyses
        ],
        "alerts": [
            {
                "id": row.id,
                "severity": row.severity,
                "status": row.status,
                "title": row.title,
                "message": row.message,
                "position": row.position,
                "value": row.value,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in alerts
        ],
        "shutdowns": [
            {
                "nr": row.nr,
                "plant_part": row.plant_part,
                "shutdown_time": row.shutdown_time.isoformat() if row.shutdown_time else None,
                "startup_time": row.startup_time.isoformat() if row.startup_time else None,
                "category": row.category,
                "cause": row.cause,
                "remarks": row.remarks,
            }
            for row in shutdowns
        ],
        "inspections": [
            {
                "id": row.id,
                "element_nr": row.element_nr,
                "position": row.position,
                "inspection_date": _iso(row.inspection_date),
                "inspection_reason": row.inspection_reason,
                "inspector_name": row.inspector_name,
            }
            for row in inspections
        ],
        "recent_installs": [_element_brief(row) for row in recent_installs],
        "recent_dismantles": [_element_brief(row) for row in recent_dismantles],
    }


_PARTS = {
    "anode": (models.Anode, "anode_nr", models.AnodeMaintenance, "anode_nr", models.Element.anode_nr),
    "cathode": (models.Cathode, "cathode_nr", models.CathodeMaintenance, "cathode_nr", models.Element.cathode_nr),
    "membrane": (models.Membrane, "membrane_nr", models.MembraneMaintenance, "membrane_nr", models.Element.membrane_nr),
}


def _same_serial(column, key: str):
    return func.replace(func.upper(column), " ", "") == key


def _catalog_brief(kind: str, row) -> dict | None:
    if row is None:
        return None
    if kind == "membrane":
        return {
            "nr": row.membrane_nr,
            "membrane_type": row.membrane_type,
            "manufacturer": None,
            "coating": None,
            "batch": row.batch,
            "generation": None,
            "received_date": _iso(row.received_date),
            "decommission_date": _iso(row.decommission_date),
            "remarks": row.remarks,
        }
    return {
        "nr": getattr(row, "anode_nr", None) or getattr(row, "cathode_nr", None),
        "membrane_type": None,
        "manufacturer": row.manufacturer,
        "coating": row.coating,
        "batch": row.batch,
        "generation": row.generation,
        "received_date": _iso(row.received_date),
        "decommission_date": _iso(row.decommission_date),
        "remarks": row.remarks,
    }


def _maintenance_brief(kind: str, row) -> dict:
    if kind == "membrane":
        return {
            "id": row.id,
            "date": _iso(row.date),
            "finding": None,
            "action": row.repair_work,
            "dispatch_date": None,
            "return_date": None,
        }
    return {
        "id": row.id,
        "date": _iso(row.date),
        "finding": row.finding,
        "action": row.action,
        "dispatch_date": _iso(row.dispatch_date),
        "return_date": _iso(row.return_date),
    }


@router.get("/component")
def component_dossier(
    kind: str,
    nr: str,
    db: Session = Depends(get_db),
):
    """Catalog, place, installations, maintenance and uploaded reports for one part."""
    kind = (kind or "").strip().lower()
    if kind not in _PARTS:
        raise HTTPException(status_code=400, detail="kind must be anode, cathode or membrane")
    key = compact_nr(nr)
    if not key:
        raise HTTPException(status_code=400, detail="nr is required")
    model, pk, maint_model, maint_field, element_field = _PARTS[kind]
    catalog = db.query(model).filter(_same_serial(getattr(model, pk), key)).first()
    installations = (
        db.query(models.Element)
        .filter(_same_serial(element_field, key))
        .all()
    )
    installations.sort(
        key=lambda row: (
            _stamp(row.commissioning_date or row.assembly_date),
            row.id or 0,
        ),
        reverse=True,
    )
    maintenance = (
        db.query(maint_model)
        .filter(_same_serial(getattr(maint_model, maint_field), key))
        .all()
    )
    maintenance.sort(key=lambda row: (_stamp(row.date), row.id or 0), reverse=True)
    reports = (
        db.query(models.MaintenanceReport)
        .filter(
            models.MaintenanceReport.kind == kind,
            _same_serial(models.MaintenanceReport.component_nr, key),
        )
        .order_by(models.MaintenanceReport.report_date.desc(), models.MaintenanceReport.id.desc())
        .all()
    )
    file_counts: dict[int, int] = {}
    if reports:
        counted = (
            db.query(models.MaintenanceReportFile.report_id, func.count())
            .filter(models.MaintenanceReportFile.report_id.in_([row.id for row in reports]))
            .group_by(models.MaintenanceReportFile.report_id)
            .all()
        )
        file_counts = {report_id: count for report_id, count in counted}

    latest = installations[0] if installations else None
    active = next((row for row in installations if row.disassembly_date is None and (row.electrolyzer or "").strip()), None)
    open_job = next(
        (
            row
            for row in maintenance
            if kind != "membrane" and row.dispatch_date is not None and row.return_date is None
        ),
        None,
    )
    if catalog is not None and catalog.decommission_date is not None:
        status = "decommissioned"
    elif active is not None:
        status = "mounted"
    elif open_job is not None:
        status = "repair"
    elif latest is not None:
        status = "dismantled"
    else:
        status = "spare"
    place_row = active or (latest if status == "dismantled" else None)
    place = None
    if place_row is not None:
        brief = _element_brief(place_row)
        place = {
            "electrolyzer": brief["electrolyzer"],
            "position": brief["position"],
            "train": brief["train"],
            "rack": brief["rack"],
            "active": brief["active"],
        }
    shown = catalog.anode_nr if kind == "anode" and catalog else None
    if kind == "cathode" and catalog:
        shown = catalog.cathode_nr
    if kind == "membrane" and catalog:
        shown = catalog.membrane_nr
    catalog_out = _catalog_brief(kind, catalog)
    if catalog_out is not None and not catalog_out.get("coating") and place_row is not None and kind in {"anode", "cathode"}:
        install_coating = place_row.anode_coating if kind == "anode" else place_row.cathode_coating
        if install_coating:
            catalog_out["coating"] = install_coating
    if catalog_out is None and place_row is not None and kind in {"anode", "cathode"}:
        install_coating = place_row.anode_coating if kind == "anode" else place_row.cathode_coating
        if install_coating or place_row:
            catalog_out = {
                "nr": (nr or "").strip(),
                "membrane_type": None,
                "manufacturer": None,
                "coating": install_coating,
                "batch": None,
                "generation": None,
                "received_date": None,
                "decommission_date": None,
                "remarks": None,
            }
    return {
        "kind": kind,
        "nr": shown or (nr or "").strip(),
        "status": status,
        "place": place,
        "catalog": catalog_out,
        "installations": [_element_brief(row) for row in installations[:40]],
        "maintenance": [_maintenance_brief(kind, row) for row in maintenance[:40]],
        "reports": [
            {
                "id": row.id,
                "report_date": _iso(row.report_date),
                "title": row.title,
                "notes": row.notes,
                "file_count": file_counts.get(row.id, 0),
            }
            for row in reports[:40]
        ],
    }
