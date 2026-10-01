"""Admin-only audit log viewer."""
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import require_admin
from ..database import get_db
from ..export_utils import ExportFilters, build_export_meta, export_pdf, export_xlsx, rows_to_dicts

router = APIRouter(prefix="/logs", tags=["logs"], dependencies=[Depends(require_admin)])

XLSX_FIELDS = [
    "id",
    "created_at",
    "username",
    "user_role",
    "action",
    "resource",
    "resource_id",
    "summary",
    "success",
    "status_code",
    "method",
    "path",
    "ip_address",
    "changes",
    "before_data",
    "after_data",
]
PDF_FIELDS = [
    "created_at",
    "username",
    "action",
    "resource",
    "resource_id",
    "summary",
    "success",
    "status_code",
    "ip_address",
]


def _filtered_logs(
    db: Session,
    *,
    q: str | None = None,
    action: str | None = None,
    username: str | None = None,
    resource: str | None = None,
    success: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> SAQuery:
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
    return query


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
    query = _filtered_logs(
        db,
        q=q,
        action=action,
        username=username,
        resource=resource,
        success=success,
        date_from=date_from,
        date_to=date_to,
    )
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


@router.get("/export.meta", include_in_schema=False)
def export_logs_meta():
    return build_export_meta(XLSX_FIELDS)


@router.get("/export.xlsx", include_in_schema=False)
def export_logs_xlsx(
    q: str | None = None,
    action: str | None = None,
    username: str | None = None,
    resource: str | None = None,
    success: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    rows = (
        _filtered_logs(
            db,
            q=q,
            action=action,
            username=username,
            resource=resource,
            success=success,
            date_from=date_from,
            date_to=date_to,
        )
        .order_by(models.AuditLog.id.desc())
        .limit(50000)
        .all()
    )
    data = rows_to_dicts(rows, XLSX_FIELDS)
    data, fields = filters.apply(data, XLSX_FIELDS)
    return export_xlsx(data, fields, "audit-logs")


@router.get("/export.pdf", include_in_schema=False)
def export_logs_pdf(
    q: str | None = None,
    action: str | None = None,
    username: str | None = None,
    resource: str | None = None,
    success: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    db: Session = Depends(get_db),
):
    rows = (
        _filtered_logs(
            db,
            q=q,
            action=action,
            username=username,
            resource=resource,
            success=success,
            date_from=date_from,
            date_to=date_to,
        )
        .order_by(models.AuditLog.id.desc())
        .limit(3000)
        .all()
    )
    return export_pdf(rows_to_dicts(rows, PDF_FIELDS), PDF_FIELDS, "audit-logs")


@router.get("/{log_id}", response_model=schemas.AuditLogRead)
def get_log(log_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException

    row = db.query(models.AuditLog).filter(models.AuditLog.id == log_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Log not found")
    return schemas.AuditLogRead.model_validate(row)
