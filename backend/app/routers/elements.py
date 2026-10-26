"""Element Administration: Assembly Data (the core module), Groups, Inspection Reasons, Cell Components."""
import re
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..cell_component_names import industrial_english
from ..inspection_reason_names import industrial_reason
from ..assembly_integrity import (
    apply_repairs,
    close_all_superseded,
    close_superseded_by,
    find_same_installation,
    is_open,
    occupant_of_cell,
    plan_repairs,
    summarize,
)
from ..calculations import element_dol, last_assembly_date, shutdowns_affecting
from ..relations_sync import apply_defined_groups, find_master, link_group, link_serial
from ..warehouse import compact_eq, compact_nr, ensure_indexed, import_contractor_repairs, load_compact_index, load_shutdown_windows
from ..crud import build_crud_router
from ..database import get_db
from ..excel_import import import_excel_bytes, read_xlsx
from ..import_jobs import spawn_import
from ..auth import get_current_user, require_admin
from ..export_utils import ExportFilters, build_export_meta, export_pdf, export_xlsx, rows_to_dicts
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


def _dol_shutdowns(db: Session, obj: models.Element, windows=None):
    return shutdowns_affecting(windows if windows is not None else load_shutdown_windows(db), obj.electrolyzer)


def _enrich(obj: models.Element, shutdowns=None, last_assembly=None) -> schemas.ElementRead:
    read = schemas.ElementRead.model_validate(obj)
    read.computed_dol_days = element_dol(obj, shutdowns=shutdowns, last_assembly=last_assembly)
    if obj.disassembly_date:
        read.status = "disassembled"
    elif obj.decommissioning_date:
        read.status = "decommissioned"
    elif obj.commissioning_date or obj.assembly_date:
        read.status = "active"
    else:
        read.status = "planned"
    return read


def _enrich_db(db: Session, obj: models.Element, windows=None) -> schemas.ElementRead:
    return _enrich(obj, shutdowns=_dol_shutdowns(db, obj, windows))


CELL_POSITION_MIN = 1
CELL_POSITION_MAX = 168
_POSITION_RE = re.compile(r"^\d{1,3}$")


def _next_element_nr(db: Session) -> str:
    """Last created numeric Element Nr + 1, skipping numbers that already exist."""
    latest = 0
    for (value,) in db.query(models.Element.element_nr).order_by(models.Element.id.desc()).all():
        text = str(value or "").strip()
        if text.isdigit():
            latest = int(text)
            break
    existing = {str(value or "").strip() for (value,) in db.query(models.Element.element_nr).all()}
    n = latest + 1
    while str(n) in existing:
        n += 1
    return str(n)


def _normalize_position(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if not _POSITION_RE.fullmatch(text):
        raise HTTPException(status_code=400, detail="Position must be a number from 001 to 168.")
    number = int(text)
    if number < CELL_POSITION_MIN or number > CELL_POSITION_MAX:
        raise HTTPException(status_code=400, detail="Position must be a number from 001 to 168.")
    return f"{number:03d}"


def _share_with_masters(db: Session, obj: models.Element) -> None:
    """Blank fields are read from the related tables; blank master fields learn from this installation.

    Order: the actual anode / cathode / membrane first, then the group's definition. Nothing typed is overwritten.
    """
    pairs = (
        ("anode", obj.anode_nr, "coating", "anode_coating"),
        ("cathode", obj.cathode_nr, "coating", "cathode_coating"),
        ("membrane", obj.membrane_nr, "membrane_type", "membrane_type"),
    )
    for kind, serial, master_field, element_field in pairs:
        master = find_master(db, kind, serial) if serial else None
        if master is None:
            continue
        master_value = getattr(master, master_field, None)
        mine = getattr(obj, element_field)
        if not (mine or "").strip() and (master_value or "").strip():
            setattr(obj, element_field, master_value)
        elif (mine or "").strip() and not (master_value or "").strip():
            setattr(master, master_field, mine)
    group = (
        db.query(models.GroupDefinition).filter(models.GroupDefinition.group_nr == obj.group_nr).first()
        if obj.group_nr
        else None
    )
    if group is not None:
        for name in ("anode_coating", "cathode_coating", "membrane_type", "gap_mm"):
            spec = (getattr(group, name) or "").strip()
            if spec and spec.lower() != "all" and not (getattr(obj, name) or "").strip():
                setattr(obj, name, spec)


def _sync_saved_element(db: Session, obj: models.Element) -> None:
    """Keep DOL and the anode/cathode/membrane masters in step with this installation."""
    if obj.dol_days is None:
        computed = element_dol(obj, shutdowns=_dol_shutdowns(db, obj))
        if computed is not None:
            obj.dol_days = computed
    # Same part, same spelling everywhere: match the masters (ignoring case/spaces), add new ones.
    obj.anode_nr = link_serial(db, "anode", obj.anode_nr)
    obj.cathode_nr = link_serial(db, "cathode", obj.cathode_nr)
    obj.membrane_nr = link_serial(db, "membrane", obj.membrane_nr, extra={"membrane_type": obj.membrane_type})
    obj.group_nr = link_group(db, obj.group_nr)
    _share_with_masters(db, obj)
    # A newer installation of the same cell / anode / cathode / membrane ends the earlier one.
    close_superseded_by(db, obj)


def _reject_same_installation(db: Session, obj: models.Element) -> None:
    other = find_same_installation(db, obj, exclude_id=obj.id)
    if other is not None:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                f"This installation already exists (Element {other.element_nr or other.id}: "
                f"{other.electrolyzer} / {other.position}, anode {other.anode_nr}, cathode {other.cathode_nr})."
            ),
        )


