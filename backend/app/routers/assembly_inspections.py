"""CRUD + PDF for Uhde Assembly Inspection Report (مونتاژ)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..assembly_inspection_def import ACTIVITY_SECTIONS, empty_check_remarks, empty_checks
from ..assembly_inspection_pdf import assembly_inspection_pdf_response
from ..crud import build_crud_router
from ..database import get_db


def _normalize_checks(raw: dict | None) -> dict[str, bool]:
    base = empty_checks()
    if isinstance(raw, dict):
        for key in base:
            base[key] = bool(raw.get(key))
    return base


def _normalize_check_remarks(raw: dict | None) -> dict[str, str]:
    base = empty_check_remarks()
    if isinstance(raw, dict):
        for key in base:
            val = raw.get(key)
            base[key] = "" if val is None else str(val)
    return base


def prepare(obj: models.AssemblyInspectionReport) -> None:
    obj.checks = _normalize_checks(obj.checks if isinstance(obj.checks, dict) else {})
    obj.check_remarks = _normalize_check_remarks(
        obj.check_remarks if isinstance(obj.check_remarks, dict) else {}
    )


router = build_crud_router(
    model=models.AssemblyInspectionReport,
    read_schema=schemas.AssemblyInspectionReportRead,
    write_schema=schemas.AssemblyInspectionReportBase,
    prefix="/assembly-inspections",
    tags=["assembly-inspections"],
    search_fields=["element_nr", "anode_nr", "cathode_nr", "membrane_nr", "electrolyzer", "group_nr"],
    default_order="assembly_date",
    prepare=prepare,
)


def _drop_route(app_router: APIRouter, path_suffix: str, method: str = "GET") -> None:
    kept = []
    for route in app_router.routes:
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", set()) or set()
        if path.endswith(path_suffix) and method in methods:
            continue
        kept.append(route)
    app_router.routes[:] = kept


_drop_route(router, "/export.pdf")


@router.get("/checklist.meta")
def checklist_meta():
    return {"sections": ACTIVITY_SECTIONS}


@router.get("/export.pdf", include_in_schema=False)
def export_pdf(
    q: str | None = Query(default=None),
    id: int | None = Query(default=None),
    skip: int = 0,
    limit: int = Query(default=40, le=200),
    db: Session = Depends(get_db),
):
    if id is not None:
        item = db.query(models.AssemblyInspectionReport).filter(models.AssemblyInspectionReport.id == id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Assembly inspection not found")
        return assembly_inspection_pdf_response([item], f"assembly-inspection-{item.element_nr or item.id}.pdf")
    query = db.query(models.AssemblyInspectionReport)
    if q:
        from sqlalchemy import or_

        like = f"%{q}%"
        query = query.filter(
            or_(
                models.AssemblyInspectionReport.element_nr.ilike(like),
                models.AssemblyInspectionReport.anode_nr.ilike(like),
                models.AssemblyInspectionReport.cathode_nr.ilike(like),
                models.AssemblyInspectionReport.membrane_nr.ilike(like),
                models.AssemblyInspectionReport.electrolyzer.ilike(like),
            )
        )
    items = query.order_by(models.AssemblyInspectionReport.assembly_date.desc()).offset(skip).limit(limit).all()
    return assembly_inspection_pdf_response(items, "assembly-inspections.pdf")


@router.get("/{item_id}/sheet.pdf", include_in_schema=False)
def export_one_pdf(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.AssemblyInspectionReport).filter(models.AssemblyInspectionReport.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Assembly inspection not found")
    return assembly_inspection_pdf_response([item], f"assembly-inspection-{item.element_nr or item.id}.pdf")


# Static paths (checklist.meta / export.pdf) must win over /{item_id}
_static, _dynamic = [], []
for _route in router.routes:
    _path = getattr(_route, "path", "")
    (_dynamic if "{" in _path else _static).append(_route)
router.routes[:] = _static + _dynamic
