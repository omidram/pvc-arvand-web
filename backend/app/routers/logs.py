"""Admin-only audit log viewer."""
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import require_admin
from ..database import get_db

router = APIRouter(prefix="/logs", tags=["logs"], dependencies=[Depends(require_admin)])


@router.get("", response_model=schemas.AuditLogListResponse)
def list_logs(
    q: str | None = Query(default=None, description="Search username, path, summary, resource"),
    action: str | None = None,
    username: str | None = None,
    resource: str | None = None,
    success: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    query = db.query(models.AuditLog)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (models.AuditLog.username.ilike(like))
            | (models.AuditLog.path.ilike(like))
            | (models.AuditLog.summary.ilike(like))
            | (models.AuditLog.resource.ilike(like))
            | (models.AuditLog.resource_id.ilike(like))
        )
    if action:
        query = query.filter(models.AuditLog.action == action)
    if username:
        query = query.filter(models.AuditLog.username.ilike(username.strip()))
    if resource:
        query = query.filter(models.AuditLog.resource == resource)
    if success is not None:
        query = query.filter(models.AuditLog.success.is_(success))
    if date_from:
        query = query.filter(models.AuditLog.created_at >= date_from)
    if date_to:
        query = query.filter(models.AuditLog.created_at <= date_to)

    total = query.count()
    rows = query.order_by(models.AuditLog.id.desc()).offset(skip).limit(limit).all()
    return schemas.AuditLogListResponse(
        total=total,
        items=[schemas.AuditLogRead.model_validate(r) for r in rows],
    )


@router.get("/meta")
def logs_meta(db: Session = Depends(get_db)):
    actions = [
        r[0]
        for r in db.query(models.AuditLog.action).distinct().order_by(models.AuditLog.action).all()
        if r[0]
    ]
    resources = [
        r[0]
        for r in db.query(models.AuditLog.resource).distinct().order_by(models.AuditLog.resource).all()
        if r[0]
    ]
    return {"actions": actions, "resources": resources}


@router.get("/{log_id}", response_model=schemas.AuditLogRead)
def get_log(log_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException

    row = db.query(models.AuditLog).filter(models.AuditLog.id == log_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Log not found")
    return schemas.AuditLogRead.model_validate(row)