def _reject_occupied_cell(db: Session, obj: models.Element) -> None:
    if not is_open(obj):
        return
    busy = occupant_of_cell(db, obj.electrolyzer, obj.position, exclude_id=obj.id)
    if busy is not None:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Cell {obj.electrolyzer}-{obj.position} is occupied by element {busy.element_nr}",
        )


@router.get("", response_model=list[schemas.ElementRead])
def list_elements(
    q: str | None = Query(default=None),
    electrolyzer: str | None = None,
    group_nr: str | None = None,
    active_only: bool = False,
    skip: int = 0,
    limit: int = Query(default=500, le=20000),
    db: Session = Depends(get_db),
):
    query = db.query(models.Element)
    if q:
        like = f"%{q}%"
        clauses = [
            models.Element.element_nr.ilike(like),
            models.Element.anode_nr.ilike(like),
            models.Element.cathode_nr.ilike(like),
            models.Element.membrane_nr.ilike(like),
            models.Element.remarks.ilike(like),
            models.Element.membrane_remark.ilike(like),
        ]
        for column in (
            models.Element.element_nr,
            models.Element.anode_nr,
            models.Element.cathode_nr,
            models.Element.membrane_nr,
        ):
            match = compact_eq(column, q)
            if match is not None:
                clauses.append(match)
        query = query.filter(or_(*clauses))
    if electrolyzer:
        query = query.filter(models.Element.electrolyzer == electrolyzer)
    if group_nr:
        query = query.filter(models.Element.group_nr == group_nr)
    if active_only:
        query = query.filter(models.Element.disassembly_date.is_(None))
    items = query.order_by(models.Element.id.desc()).offset(skip).limit(limit).all()
    windows = load_shutdown_windows(db)
    return [_enrich(i, shutdowns=_dol_shutdowns(db, i, windows)) for i in items]


@router.get("/export.meta", include_in_schema=False)
def export_elements_meta():
    return build_export_meta(ELEMENT_EXPORT_FIELDS)


