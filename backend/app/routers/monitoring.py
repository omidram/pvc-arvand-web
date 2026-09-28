"""Plant monitoring snapshot + configurable alert rules / inbox."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import alerts_engine, models, schemas
from ..database import get_db

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


@router.get("/snapshot", response_model=schemas.MonitoringSnapshot)
def monitoring_snapshot(db: Session = Depends(get_db)):
    data = alerts_engine.build_snapshot(db)
    return schemas.MonitoringSnapshot.model_validate(data)


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
