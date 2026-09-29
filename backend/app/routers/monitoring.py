"""Plant monitoring snapshot + configurable alert rules / inbox."""
import json
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import alerts_engine, models, schemas
from ..database import get_db

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


@router.get("/snapshot", response_model=schemas.MonitoringSnapshot)
def monitoring_snapshot(db: Session = Depends(get_db)):
    data = alerts_engine.build_snapshot(db)
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
    db: Session = Depends(get_db),
):
    """Cell or electrolyzer voltage history for the monitoring chart.

    span 10 or 30 means the last N readings. 90, 365 and 730 are day windows.
    """
    el = (electrolyzer or "").strip().upper()
    if not el:
        raise HTTPException(status_code=400, detail="electrolyzer is required")
    tail = span in {"10", "30"}
    days = {"90": 90, "365": 365, "730": 730}.get(span, 730 if not tail else 800)
    since = datetime.utcnow() - timedelta(days=days)
    pos = None
    if position:
        pos = position.strip()
        if pos.isdigit():
            pos = pos.lstrip("0") or "0"

    if pos:
        query = (
            db.query(models.VoltageReading)
            .filter(
                models.VoltageReading.electrolyzer == el,
                models.VoltageReading.position == pos,
                models.VoltageReading.voltage.isnot(None),
            )
            .order_by(models.VoltageReading.date.asc(), models.VoltageReading.time.asc(), models.VoltageReading.id.asc())
        )
        if not tail:
            query = query.filter(models.VoltageReading.date >= since)
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
        if not tail:
            query = query.filter(models.ElectrolyzerNormalization.date >= since)
        rows = query.all()
        points = [
            {
                "date": row.date.date().isoformat() if row.date else None,
                "time": row.time,
                "voltage": row.total_voltage,
            }
            for row in rows
            if row.total_voltage is not None
        ]
        if tail:
            points = points[-int(span) :]
        title = f"Electrolyzer voltage {el}"
        kind = "total"

    rectifier_points: list[dict] = []
    if not pos:
        rectifier_points = _rectifier_voltage_points(db, el)
        if tail:
            rectifier_points = rectifier_points[-int(span) :]
        else:
            cutoff = since.date().isoformat()
            rectifier_points = [point for point in rectifier_points if (point.get("date") or "") >= cutoff]
            rectifier_points = _sample_points(rectifier_points, 360)

    total = len(points)
    shown = points if tail else _sample_points(points, 360)
    return {
        "electrolyzer": el,
        "position": pos,
        "title": title,
        "kind": kind,
        "unit": "V",
        "span": span,
        "total": total,
        "points": shown,
        "rectifier_points": rectifier_points,
    }
