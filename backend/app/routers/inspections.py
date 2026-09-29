from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..crud import build_crud_router
from ..database import get_db

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
