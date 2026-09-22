"""Element Administration: Assembly Data (the core module), Groups, Inspection Reasons, Cell Components."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..calculations import days_on_line
from ..crud import build_crud_router
from ..database import get_db
from ..export_utils import export_pdf, export_xlsx, rows_to_dicts
from ..plant_import import parse_assembly_excel

router = APIRouter(prefix="/elements", tags=["elements"])


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        try:
            return datetime.fromisoformat(value).date()
        except ValueError:
            return None

ELEMENT_EXPORT_FIELDS = list(schemas.ElementRead.model_fields.keys())


def _enrich(obj: models.Element) -> schemas.ElementRead:
    read = schemas.ElementRead.model_validate(obj)
    read.computed_dol_days = days_on_line(obj.commissioning_date, obj.decommissioning_date)
    read.status = "active" if obj.commissioning_date and not obj.decommissioning_date else (
        "disassembled" if obj.disassembly_date else "decommissioned" if obj.decommissioning_date else "planned"
    )
    return read


@router.get("", response_model=list[schemas.ElementRead])
def list_elements(
    q: str | None = Query(default=None),
    electrolyzer: str | None = None,
    group_nr: str | None = None,
    active_only: bool = False,
    skip: int = 0,
    limit: int = Query(default=500, le=5000),
    db: Session = Depends(get_db),
):
    query = db.query(models.Element)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                models.Element.element_nr.ilike(like),
                models.Element.anode_nr.ilike(like),
                models.Element.cathode_nr.ilike(like),
                models.Element.membrane_nr.ilike(like),
                models.Element.remarks.ilike(like),
            )
        )
    if electrolyzer:
        query = query.filter(models.Element.electrolyzer == electrolyzer)
    if group_nr:
        query = query.filter(models.Element.group_nr == group_nr)
    if active_only:
        query = query.filter(models.Element.disassembly_date.is_(None))
    items = query.order_by(models.Element.id.desc()).offset(skip).limit(limit).all()
    return [_enrich(i) for i in items]


@router.get("/export.xlsx", include_in_schema=False)
def export_elements_xlsx(q: str | None = None, electrolyzer: str | None = None, db: Session = Depends(get_db)):
    items = list_elements(q=q, electrolyzer=electrolyzer, limit=20000, db=db)
    rows = rows_to_dicts(items, ELEMENT_EXPORT_FIELDS)
    return export_xlsx(rows, ELEMENT_EXPORT_FIELDS, "elements")


@router.get("/export.pdf", include_in_schema=False)
def export_elements_pdf(q: str | None = None, electrolyzer: str | None = None, db: Session = Depends(get_db)):
    items = list_elements(q=q, electrolyzer=electrolyzer, limit=2000, db=db)
    rows = rows_to_dicts(items, ELEMENT_EXPORT_FIELDS)
    return export_pdf(rows, ELEMENT_EXPORT_FIELDS, "elements")


@router.post("/import-assembly-excel")
async def import_assembly_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Import plant assembly / install / dismantle Excel (مونتاژ - نصب و دی مونتاژ)."""
    content = await file.read()
    parsed = parse_assembly_excel(content)
    if parsed.get("error"):
        raise HTTPException(status_code=400, detail=parsed["error"])

    created = 0
    for item in parsed.get("elements") or []:
        db.add(
            models.Element(
                element_nr=item.get("element_nr"),
                electrolyzer=item.get("electrolyzer"),
                position=item.get("position"),
                anode_nr=item.get("anode_nr"),
                cathode_nr=item.get("cathode_nr"),
                membrane_nr=item.get("membrane_nr"),
                membrane_type=item.get("membrane_type"),
                membrane_info=item.get("membrane_info"),
                assembly_date=_parse_iso_date(item.get("assembly_date")),
                commissioning_date=_parse_iso_date(item.get("commissioning_date")),
                decommissioning_date=_parse_iso_date(item.get("decommissioning_date")),
                disassembly_date=_parse_iso_date(item.get("disassembly_date")),
                remarks=item.get("remarks"),
            )
        )
        created += 1
        if created % 500 == 0:
            db.commit()
    db.commit()
    return {"imported_rows": created, "preview": (parsed.get("elements") or [])[:3]}