@router.get("/export.xlsx", include_in_schema=False)
def export_elements_xlsx(
    q: str | None = None,
    electrolyzer: str | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    items = list_elements(q=q, electrolyzer=electrolyzer, limit=20000, db=db)
    rows = rows_to_dicts(items, ELEMENT_EXPORT_FIELDS)
    rows, fields = filters.apply(rows, ELEMENT_EXPORT_FIELDS)
    return export_xlsx(rows, fields, "elements")


@router.get("/export.pdf", include_in_schema=False)
def export_elements_pdf(
    q: str | None = None,
    electrolyzer: str | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    items = list_elements(q=q, electrolyzer=electrolyzer, limit=2000, db=db)
    rows = rows_to_dicts(items, ELEMENT_EXPORT_FIELDS)
    rows, fields = filters.apply(rows, ELEMENT_EXPORT_FIELDS)
    return export_pdf(rows, fields, "elements")


def _part_key(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip().upper()


def _position_key(value) -> str:
    text = str(value or "").strip()
    if re.fullmatch(r"\d+", text):
        return str(int(text))
    return text


def _installation_key(electrolyzer, position, assembly_date, anode_nr, cathode_nr) -> tuple:
    if isinstance(assembly_date, datetime):
        day = assembly_date.date().isoformat()
    elif isinstance(assembly_date, date):
        day = assembly_date.isoformat()
    else:
        day = str(assembly_date or "")[:10]
    return (_part_key(electrolyzer), _position_key(position), day, _part_key(anode_nr), _part_key(cathode_nr))


def _write_electrode_coating(db: Session, model, field: str, nr, coating, index: dict[str, str] | None = None) -> None:
    """Store the coating company on the anode/cathode master row for this serial."""
    if not nr:
        return
    key = compact_nr(nr)
    if not key:
        return
    column = getattr(model, field)
    stored = index.get(key) if index else None
    obj = db.query(model).filter(column == stored).first() if stored else None
    if obj is None:
        obj = db.query(model).filter(func.replace(func.upper(column), " ", "") == key).first()
    if obj is not None:
        obj.coating = str(coating)[:50] if coating else None


def _sync_latest_electrode_coatings(db: Session) -> None:
    """Each serial keeps the coating from its latest Assembly Data row."""
    latest_a: dict[str, tuple] = {}
    latest_c: dict[str, tuple] = {}
    for el in db.query(models.Element).all():
        day = el.assembly_date or date.min
        if el.anode_nr:
            key = compact_nr(el.anode_nr)
            prev = latest_a.get(key)
            if prev is None or day >= prev[0]:
                latest_a[key] = (day, el.anode_coating, el.anode_nr)
        if el.cathode_nr:
            key = compact_nr(el.cathode_nr)
            prev = latest_c.get(key)
            if prev is None or day >= prev[0]:
                latest_c[key] = (day, el.cathode_coating, el.cathode_nr)
    for _day, coating, nr in latest_a.values():
        _write_electrode_coating(db, models.Anode, "anode_nr", nr, coating)
    for _day, coating, nr in latest_c.values():
        _write_electrode_coating(db, models.Cathode, "cathode_nr", nr, coating)


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
            active.setdefault((_part_key(el.electrolyzer), _position_key(el.position)), el)

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
        dismantle_date = _parse_iso_date(item.get("disassembly_date") or item.get("decommissioning_date"))
        payload = {
            "element_nr": item.get("element_nr"),
            "electrolyzer": item.get("electrolyzer"),
            "position": str(item["position"]) if item.get("position") is not None else None,
            "anode_nr": item.get("anode_nr"),
            "cathode_nr": item.get("cathode_nr"),
            "membrane_nr": item.get("membrane_nr"),
            "membrane_type": item.get("membrane_type"),
            "membrane_info": item.get("membrane_info"),
            "membrane_remark": item.get("membrane_remark"),
            "anode_remark": item.get("anode_remark"),
            "cathode_remark": item.get("cathode_remark"),
            "assembly_date": assembly_date,
            "commissioning_date": commissioning_date,
            "decommissioning_date": dismantle_date,
            "disassembly_date": dismantle_date,
            "decommission_reason": item.get("decommission_reason"),
            "remarks": item.get("remarks"),
            "anode_coating": item.get("anode_coating"),
            "cathode_coating": item.get("cathode_coating"),
            "anode_shell": item.get("anode_shell"),
            "cathode_shell": item.get("cathode_shell"),
        }
        key = _installation_key(
            payload["electrolyzer"], payload["position"], assembly_date, payload["anode_nr"], payload["cathode_nr"]
        )
        el = index.get(key)
        if el is None and mode == "disassembly" and assembly_date is None and payload["electrolyzer"] and payload["position"]:
            el = active.get((_part_key(payload["electrolyzer"]), _position_key(payload["position"])))
        if el is not None:
            for field, value in payload.items():
                if mode == "disassembly" and field not in {"disassembly_date", "decommissioning_date", "decommission_reason", "remarks"}:
                    continue
                setattr(el, field, value)
            updated += 1
        elif mode == "disassembly" and dismantle_date is None:
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
        if item.get("write_coatings") or item.get("coating_split"):
            _write_electrode_coating(db, models.Anode, "anode_nr", payload.get("anode_nr"), payload.get("anode_coating"), anode_index)
            _write_electrode_coating(db, models.Cathode, "cathode_nr", payload.get("cathode_nr"), payload.get("cathode_coating"), cathode_index)
        if (created + updated) % 500 == 0:
            db.flush()
        if progress and (done == total or done % 25 == 0):
            progress(done, total)

    db.flush()
    if mode != "disassembly":
        _sync_latest_electrode_coatings(db)
    closed_replaced = close_all_superseded(db) if mode != "disassembly" else 0

    dol_updated = 0
    windows = load_shutdown_windows(db)
    for el in db.query(models.Element).all():
        computed = element_dol(el, shutdowns=_dol_shutdowns(db, el, windows))
        if computed is not None and el.dol_days != computed:
            el.dol_days = computed
            dol_updated += 1

    grouped = 0
    if mode != "disassembly":
        grouped = apply_defined_groups(db)

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
        "groups_filled": grouped,
        "dol_updated": dol_updated,
        "closed_replaced": closed_replaced,
        "catalogs_created": catalogs,
        "mode": mode,
        "mapped": [
            "element_nr",
            "anode_nr",
            "cathode_nr",
            "membrane_type",
            "membrane_nr",
            "membrane_remark",
            "anode_remark",
            "cathode_remark",
            "electrolyzer",
            "position",
            "assembly_date",
            "commissioning_date",
            "decommissioning_date",
            "disassembly_date",
            "decommission_reason",
            "remarks",
            "anode_coating",
            "cathode_coating",
            "anode_shell",
            "cathode_shell",
        ],
        "preview": items[:3],
    }


def replace_elements_workbook(db: Session, content: bytes, progress, filename: str | None = None) -> dict:
    """Drop every assembly row, then load the new workbook."""
    db.query(models.Element).delete(synchronize_session=False)
    db.commit()
    parsed = parse_assembly_excel(content, from_year=None, filename=filename)
    if parsed.get("recognized"):
        result = _apply_assembly_import(db, parsed, "upsert", progress)
        result["contractor_repairs"] = import_contractor_repairs(db, content)
        return result
    return import_excel_bytes(db, models.Element, schemas.ElementBase, content, pk_field="id", mode="merge", progress=progress)


def _remember_elements(db: Session, filename: str | None, content: bytes, uploaded_by: str | None) -> None:
    from ..table_files import remember_workbook

    remember_workbook(db, "elements", filename, content, db.query(models.Element).count(), uploaded_by)


@router.post("/import.xlsx", include_in_schema=False)
async def import_elements(_admin=Depends(require_admin), file: UploadFile = File(...)):
    content = await read_xlsx(file)
    filename = file.filename
    parsed = parse_assembly_excel(content, from_year=None, filename=filename)
    who = _admin.username

    def work(db: Session, progress):
        if parsed.get("recognized"):
            result = _apply_assembly_import(db, parsed, "upsert", progress)
            result["contractor_repairs"] = import_contractor_repairs(db, content)
        else:
            result = import_excel_bytes(db, models.Element, schemas.ElementBase, content, pk_field="id", progress=progress)
        _remember_elements(db, filename, content, who)
        return result

    return spawn_import(work)


@router.post("/import-assembly-excel")
async def import_assembly_excel(
    _admin=Depends(require_admin),
    file: UploadFile = File(...),
    mode: str = Query(default="assembly", description="assembly | disassembly | upsert"),
):
    """
    Import the plant montage / demontage workbook into Assembly Data.
    Assembly and upsert write every mapped column, including dismantle date.
    Disassembly updates the matching installation's dismantle date.
    """
    content = await file.read()
    parsed = parse_assembly_excel(content, from_year=None, filename=file.filename)
    if not parsed.get("recognized"):
        raise HTTPException(
            status_code=400,
            detail=(
                "This Excel file does not match Assembly Data. "
                "Expected the montage / demontage sheet (ANODE, CATHODE, شماره المنت, تاریخ مونتاژ در C90, تاریخ دی مونتاژ). "
                "فایل با فرم مونتاژ جور نیست. همه سال‌های تاریخ C90 وارد می‌شوند."
            ),
        )
    mode = (mode or "assembly").strip().lower()
    if mode == "assembly":
        mode = "upsert"
    filename = file.filename
    who = _admin.username

    def work(db: Session, progress):
        result = _apply_assembly_import(db, parsed, mode, progress)
        result["contractor_repairs"] = import_contractor_repairs(db, content)
        _remember_elements(db, filename, content, who)
        return result

    return spawn_import(work)


@router.get("/next-number")
def next_element_number(db: Session = Depends(get_db)):
    return {"element_nr": _next_element_nr(db)}


@router.get("/free-positions")
def free_positions(
    electrolyzer: str,
    exclude_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Empty cells (001–168) on one electrolyzer. The current row can be excluded while editing."""
    from ..assembly_integrity import cell_key, is_open
    from ..plant_topology import format_electrolyzer_name

    name = format_electrolyzer_name((electrolyzer or "").strip())
    occupied: dict[int, dict] = {}
    if name:
        probe_elz = models.Element(electrolyzer=name, position="001")
        want = cell_key(probe_elz)
        want_elz = want[0] if want else None
        for el in db.query(models.Element).filter(models.Element.electrolyzer.isnot(None)).all():
            if exclude_id is not None and el.id == exclude_id:
                continue
            if not is_open(el):
                continue
            key = cell_key(el)
            if not key or key[0] != want_elz:
                continue
            occupied[key[1]] = {"position": f"{key[1]:03d}", "element_nr": el.element_nr, "id": el.id}
    empty = [f"{n:03d}" for n in range(CELL_POSITION_MIN, CELL_POSITION_MAX + 1) if n not in occupied]
    return {
        "electrolyzer": name or electrolyzer,
        "empty": empty,
        "occupied": [occupied[n] for n in sorted(occupied)],
    }


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

    return _enrich_db(db, max(matched, key=rank))


@router.get("/{item_id}", response_model=schemas.ElementRead)
def get_element(item_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.Element).filter(models.Element.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return _enrich_db(db, obj)


def _ensure_group(db: Session, group_nr: str | None) -> None:
    if not group_nr:
        return
    exists = db.query(models.GroupDefinition).filter(models.GroupDefinition.group_nr == group_nr).first()
    if not exists:
        raise HTTPException(status_code=400, detail=f"Group '{group_nr}' is not in Group Definition")


# Key data every installation must carry (mirrored by the red * marks in the Assembly Data form).
ELEMENT_REQUIRED = [
    "electrolyzer",
    "position",
    "group_nr",
    "anode_nr",
    "cathode_nr",
    "membrane_nr",
    "assembly_date",
]


def _apply_defined_group(db: Session, data: dict, existing: models.Element | None = None) -> None:
    """Fill a blank group number from Group Definition (coating + membrane + gap)."""
    from ..relations_sync import match_defined_group

    current = data.get("group_nr", getattr(existing, "group_nr", None) if existing is not None else None)
    if not _blank(current):
        return
    anode = data.get("anode_coating", getattr(existing, "anode_coating", None) if existing is not None else None)
    cathode = data.get("cathode_coating", getattr(existing, "cathode_coating", None) if existing is not None else None)
    membrane = data.get("membrane_type", getattr(existing, "membrane_type", None) if existing is not None else None)
    gap = data.get("gap_mm", getattr(existing, "gap_mm", None) if existing is not None else None)
    found = match_defined_group(db, anode_coating=anode, cathode_coating=cathode, membrane_type=membrane, gap_mm=gap)
    if found:
        data["group_nr"] = found


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _check_required(data: dict, existing: models.Element | None = None) -> None:
    """New installations need all key fields; a saved one may not lose a value it already has."""
    missing = []
    for name in ELEMENT_REQUIRED:
        if existing is None:
            if _blank(data.get(name)):
                missing.append(name)
        elif name in data and _blank(data[name]) and not _blank(getattr(existing, name, None)):
            missing.append(name)
    if missing:
        raise HTTPException(status_code=422, detail="Required field(s) missing: " + ", ".join(missing))


@router.post("", response_model=schemas.ElementRead, status_code=201)
def create_element(payload: schemas.ElementBase, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    from .workflow import cell_on_element_saved

    data = payload.model_dump()
    _apply_defined_group(db, data)
    _check_required(data)
    _ensure_group(db, data.get("group_nr"))
    data["position"] = _normalize_position(data.get("position"))
    if not str(data.get("element_nr") or "").strip():
        data["element_nr"] = _next_element_nr(db)
    obj = models.Element(**data)
    _reject_same_installation(db, obj)
    _reject_occupied_cell(db, obj)
    db.add(obj)
    _sync_saved_element(db, obj)
    db.flush()
    cell_on_element_saved(db, obj, user, had_decommission=False, had_disassembly=False)
    db.commit()
    db.refresh(obj)
    return _enrich_db(db, obj)


@router.put("/{item_id}", response_model=schemas.ElementRead)
def update_element(item_id: int, payload: schemas.ElementBase, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    from .workflow import cell_on_element_saved

    obj = db.query(models.Element).filter(models.Element.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    had_decommission, had_disassembly = obj.decommissioning_date is not None, obj.disassembly_date is not None
    data = payload.model_dump(exclude_unset=True)
    _apply_defined_group(db, data, obj)
    _check_required(data, obj)
    if "group_nr" in data:
        _ensure_group(db, data.get("group_nr"))
    if "position" in data:
        data["position"] = _normalize_position(data.get("position"))
    for key, value in data.items():
        setattr(obj, key, value)
    _reject_same_installation(db, obj)
    _reject_occupied_cell(db, obj)
    _sync_saved_element(db, obj)
    cell_on_element_saved(db, obj, user, had_decommission, had_disassembly)
    db.commit()
    db.refresh(obj)
    return _enrich_db(db, obj)


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
    wanted = compact_nr(element_nr)
    if not wanted:
        return []
    items = (
        db.query(models.Element)
        .filter(func.upper(func.replace(models.Element.element_nr, " ", "")) == wanted)
        .all()
    )
    items.sort(key=lambda row: (row.assembly_date or row.commissioning_date or date.min, row.id or 0))
    windows = load_shutdown_windows(db)
    last_asm = last_assembly_date(items)
    latest = max(items, key=lambda row: (row.assembly_date or row.commissioning_date or date.min, row.id or 0)) if items else None
    return [
        _enrich(
            i,
            shutdowns=_dol_shutdowns(db, i, windows),
            last_assembly=last_asm if i is latest else None,
        )
        for i in items
    ]


@router.get("/integrity/report")
def integrity_report(_admin=Depends(require_admin), db: Session = Depends(get_db)):
    """What the relationship repair would change (nothing is written)."""
    return summarize(plan_repairs(db))


@router.post("/integrity/repair")
def integrity_repair(_admin=Depends(require_admin), db: Session = Depends(get_db)):
    """Drop exact duplicate installations and close installations that a newer one replaced."""
    plan = plan_repairs(db)
    return {"found": summarize(plan), "applied": apply_repairs(db, plan)}


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
    windows = load_shutdown_windows(db)
    duplicates = {k: [_enrich_db(db, e, windows) for e in v] for k, v in seen.items() if len(v) > 1}
    return duplicates


def natural_key(value) -> list:
    """Sort key that orders numbers as numbers: 1, 2, 10 (not 1, 10, 2); text after numbers."""
    text = str(value or "").strip()
    return [(0, int(p), "") if p.isdigit() else (1, 0, p.lower()) for p in re.split(r"(\d+)", text) if p != ""]


def _rename_group(db: Session, old: str, new: str) -> None:
    db.query(models.Element).filter(models.Element.group_nr == old).update(
        {models.Element.group_nr: new}, synchronize_session=False
    )
    db.query(models.AssemblyInspectionReport).filter(models.AssemblyInspectionReport.group_nr == old).update(
        {models.AssemblyInspectionReport.group_nr: new}, synchronize_session=False
    )


def _fill_groups_after_definition(db: Session, _obj: models.GroupDefinition) -> None:
    apply_defined_groups(db)


group_definitions_router = build_crud_router(
    model=models.GroupDefinition,
    read_schema=schemas.GroupDefinitionBase,
    write_schema=schemas.GroupDefinitionBase,
    prefix="/group-definitions",
    tags=["elements"],
    pk_field="group_nr",
    required_fields=["group_nr"],
    unique_compact=True,
    sort_key=lambda row: natural_key(row.group_nr),
    after_save=_fill_groups_after_definition,
    on_rename=_rename_group,
)


@router.get("/groups/overview")
def group_overview(db: Session = Depends(get_db)):
    """Amount of elements per group, as described in the manual ('Group overview')."""
    from sqlalchemy import func

    if apply_defined_groups(db):
        db.commit()

    rows = (
        db.query(models.Element.group_nr, func.count(models.Element.id))
        .filter(models.Element.group_nr.isnot(None))
        .group_by(models.Element.group_nr)
        .all()
    )
    return [{"group_nr": g, "element_count": c} for g, c in rows]


def _prepare_reason(obj: models.InspectionReason) -> None:
    obj.reason = industrial_reason(obj.reason)


def _translate_reason_read(item: schemas.InspectionReasonRead) -> None:
    item.reason = industrial_reason(item.reason)


inspection_reasons_router = build_crud_router(
    model=models.InspectionReason,
    read_schema=schemas.InspectionReasonRead,
    write_schema=schemas.InspectionReasonBase,
    prefix="/inspection-reasons",
    tags=["elements"],
    search_fields=["reason", "code"],
    prepare=_prepare_reason,
    transform=_translate_reason_read,
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
    read.name = industrial_english(read.name, read.part_nr)
    if read.total_parts is not None:
        read.recommended_spares = round(read.total_parts * 0.02, 4)
    return read


@cell_components_router.get("", response_model=list[schemas.CellComponentRead])
def list_cell_components(db: Session = Depends(get_db)):
    rows = db.query(models.CellComponent).all()
    rows.sort(key=lambda o: natural_key(o.part_nr))
    return [_spares(o) for o in rows]


def _apply_industrial_name(obj: models.CellComponent) -> None:
    obj.name = industrial_english(obj.name, obj.part_nr)


def _prepare_cell(obj: models.CellComponent) -> None:
    _apply_industrial_name(obj)
    if obj.parts_per_element is not None and obj.element_count is not None:
        obj.total_parts = obj.parts_per_element * obj.element_count


@cell_components_router.get("/export.meta", include_in_schema=False)
def export_cell_components_meta():
    fields = list(schemas.CellComponentRead.model_fields.keys())
    return build_export_meta(fields)


@cell_components_router.get("/export.xlsx", include_in_schema=False)
def export_cell_components_xlsx(filters: ExportFilters = Depends(), db: Session = Depends(get_db)):
    items = list_cell_components(db=db)
    fields = list(schemas.CellComponentRead.model_fields.keys())
    rows, out_fields = filters.apply(rows_to_dicts(items, fields), fields)
    return export_xlsx(rows, out_fields, "cell-components")


@cell_components_router.get("/export.pdf", include_in_schema=False)
def export_cell_components_pdf(filters: ExportFilters = Depends(), db: Session = Depends(get_db)):
    items = list_cell_components(db=db)
    fields = list(schemas.CellComponentRead.model_fields.keys())
    rows, out_fields = filters.apply(rows_to_dicts(items, fields), fields)
    return export_pdf(rows, out_fields, "cell-components")


@cell_components_router.post("/import.xlsx", include_in_schema=False)
async def import_cell_components(_admin=Depends(require_admin), file: UploadFile = File(...)):
    content = await read_xlsx(file)
    filename = file.filename
    who = _admin.username
    return spawn_import(
        lambda db, progress: import_excel_bytes(
            db,
            models.CellComponent,
            schemas.CellComponentBase,
            content,
            pk_field="id",
            prepare=_prepare_cell,
            file_key="cell-components",
            file_name=filename,
            uploaded_by=who,
            progress=progress,
        )
    )


@cell_components_router.post("", response_model=schemas.CellComponentRead, status_code=201)
def create_cell_component(payload: schemas.CellComponentBase, db: Session = Depends(get_db)):
    obj = models.CellComponent(**payload.model_dump())
    _prepare_cell(obj)
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
    _prepare_cell(obj)
    db.commit()
    db.refresh(obj)
    return _spares(obj)
