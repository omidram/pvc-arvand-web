"""
Warehouse for anodes and cathodes, plus the Access membrane stock list.

Anode/cathode status is computed live from the latest assembly row and from
maintenance, recoating and coating-check records. Membrane stock stays the
usable, not-mounted list.
"""
from collections import Counter
from datetime import date as Date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..auth import require_admin, require_any_form_access
from ..database import get_db
from ..excel_import import read_xlsx
from ..export_utils import ExportFilters, build_export_meta, export_pdf, export_xlsx
from ..import_jobs import spawn_import
from ..plant_import import parse_assembly_excel
from ..routers.elements import _apply_assembly_import
from ..warehouse import apply_move, build_board, import_contractor_repairs

router = APIRouter(prefix="/storage", tags=["storage"])


def _norm(value: str | None) -> str:
    return " ".join((value or "").split()).strip().upper()


def _active_component_nrs(db: Session, field: str) -> set[str]:
    """Component numbers currently mounted on non-disassembled elements."""
    col = getattr(models.Element, field)
    rows = (
        db.query(col)
        .filter(col.isnot(None), models.Element.disassembly_date.is_(None))
        .all()
    )
    return {_norm(r[0]) for r in rows if r[0] and _norm(r[0])}


def _anode_payload(row: models.Anode) -> dict:
    return {
        "anode_nr": row.anode_nr,
        "assembly_group": row.assembly_group,
        "component_nr": row.component_nr,
        "customer_drawing_nr": row.customer_drawing_nr,
        "manufacturer": row.manufacturer,
        "manufacturer_order_nr": row.manufacturer_order_nr,
        "manufacturer_drawing_nr": row.manufacturer_drawing_nr,
        "manufacturer_date": row.manufacturer_date,
        "tank": row.tank,
        "contact_strip": row.contact_strip,
        "electrode_support": row.electrode_support,
        "electrode_shape": row.electrode_shape,
        "coating": row.coating,
        "baffle_plate": row.baffle_plate,
        "downcomer": row.downcomer,
        "inlet_system": row.inlet_system,
        "standpipe_diameter": row.standpipe_diameter,
        "flange_width": row.flange_width,
        "received_date": row.received_date,
        "remarks": row.remarks,
        "decommission_date": row.decommission_date,
        "batch": row.batch,
        "generation": row.generation,
    }


def _cathode_payload(row: models.Cathode) -> dict:
    return {
        "cathode_nr": row.cathode_nr,
        "assembly_group": row.assembly_group,
        "component_nr": row.component_nr,
        "customer_drawing_nr": row.customer_drawing_nr,
        "manufacturer": row.manufacturer,
        "manufacturer_order_nr": row.manufacturer_order_nr,
        "manufacturer_drawing_nr": row.manufacturer_drawing_nr,
        "manufacturer_date": row.manufacturer_date,
        "tank": row.tank,
        "contact_strip": row.contact_strip,
        "electrode_support": row.electrode_support,
        "electrode_shape": row.electrode_shape,
        "coating": row.coating,
        "inlet_system": row.inlet_system,
        "standpipe_diameter": row.standpipe_diameter,
        "flange_width": row.flange_width,
        "received_date": row.received_date,
        "remarks": row.remarks,
        "decommission_date": row.decommission_date,
        "batch": row.batch,
        "generation": row.generation,
    }


def _membrane_payload(row: models.Membrane) -> dict:
    return {
        "membrane_nr": row.membrane_nr,
        "membrane_type": row.membrane_type,
        "received_date": row.received_date,
        "remarks": row.remarks,
        "decommission_date": row.decommission_date,
        "batch": row.batch,
    }


@router.get("/summary")
def storage_summary(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "anodes", "cathodes", "membranes")),
):
    active_anodes = _active_component_nrs(db, "anode_nr")
    active_cathodes = _active_component_nrs(db, "cathode_nr")
    active_membranes = _active_component_nrs(db, "membrane_nr")

    anodes = [
        a
        for a in db.query(models.Anode).filter(models.Anode.decommission_date.is_(None)).all()
        if _norm(a.anode_nr) not in active_anodes
    ]
    cathodes = [
        c
        for c in db.query(models.Cathode).filter(models.Cathode.decommission_date.is_(None)).all()
        if _norm(c.cathode_nr) not in active_cathodes
    ]
    membranes = [
        m
        for m in db.query(models.Membrane).filter(models.Membrane.decommission_date.is_(None)).all()
        if _norm(m.membrane_nr) not in active_membranes
    ]

    anode_groups = Counter((a.manufacturer or "—", a.generation or "—") for a in anodes)
    cathode_groups = Counter((c.manufacturer or "—", c.generation or "—") for c in cathodes)
    membrane_groups = Counter((m.membrane_type or "—") for m in membranes)

    return {
        "counts": {
            "anodes": len(anodes),
            "cathodes": len(cathodes),
            "membranes": len(membranes),
            "total": len(anodes) + len(cathodes) + len(membranes),
        },
        "anodes_by_manufacturer": [
            {"manufacturer": k[0], "generation": k[1], "count": v}
            for k, v in sorted(anode_groups.items(), key=lambda x: (-x[1], x[0]))
        ],
        "cathodes_by_manufacturer": [
            {"manufacturer": k[0], "generation": k[1], "count": v}
            for k, v in sorted(cathode_groups.items(), key=lambda x: (-x[1], x[0]))
        ],
        "membranes_by_type": [
            {"membrane_type": k, "count": v}
            for k, v in sorted(membrane_groups.items(), key=lambda x: (-x[1], x[0]))
        ],
    }


