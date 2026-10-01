from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..crud import build_crud_router
from ..database import get_db
from ..export_utils import ExportFilters, build_export_meta, export_xlsx, rows_to_dicts
from ..inspection_pdf import inspection_pdf_response

router = build_crud_router(
    model=models.InspectionReport,
    read_schema=schemas.InspectionReportRead,
    write_schema=schemas.InspectionReportBase,
    prefix="/inspections",
    tags=["inspections"],
    search_fields=["element_nr", "inspector_name", "anode_nr", "cathode_nr", "membrane_nr", "client", "electrolyzer"],
    default_order="inspection_date",
)

grids_router = APIRouter(prefix="/inspections/{inspection_id}/grids", tags=["inspections"])

GRID_TYPES = {"anode_half", "cathode_half", "membrane_as", "membrane_ks", "membrane_lt"}


def _drop_route(app_router: APIRouter, path_suffix: str, method: str = "GET") -> None:
    kept = []
    for route in app_router.routes:
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", set()) or set()
        if path.endswith(path_suffix) and method in methods:
            continue
        kept.append(route)
    app_router.routes[:] = kept


def _grids_map(db: Session, element_nr: str | None) -> dict[str, dict]:
    if not element_nr:
        return {}
    rows = db.query(models.InspectionHalfshellGrid).filter(models.InspectionHalfshellGrid.element_nr == element_nr).all()
    return {row.grid_type: (row.grid_data or {}) for row in rows}


def _pack(db: Session, items: list[models.InspectionReport]):
    return [(item, _grids_map(db, item.element_nr)) for item in items]


_drop_route(router, "/export.pdf")
_drop_route(router, "/export.xlsx")

_XLSX_SKIP = {"sign_insp_image", "sign_maint_image", "sign_proc_image"}
_INSPECTION_EXPORT_FIELDS = [name for name in schemas.InspectionReportRead.model_fields if name not in _XLSX_SKIP]


@router.get("/export.meta", include_in_schema=False)
def export_inspection_meta():
    return build_export_meta(_INSPECTION_EXPORT_FIELDS)


@router.get("/export.xlsx", include_in_schema=False)
def export_inspection_xlsx(
    q: str | None = Query(default=None),
    skip: int = 0,
    limit: int = Query(default=20000, le=100000),
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    from sqlalchemy import or_

    query = db.query(models.InspectionReport)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                models.InspectionReport.element_nr.ilike(like),
                models.InspectionReport.inspector_name.ilike(like),
                models.InspectionReport.anode_nr.ilike(like),
                models.InspectionReport.cathode_nr.ilike(like),
                models.InspectionReport.membrane_nr.ilike(like),
            )
        )
    items = query.order_by(models.InspectionReport.inspection_date.desc()).offset(skip).limit(limit).all()
    rows = rows_to_dicts(items, _INSPECTION_EXPORT_FIELDS)
    rows, fields = filters.apply(rows, _INSPECTION_EXPORT_FIELDS)
    return export_xlsx(rows, fields, "inspections")


@router.get("/export.pdf", include_in_schema=False)
def export_inspection_forms_pdf(
    q: str | None = Query(default=None),
    id: int | None = Query(default=None),
    skip: int = 0,
    limit: int = Query(default=40, le=200),
    db: Session = Depends(get_db),
):
    if id is not None:
        item = db.query(models.InspectionReport).filter(models.InspectionReport.id == id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Inspection not found")
        return inspection_pdf_response(_pack(db, [item]), f"inspection-{item.element_nr or item.id}.pdf")
    query = db.query(models.InspectionReport)
    if q:
        from sqlalchemy import or_

        like = f"%{q}%"
        query = query.filter(
            or_(
                models.InspectionReport.element_nr.ilike(like),
                models.InspectionReport.inspector_name.ilike(like),
                models.InspectionReport.anode_nr.ilike(like),
                models.InspectionReport.cathode_nr.ilike(like),
                models.InspectionReport.membrane_nr.ilike(like),
            )
        )
    items = query.order_by(models.InspectionReport.inspection_date.desc()).offset(skip).limit(limit).all()
    return inspection_pdf_response(_pack(db, items), "inspections.pdf")


@router.get("/{item_id}/sheet.pdf", include_in_schema=False)
def export_one_inspection_pdf(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.InspectionReport).filter(models.InspectionReport.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return inspection_pdf_response(_pack(db, [item]), f"inspection-{item.element_nr or item.id}.pdf")


@grids_router.get("", response_model=list[schemas.InspectionHalfshellGridRead])
def list_grids(inspection_id: int, db: Session = Depends(get_db)):
    inspection = db.query(models.InspectionReport).filter(models.InspectionReport.id == inspection_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return (
        db.query(models.InspectionHalfshellGrid)
        .filter(models.InspectionHalfshellGrid.element_nr == inspection.element_nr)
        .all()
    )


@grids_router.put("/{grid_type}", response_model=schemas.InspectionHalfshellGridRead)
def upsert_grid(inspection_id: int, grid_type: str, payload: dict, db: Session = Depends(get_db)):
    if grid_type not in GRID_TYPES:
        raise HTTPException(status_code=400, detail=f"grid_type must be one of {sorted(GRID_TYPES)}")
    inspection = db.query(models.InspectionReport).filter(models.InspectionReport.id == inspection_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    grid = (
        db.query(models.InspectionHalfshellGrid)
        .filter(
            models.InspectionHalfshellGrid.element_nr == inspection.element_nr,
            models.InspectionHalfshellGrid.grid_type == grid_type,
        )
        .first()
    )
    if not grid:
        grid = models.InspectionHalfshellGrid(element_nr=inspection.element_nr, grid_type=grid_type, grid_data={})
        db.add(grid)
    grid.grid_data = payload
    db.commit()
    db.refresh(grid)
    return grid


def _prefer_static_exports() -> None:
    preferred = []
    rest = []
    for route in router.routes:
        path = getattr(route, "path", "")
        if path.endswith("/export.pdf") or path.endswith("/export.xlsx") or path.endswith("/sheet.pdf"):
            preferred.append(route)
        else:
            rest.append(route)
    router.routes[:] = preferred + rest


_prefer_static_exports()
