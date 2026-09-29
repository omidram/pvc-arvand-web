"""Element Administration: Assembly Data (the core module), Groups, Inspection Reasons, Cell Components."""
import re
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..calculations import installation_dol
from ..warehouse import ensure_indexed, import_contractor_repairs, load_compact_index
from ..crud import build_crud_router
from ..database import get_db
from ..excel_import import import_excel_bytes, read_xlsx
from ..import_jobs import spawn_import
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
    read.computed_dol_days = installation_dol(
        obj.assembly_date, obj.commissioning_date, obj.disassembly_date, obj.decommissioning_date
    )
    if obj.disassembly_date:
        read.status = "disassembled"
    elif obj.decommissioning_date:
        read.status = "decommissioned"
    elif obj.commissioning_date or obj.assembly_date:
        read.status = "active"
    else:
        read.status = "planned"
    return read


def _sync_saved_element(db: Session, obj: models.Element) -> None:
    """Keep DOL and the anode/cathode/membrane masters in step with this installation."""
    if obj.dol_days is None:
        computed = installation_dol(
            obj.assembly_date, obj.commissioning_date, obj.disassembly_date, obj.decommissioning_date
        )
        if computed is not None:
            obj.dol_days = computed
    ensure_indexed(db, models.Anode, "anode_nr", obj.anode_nr, None)
    ensure_indexed(db, models.Cathode, "cathode_nr", obj.cathode_nr, None)
    ensure_indexed(db, models.Membrane, "membrane_nr", obj.membrane_nr, None, extra={"membrane_type": obj.membrane_type})


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