@router.get("/{item_id}", response_model=schemas.ElementRead)
def get_element(item_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.Element).filter(models.Element.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return _enrich(obj)


@router.post("", response_model=schemas.ElementRead, status_code=201)
def create_element(payload: schemas.ElementBase, db: Session = Depends(get_db)):
    obj = models.Element(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _enrich(obj)


@router.put("/{item_id}", response_model=schemas.ElementRead)
def update_element(item_id: int, payload: schemas.ElementBase, db: Session = Depends(get_db)):
    obj = db.query(models.Element).filter(models.Element.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return _enrich(obj)


@router.delete("/{item_id}", status_code=204)
def delete_element(item_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.Element).filter(models.Element.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(obj)
    db.commit()
    return None


@router.get("/by-element-nr/{element_nr}/history", response_model=list[schemas.ElementRead])
def element_history(element_nr: str, db: Session = Depends(get_db)):
    """All installations of a given element number over time (it can be reused)."""
    items = (
        db.query(models.Element)
        .filter(models.Element.element_nr == element_nr)
        .order_by(models.Element.assembly_date.asc())
        .all()
    )
    return [_enrich(i) for i in items]


@router.get("/duplicates/{component_type}")
def find_duplicates(component_type: str, db: Session = Depends(get_db)):
    """Detect the same anode/cathode/membrane number active in more than one element at once."""
    column_map = {
        "anode": models.Element.anode_nr,
        "cathode": models.Element.cathode_nr,
        "membrane": models.Element.membrane_nr,
    }
    if component_type not in column_map:
        raise HTTPException(status_code=400, detail="component_type must be anode, cathode or membrane")
    col = column_map[component_type]
    active = db.query(models.Element).filter(col.isnot(None), models.Element.disassembly_date.is_(None)).all()
    seen: dict[str, list[models.Element]] = {}
    for el in active:
        value = getattr(el, col.key)
        seen.setdefault(value, []).append(el)
    duplicates = {k: [_enrich(e) for e in v] for k, v in seen.items() if len(v) > 1}
    return duplicates


group_definitions_router = build_crud_router(
    model=models.GroupDefinition,
    read_schema=schemas.GroupDefinitionBase,
    write_schema=schemas.GroupDefinitionBase,
    prefix="/group-definitions",
    tags=["elements"],
    pk_field="group_nr",
)


@router.get("/groups/overview")
def group_overview(db: Session = Depends(get_db)):
    """Amount of elements per group, as described in the manual ('Group overview')."""
    from sqlalchemy import func

    rows = (
        db.query(models.Element.group_nr, func.count(models.Element.id))
        .filter(models.Element.group_nr.isnot(None))
        .group_by(models.Element.group_nr)
        .all()
    )
    return [{"group_nr": g, "element_count": c} for g, c in rows]


inspection_reasons_router = build_crud_router(
    model=models.InspectionReason,
    read_schema=schemas.InspectionReasonRead,
    write_schema=schemas.InspectionReasonBase,
    prefix="/inspection-reasons",
    tags=["elements"],
    search_fields=["reason", "code"],
)

inspection_findings_router = build_crud_router(
    model=models.InspectionFinding,
    read_schema=schemas.InspectionFindingRead,
    write_schema=schemas.InspectionFindingBase,
    prefix="/inspection-findings",
    tags=["elements"],
    search_fields=["text", "code"],
)


cell_components_router = APIRouter(prefix="/cell-components", tags=["elements"])


def _spares(obj: models.CellComponent) -> schemas.CellComponentRead:
    read = schemas.CellComponentRead.model_validate(obj)
    if obj.total_parts is not None:
        read.recommended_spares = round(obj.total_parts * 0.1, 1)  # 10% rule of thumb, adjustable in UI
        read.calculated_spares = round((obj.reserve_index or 0), 1)
    return read


@cell_components_router.get("", response_model=list[schemas.CellComponentRead])
def list_cell_components(db: Session = Depends(get_db)):
    return [_spares(o) for o in db.query(models.CellComponent).all()]


@cell_components_router.put("/{item_id}", response_model=schemas.CellComponentRead)
def update_cell_component(item_id: int, payload: schemas.CellComponentBase, db: Session = Depends(get_db)):
    obj = db.query(models.CellComponent).filter(models.CellComponent.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    if obj.parts_per_element is not None and obj.element_count is not None:
        obj.total_parts = obj.parts_per_element * obj.element_count
    db.commit()
    db.refresh(obj)
    return _spares(obj)