@router.get("/anodes")
def stock_anodes(
    q: str | None = None,
    limit: int = Query(default=2000, ge=1, le=10000),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "anodes")),
):
    active = _active_component_nrs(db, "anode_nr")
    rows = db.query(models.Anode).filter(models.Anode.decommission_date.is_(None)).all()
    items = [_anode_payload(r) for r in rows if _norm(r.anode_nr) not in active]
    if q:
        needle = q.strip().lower()
        items = [
            i
            for i in items
            if needle in (i.get("anode_nr") or "").lower()
            or needle in (i.get("manufacturer") or "").lower()
            or needle in (i.get("batch") or "").lower()
            or needle in (i.get("generation") or "").lower()
        ]
    items.sort(key=lambda i: (i.get("anode_nr") or ""))
    return items[:limit]


@router.get("/cathodes")
def stock_cathodes(
    q: str | None = None,
    limit: int = Query(default=2000, ge=1, le=10000),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "cathodes")),
):
    active = _active_component_nrs(db, "cathode_nr")
    rows = db.query(models.Cathode).filter(models.Cathode.decommission_date.is_(None)).all()
    items = [_cathode_payload(r) for r in rows if _norm(r.cathode_nr) not in active]
    if q:
        needle = q.strip().lower()
        items = [
            i
            for i in items
            if needle in (i.get("cathode_nr") or "").lower()
            or needle in (i.get("manufacturer") or "").lower()
            or needle in (i.get("batch") or "").lower()
            or needle in (i.get("generation") or "").lower()
        ]
    items.sort(key=lambda i: (i.get("cathode_nr") or ""))
    return items[:limit]


@router.get("/membranes")
def stock_membranes(
    q: str | None = None,
    limit: int = Query(default=2000, ge=1, le=10000),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "membranes")),
):
    active = _active_component_nrs(db, "membrane_nr")
    rows = db.query(models.Membrane).filter(models.Membrane.decommission_date.is_(None)).all()
    items = [_membrane_payload(r) for r in rows if _norm(r.membrane_nr) not in active]
    if q:
        needle = q.strip().lower()
        items = [
            i
            for i in items
            if needle in (i.get("membrane_nr") or "").lower()
            or needle in (i.get("membrane_type") or "").lower()
            or needle in (i.get("batch") or "").lower()
        ]
    items.sort(key=lambda i: (i.get("membrane_nr") or ""))
    return items[:limit]


class WarehouseMove(BaseModel):
    kind: str
    serial: str
    action: str
    date: Date | None = None
    note: str | None = None


_BOARD_FIELDS = [
    "serial",
    "bucket",
    "reason",
    "electrolyzer",
    "position",
    "element_nr",
    "assembly_date",
    "commissioning_date",
    "disassembly_date",
    "last_dol",
    "total_dol",
    "runs",
    "remarks",
    "repair",
    "repair_dispatch",
    "repair_return",
    "coating",
    "manufacturer",
]


def _board_or_400(db: Session, kind: str, bucket: str | None, q: str | None, limit: int) -> dict:
    if kind not in {"anode", "cathode"}:
        raise HTTPException(status_code=400, detail="kind must be anode or cathode")
    return build_board(db, kind, bucket=bucket, q=q, limit=limit)


@router.get("/board")
def warehouse_board(
    kind: str = Query(default="anode"),
    bucket: str | None = Query(default="warehouse"),
    q: str | None = None,
    limit: int = Query(default=2500, ge=1, le=20000),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "anodes", "cathodes")),
):
    return _board_or_400(db, kind, bucket, q, limit)


@router.get("/board/export.meta", include_in_schema=False)
def warehouse_export_meta(
    _: models.User = Depends(require_any_form_access("storage", "anodes", "cathodes")),
):
    return build_export_meta(_BOARD_FIELDS)


@router.get("/board/export.xlsx", include_in_schema=False)
def warehouse_export_xlsx(
    kind: str = Query(default="anode"),
    bucket: str | None = Query(default="warehouse"),
    q: str | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "anodes", "cathodes")),
):
    board = _board_or_400(db, kind, bucket, q, 20000)
    rows, fields = filters.apply(board["items"], _BOARD_FIELDS)
    return export_xlsx(rows, fields, "warehouse")


@router.get("/board/export.pdf", include_in_schema=False)
def warehouse_export_pdf(
    kind: str = Query(default="anode"),
    bucket: str | None = Query(default="warehouse"),
    q: str | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "anodes", "cathodes")),
):
    board = _board_or_400(db, kind, bucket, q, 1500)
    rows, fields = filters.apply(board["items"], _BOARD_FIELDS)
    return export_pdf(rows, fields, "warehouse")


@router.post("/board/import.xlsx", include_in_schema=False)
async def warehouse_import(_admin=Depends(require_admin), file: UploadFile = File(...)):
    """Montage / demontage workbook. Assembly rows, DOL and catalog stubs update together."""
    content = await read_xlsx(file)
    parsed = parse_assembly_excel(content)
    if not parsed.get("recognized"):
        raise HTTPException(
            status_code=400,
            detail=(
                "This Excel file does not match the montage / demontage sheet. "
                "فایل با برگه مونتاژ و دمونتاژ جور نیست."
            ),
        )

    def work(db: Session, progress):
        result = _apply_assembly_import(db, parsed, "upsert", progress)
        result["contractor_repairs"] = import_contractor_repairs(db, content)
        return result

    return spawn_import(work)


@router.post("/board/move")
def warehouse_move(
    payload: WarehouseMove,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_any_form_access("storage", "anodes", "cathodes")),
):
    try:
        return apply_move(db, payload.kind, payload.serial, payload.action, payload.date, payload.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