def _part_key(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip().upper()


def _installation_key(electrolyzer, position, assembly_date, anode_nr, cathode_nr) -> tuple:
    if isinstance(assembly_date, datetime):
        day = assembly_date.date().isoformat()
    elif isinstance(assembly_date, date):
        day = assembly_date.isoformat()
    else:
        day = str(assembly_date or "")[:10]
    return (_part_key(electrolyzer), str(position or "").strip(), day, _part_key(anode_nr), _part_key(cathode_nr))


def _apply_assembly_import(db: Session, parsed: dict, mode: str, progress=None) -> dict:
    """Write montage / demontage rows onto Assembly Data.

    A row is the same installation when electrolyzer, position, assembly date,
    anode and cathode match. Element numbers in the plant sheet repeat, so they
    are stored but not used as the only key.
    """
    if parsed.get("error"):
        raise HTTPException(status_code=400, detail=parsed["error"])
    items = parsed.get("elements") or []
    if not items:
        raise HTTPException(status_code=400, detail="No assembly rows found")

    index: dict[tuple, models.Element] = {}
    active: dict[tuple, models.Element] = {}
    for el in db.query(models.Element).all():
        index[_installation_key(el.electrolyzer, el.position, el.assembly_date, el.anode_nr, el.cathode_nr)] = el
        if el.disassembly_date is None and el.electrolyzer and el.position:
            active.setdefault((_part_key(el.electrolyzer), str(el.position).strip()), el)

    anode_index = load_compact_index(db, models.Anode, "anode_nr")
    cathode_index = load_compact_index(db, models.Cathode, "cathode_nr")
    membrane_index = load_compact_index(db, models.Membrane, "membrane_nr")
    catalogs = {"anodes": 0, "cathodes": 0, "membranes": 0}

    created = updated = skipped = 0
    total = len(items)
    if progress:
        progress(0, total)
    for done, item in enumerate(items, start=1):
        assembly_date = _parse_iso_date(item.get("assembly_date"))
        commissioning_date = _parse_iso_date(item.get("commissioning_date"))
        disassembly_date = _parse_iso_date(item.get("disassembly_date"))
        payload = {
            "element_nr": item.get("element_nr"),
            "electrolyzer": item.get("electrolyzer"),
            "position": str(item["position"]) if item.get("position") is not None else None,
            "generation": (item.get("generation") or "")[:50] or None,
            "anode_nr": item.get("anode_nr"),
            "cathode_nr": item.get("cathode_nr"),
            "membrane_nr": item.get("membrane_nr"),
            "membrane_type": item.get("membrane_type"),
            "membrane_info": item.get("membrane_info"),
            "assembly_date": assembly_date,
            "commissioning_date": commissioning_date,
            "disassembly_date": disassembly_date,
            "remarks": item.get("remarks"),
        }
        key = _installation_key(
            payload["electrolyzer"], payload["position"], assembly_date, payload["anode_nr"], payload["cathode_nr"]
        )
        el = index.get(key)
        if el is None and mode == "disassembly" and assembly_date is None and payload["electrolyzer"] and payload["position"]:
            el = active.get((_part_key(payload["electrolyzer"]), str(payload["position"]).strip()))
        if el is not None:
            for field, value in payload.items():
                if mode == "disassembly" and field not in {"disassembly_date", "remarks"}:
                    continue
                if value is not None:
                    setattr(el, field, value)
            updated += 1
        elif mode == "disassembly" and disassembly_date is None:
            skipped += 1
            continue
        else:
            el = models.Element(**{k: v for k, v in payload.items() if v is not None})
            db.add(el)
            index[key] = el
            created += 1
        catalogs["anodes"] += ensure_indexed(db, models.Anode, "anode_nr", payload.get("anode_nr"), anode_index)
        catalogs["cathodes"] += ensure_indexed(db, models.Cathode, "cathode_nr", payload.get("cathode_nr"), cathode_index)
        catalogs["membranes"] += ensure_indexed(
            db,
            models.Membrane,
            "membrane_nr",
            payload.get("membrane_nr"),
            membrane_index,
            extra={"membrane_type": payload.get("membrane_type")},
        )
        if (created + updated) % 500 == 0:
            db.flush()
        if progress and (done == total or done % 25 == 0):
            progress(done, total)

    dol_updated = 0
    for el in db.query(models.Element).all():
        computed = installation_dol(el.assembly_date, el.commissioning_date, el.disassembly_date, el.decommissioning_date)
        if computed is not None and el.dol_days != computed:
            el.dol_days = computed
            dol_updated += 1

    if created + updated == 0:
        db.rollback()
        raise HTTPException(status_code=400, detail="No assembly rows were imported")
    db.commit()
    return {
        "ok": True,
        "imported_rows": created + updated,
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "dol_updated": dol_updated,
        "catalogs_created": catalogs,
        "mode": mode,
        "mapped": [
            "element_nr",
            "anode_nr",
            "cathode_nr",
            "membrane_type",
            "membrane_nr",
            "electrolyzer",
            "position",
            "assembly_date",
            "commissioning_date",
            "disassembly_date",
            "remarks",
        ],
        "preview": items[:3],
    }


@router.post("/import.xlsx", include_in_schema=False)
async def import_elements(file: UploadFile = File(...)):
    content = await read_xlsx(file)
    parsed = parse_assembly_excel(content)

    def work(db: Session, progress):
        if parsed.get("recognized"):
            result = _apply_assembly_import(db, parsed, "upsert", progress)
            result["contractor_repairs"] = import_contractor_repairs(db, content)
            return result
        return import_excel_bytes(db, models.Element, schemas.ElementBase, content, pk_field="id", progress=progress)

    return spawn_import(work)


@router.post("/import-assembly-excel")
async def import_assembly_excel(
    file: UploadFile = File(...),
    mode: str = Query(default="assembly", description="assembly | disassembly | upsert"),
):
    """
    Import the plant montage / demontage workbook into Assembly Data.
    Assembly and upsert write every mapped column, including dismantle date.
    Disassembly updates the matching installation's dismantle date.
    """
    content = await file.read()
    parsed = parse_assembly_excel(content)
    if not parsed.get("recognized"):
        raise HTTPException(
            status_code=400,
            detail=(
                "This Excel file does not match Assembly Data. "
                "Expected the montage / demontage sheet (ANODE, CATHODE, شماره المنت, تاریخ مونتاژ, تاریخ دی مونتاژ). "
                "فایل با فرم مونتاژ جور نیست."
            ),
        )
    mode = (mode or "assembly").strip().lower()
    if mode == "assembly":
        mode = "upsert"
    def work(db: Session, progress):
        result = _apply_assembly_import(db, parsed, mode, progress)
        result["contractor_repairs"] = import_contractor_repairs(db, content)
        return result

    return spawn_import(work)


_MATCH_FIELDS = (
    "element_nr",
    "anode_nr",
    "cathode_nr",
    "membrane_nr",
    "electrolyzer",
    "position",
    "membrane_type",
    "group_nr",
)


@router.get("/match", response_model=schemas.ElementRead | None)
def match_element(
    focus: str = Query(...),
    element_nr: str | None = None,
    anode_nr: str | None = None,
    cathode_nr: str | None = None,
    membrane_nr: str | None = None,
    electrolyzer: str | None = None,
    position: str | None = None,
    membrane_type: str | None = None,
    group_nr: str | None = None,
    db: Session = Depends(get_db),
):
    """Find the imported installation that best matches the field the user just filled."""
    if focus not in _MATCH_FIELDS:
        raise HTTPException(status_code=400, detail="Unknown assembly field")
    hints = {
        "element_nr": element_nr,
        "anode_nr": anode_nr,
        "cathode_nr": cathode_nr,
        "membrane_nr": membrane_nr,
        "electrolyzer": electrolyzer,
        "position": position,
        "membrane_type": membrane_type,
        "group_nr": group_nr,
    }
    needle = _part_key(hints.get(focus))
    if not needle:
        return None
    column = getattr(models.Element, focus)
    compact = needle.replace(" ", "")
    expr = func.upper(func.trim(func.replace(column, " ", "")))
    matched = db.query(models.Element).filter(expr == compact).all()
    if not matched:
        return None

    def rank(row: models.Element):
        score = 0
        for name, value in hints.items():
            if name == focus or not _part_key(value):
                continue
            if _part_key(getattr(row, name)) == _part_key(value):
                score += 2
        filled = sum(1 for name in _MATCH_FIELDS if _part_key(getattr(row, name)))
        return (score, filled, row.assembly_date or date.min, row.id or 0)

    return _enrich(max(matched, key=rank))


@router.get("/{item_id}", response_model=schemas.ElementRead)
def get_element(item_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.Element).filter(models.Element.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return _enrich(obj)


def _ensure_group(db: Session, group_nr: str | None) -> None:
    if not group_nr:
        return
    exists = db.query(models.GroupDefinition).filter(models.GroupDefinition.group_nr == group_nr).first()
    if not exists:
        raise HTTPException(status_code=400, detail=f"Group '{group_nr}' is not in Group Definition")


@router.post("", response_model=schemas.ElementRead, status_code=201)
def create_element(payload: schemas.ElementBase, db: Session = Depends(get_db)):
    _ensure_group(db, payload.group_nr)
    obj = models.Element(**payload.model_dump())
    db.add(obj)
    _sync_saved_element(db, obj)
    db.commit()
    db.refresh(obj)
    return _enrich(obj)


@router.put("/{item_id}", response_model=schemas.ElementRead)
def update_element(item_id: int, payload: schemas.ElementBase, db: Session = Depends(get_db)):
    obj = db.query(models.Element).filter(models.Element.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    data = payload.model_dump(exclude_unset=True)
    if "group_nr" in data:
        _ensure_group(db, data.get("group_nr"))
    for key, value in data.items():
        setattr(obj, key, value)
    _sync_saved_element(db, obj)
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
    """Stored totals. The Cell Components form recalculates live, matching Access:
    total = parts per element × No. of Elements; recommended = total × 0.02;
    calculated = parts per element × Spare Elements × reserve index.
    """
    read = schemas.CellComponentRead.model_validate(obj)
    if read.total_parts is not None:
        read.recommended_spares = round(read.total_parts * 0.02, 4)
    return read


@cell_components_router.get("", response_model=list[schemas.CellComponentRead])
def list_cell_components(db: Session = Depends(get_db)):
    return [_spares(o) for o in db.query(models.CellComponent).all()]


def _prepare_cell(obj: models.CellComponent) -> None:
    if obj.parts_per_element is not None and obj.element_count is not None:
        obj.total_parts = obj.parts_per_element * obj.element_count


@cell_components_router.get("/export.xlsx", include_in_schema=False)
def export_cell_components_xlsx(db: Session = Depends(get_db)):
    items = list_cell_components(db=db)
    fields = list(schemas.CellComponentRead.model_fields.keys())
    return export_xlsx(rows_to_dicts(items, fields), fields, "cell-components")


@cell_components_router.get("/export.pdf", include_in_schema=False)
def export_cell_components_pdf(db: Session = Depends(get_db)):
    items = list_cell_components(db=db)
    fields = list(schemas.CellComponentRead.model_fields.keys())
    return export_pdf(rows_to_dicts(items, fields), fields, "cell-components")


@cell_components_router.post("/import.xlsx", include_in_schema=False)
async def import_cell_components(file: UploadFile = File(...)):
    content = await read_xlsx(file)
    return spawn_import(
        lambda db, progress: import_excel_bytes(
            db,
            models.CellComponent,
            schemas.CellComponentBase,
            content,
            pk_field="id",
            prepare=_prepare_cell,
            progress=progress,
        )
    )


@cell_components_router.post("", response_model=schemas.CellComponentRead, status_code=201)
def create_cell_component(payload: schemas.CellComponentBase, db: Session = Depends(get_db)):
    obj = models.CellComponent(**payload.model_dump())
    if obj.parts_per_element is not None and obj.element_count is not None:
        obj.total_parts = obj.parts_per_element * obj.element_count
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _spares(obj)


@cell_components_router.delete("/{item_id}", status_code=204)
def delete_cell_component(item_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.CellComponent).filter(models.CellComponent.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(obj)
    db.commit()
    return None


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
