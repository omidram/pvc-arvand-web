"""Element management dashboard: cell-shop pipeline, electrode DOL / life, installed parts, coating, data links."""
from __future__ import annotations

from datetime import date as date_type
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import element_dashboard as svc
from .. import models, relationship_audit
from ..auth import get_current_user
from ..database import get_db
from ..warehouse import compact_nr

def _fresh(refresh: bool = Query(False, description="drop the short-lived cache first")) -> None:
    if refresh:
        svc.clear_cache()


router = APIRouter(prefix="/element-dashboard", tags=["element-dashboard"], dependencies=[Depends(_fresh)])


@router.get("/overview")
def get_overview(db: Session = Depends(get_db)):
    return svc.overview(db)


# ---------------------------------------------------------------- cell-shop pipeline


@router.get("/shop")
def list_shop(
    state: str | None = Query(None, description="one of the pipeline states, or 'all'"),
    q: str | None = None,
    element_nr: str | None = Query(None, description="exact element number (spacing ignored)"),
    limit: int = Query(600, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    items = list(svc.build_pipeline(db))
    counts = svc.pipeline_counts(items)
    if element_nr:
        key = compact_nr(element_nr)
        items = [i for i in items if i["key"] == key]
    if state == "shop":  # everything that needs a decision: not in service, not already-archived dismantled cells
        items = [i for i in items if i["state"] not in ("in_service", "disassembled")]
    elif state and state != "all":
        items = [i for i in items if i["state"] == state]
    if q:
        needle = q.strip().lower()
        squeezed = compact_nr(q)
        items = [
            i
            for i in items
            if (squeezed and squeezed in i["key"])
            or needle in (i["electrolyzer"] or "").lower()
            or needle in (i["note"] or "").lower()
            or any(needle in str(i[f] or "").lower() for f in ("anode_nr", "cathode_nr", "membrane_nr", "group_nr"))
        ]
    # most recently changed first for stages in the shop; longest waiting first elsewhere
    items.sort(key=lambda i: (i["since"] or ""), reverse=True)
    return {"counts": counts, "items": items[:limit], "truncated": len(items) > limit}


class ShopMove(BaseModel):
    element_nrs: list[str] = Field(min_length=1)
    stage: str  # one of the manual stages or "clear"
    note: str | None = None


@router.post("/shop/move")
def move_shop(body: ShopMove, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    svc.clear_cache()
    moved: list[str] = []
    errors: list[dict[str, str]] = []
    items = {i["key"]: i for i in svc.build_pipeline(db)}
    for nr in dict.fromkeys(n.strip() for n in body.element_nrs if n and n.strip()):
        try:  # every check runs before anything is written, so a refused element leaves no half-change
            svc.set_shop_stage(db, nr, body.stage, (body.note or "").strip() or None, user.full_name or user.username, items)
            moved.append(nr)
        except ValueError as exc:
            errors.append({"element_nr": nr, "error": str(exc)})
    if not moved and errors:
        raise HTTPException(status_code=400, detail=errors[0]["error"])
    db.commit()
    svc.clear_cache()
    return {"moved": moved, "errors": errors}


class ShopAdvance(BaseModel):
    element_nr: str = Field(min_length=1)
    note: str | None = None
    date: date_type | None = None  # dismantling date; today when empty


@router.post("/shop/advance")
def advance_shop(body: ShopAdvance, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Cell-shop cartable: confirm the next step of one element (scan or pick its tag)."""
    svc.clear_cache()
    try:
        result = svc.advance_stage(db, body.element_nr.strip(), (body.note or "").strip() or None, user.full_name or user.username, body.date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    svc.clear_cache()
    return result


class ShopDecide(BaseModel):
    element_nr: str = Field(min_length=1)
    choice: str  # keep | disassemble
    note: str | None = None


@router.post("/shop/decide")
def decide_shop(body: ShopDecide, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """After the Decommission Date: healthy cell stays in the cell shop, or goes to disassembly."""
    svc.clear_cache()
    try:
        result = svc.decide_decommissioned(db, body.element_nr.strip(), body.choice, (body.note or "").strip() or None, user.full_name or user.username)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    svc.clear_cache()
    return result


class ShopRelocate(BaseModel):
    element_nr: str = Field(min_length=1)
    electrolyzer: str = Field(min_length=1)
    position: str = Field(min_length=1)
    date: date_type | None = None  # day it is placed in the new cell; today when empty
    group_nr: str | None = None  # keeps the previous group when empty
    note: str | None = None


@router.post("/shop/relocate")
def relocate_shop(body: ShopRelocate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Healthy cell -> new position (flowchart: "assign new position"). Same element number and parts, a new installation row.

    The row of the old installation is closed by the usual Assembly Data rule (a newer installation ends the earlier one).
    """
    from .elements import _ensure_group, _normalize_position, _reject_same_installation, _sync_saved_element
    from ..assembly_integrity import cell_key, is_open
    from ..plant_topology import all_electrolyzers, format_electrolyzer_name

    key = compact_nr(body.element_nr)
    item = next((i for i in svc.build_pipeline(db) if i["key"] == key), None)
    if item is None or item["base_state"] != "decommissioned":
        raise HTTPException(status_code=400, detail=f"Element {body.element_nr} is not a switched-off, healthy cell")
    rows = [el for el in db.query(models.Element).all() if compact_nr(el.element_nr) == key]
    old = max(rows, key=svc._life_key)
    electrolyzer = format_electrolyzer_name(body.electrolyzer.strip())
    if not electrolyzer or electrolyzer not in {format_electrolyzer_name(n) for n in all_electrolyzers()}:
        raise HTTPException(status_code=400, detail=f"'{body.electrolyzer}' is not an electrolyzer of this plant")
    position = _normalize_position(body.position)
    day = body.date or date_type.today()
    last = svc._as_date(old.decommissioning_date) or svc._as_date(old.commissioning_date) or svc._as_date(old.assembly_date)
    if last and day < last:
        raise HTTPException(status_code=400, detail=f"The new position cannot start before the element was switched off ({last.isoformat()})")

    probe = models.Element(electrolyzer=electrolyzer, position=position)
    target = cell_key(probe)
    busy = next((el for el in db.query(models.Element).filter(models.Element.electrolyzer.isnot(None)).all() if is_open(el) and cell_key(el) == target and el.id != old.id), None)
    if busy is not None:
        raise HTTPException(status_code=409, detail=f"Cell {electrolyzer}-{position} is occupied by element {busy.element_nr}")

    group_nr = (body.group_nr or old.group_nr or "").strip() or None
    _ensure_group(db, group_nr)
    new = models.Element(
        element_nr=old.element_nr,
        electrolyzer=electrolyzer,
        position=position,
        group_nr=group_nr,
        generation=old.generation,
        anode_nr=old.anode_nr,
        cathode_nr=old.cathode_nr,
        membrane_nr=old.membrane_nr,
        membrane_type=old.membrane_type,
        gap_mm=old.gap_mm,
        ispb=old.ispb,
        assembly_date=day,
        anode_coating=old.anode_coating,
        anode_electrode=old.anode_electrode,
        anode_shell=old.anode_shell,
        cathode_coating=old.cathode_coating,
        cathode_electrode=old.cathode_electrode,
        cathode_shell=old.cathode_shell,
        membrane_info=old.membrane_info,
        remarks=(body.note or "").strip() or f"Moved from {old.electrolyzer or '—'}-{old.position or '—'} (healthy cell)",
    )
    _reject_same_installation(db, new)
    db.add(new)
    _sync_saved_element(db, new)
    db.flush()
    if old.disassembly_date is None:  # the old installation ends the day the cell is moved
        old.disassembly_date = day
        old.dol_days = svc.installation_dol(old.assembly_date, old.commissioning_date, old.disassembly_date, old.decommissioning_date)
    for state in db.query(models.ElementShopState).all():
        if compact_nr(state.element_nr) == key:
            db.delete(state)
    from datetime import datetime

    db.add(
        models.ElementShopEvent(
            element_nr=str(old.element_nr)[:50], from_stage=item["state"], to_stage="relocated", note=f"{electrolyzer}-{position}" + (f": {body.note.strip()}" if (body.note or "").strip() else ""),
            user=user.full_name or user.username, created_at=datetime.now(),
        )
    )
    db.commit()
    svc.clear_cache()
    return {"element_nr": old.element_nr, "electrolyzer": electrolyzer, "position": position, "id": new.id}


# ---------------------------------------------------------------- element workflow (flowchart)


@router.get("/flow")
def flow_overview(db: Session = Depends(get_db)):
    from .. import element_flow

    return element_flow.overview(db)


@router.get("/flow/list")
def flow_list(node: str, q: str | None = None, limit: int = Query(500, ge=1, le=5000), db: Session = Depends(get_db)):
    from .. import element_flow

    return element_flow.node_list(db, node, q, limit)


@router.get("/shop/events")
def shop_events(element_nr: str | None = None, limit: int = Query(100, ge=1, le=1000), db: Session = Depends(get_db)):
    query = db.query(models.ElementShopEvent)
    if element_nr:
        key = compact_nr(element_nr)
        query = query.filter(models.ElementShopEvent.element_nr.in_([e.element_nr for e in db.query(models.ElementShopEvent).all() if compact_nr(e.element_nr) == key] or [""]))
    rows = query.order_by(models.ElementShopEvent.created_at.desc(), models.ElementShopEvent.id.desc()).limit(limit).all()
    return [
        {"id": e.id, "element_nr": e.element_nr, "from_stage": e.from_stage, "to_stage": e.to_stage, "note": e.note, "user": e.user, "at": e.created_at.isoformat(timespec="seconds") if e.created_at else None}
        for e in rows
    ]


# ---------------------------------------------------------------- electrodes / membranes with DOL and life


@router.get("/parts")
def list_parts(
    kind: str = Query("anode", pattern="^(anode|cathode|membrane)$"),
    where: str = Query("all", pattern="^(all|installed|warehouse)$"),
    life: str = Query("all", pattern="^(all|ok|warning|expired|alert)$"),
    min_dol: int | None = None,
    max_dol: int | None = None,
    due_within: int | None = Query(None, ge=0, le=3650),
    q: str | None = None,
    limit: int = Query(1500, ge=1, le=20000),
    db: Session = Depends(get_db),
):
    cfg = svc.settings_dict(svc.get_settings(db))
    rows = svc.part_rows(db, kind, cfg)
    summary = svc.life_summary(rows)
    histogram = svc.life_histogram(rows)
    if where == "installed":
        rows = [r for r in rows if r["installed"]]
    elif where == "warehouse":
        rows = [r for r in rows if not r["installed"]]
    if life == "alert":
        rows = [r for r in rows if r["life_status"] in ("warning", "expired")]
    elif life != "all":
        rows = [r for r in rows if r["life_status"] == life]

    def basis(r: dict[str, Any]) -> int | None:
        return r["coating_dol"] if kind != "membrane" else r["total_dol"]

    if min_dol is not None:
        rows = [r for r in rows if basis(r) is not None and basis(r) >= min_dol]
    if max_dol is not None:
        rows = [r for r in rows if basis(r) is not None and basis(r) <= max_dol]
    if due_within is not None:
        # still running, but reaching the life limit inside the next N days
        rows = [r for r in rows if r["installed"] and svc._due_within(r, due_within)]
    if q:
        needle, squeezed = q.strip().lower(), compact_nr(q)
        rows = [
            r
            for r in rows
            if (squeezed and squeezed in r["key"])
            or needle in str(r.get("element_nr") or "").lower()
            or needle in str(r.get("electrolyzer") or "").lower()
        ]
    rows.sort(key=lambda r: (-(r["life_pct"] if r["life_pct"] is not None else -1), r["serial"]))
    limit_key = {"anode": "anode_life_days", "cathode": "cathode_life_days", "membrane": "membrane_life_days"}[kind]
    return {
        "kind": kind,
        "limit_days": cfg[limit_key],
        "warn_percent": cfg["warn_percent"],
        "summary": summary,
        "histogram": histogram,
        "matched": len(rows),
        "items": rows[:limit],
        "truncated": len(rows) > limit,
    }


@router.get("/installed")
def installed(db: Session = Depends(get_db)):
    return svc.installed_overview(db)


@router.get("/cells")
def cells(db: Session = Depends(get_db)):
    """What is installed in every cell of every train, plus cells / elements that are entered twice."""
    return svc.cells_overview(db)


@router.get("/coating")
def coating(kind: str = Query("anode", pattern="^(anode|cathode)$"), db: Session = Depends(get_db)):
    return svc.coating_overview(db, kind)


# ---------------------------------------------------------------- settings


class SettingsBody(BaseModel):
    anode_life_days: int | None = Field(None, ge=1, le=36500)
    cathode_life_days: int | None = Field(None, ge=1, le=36500)
    membrane_life_days: int | None = Field(None, ge=1, le=36500)
    warn_percent: int | None = Field(None, ge=1, le=100)
    coating_thickness_min: float | None = Field(None, ge=0)
    shop_queue_days: int | None = Field(None, ge=0, le=3650)


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return svc.settings_dict(svc.get_settings(db))


@router.put("/settings")
def put_settings(body: SettingsBody, db: Session = Depends(get_db)):
    row = svc.get_settings(db)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    svc.clear_cache()
    return svc.settings_dict(row)


# ---------------------------------------------------------------- relationship audit


@router.get("/relations")
def relations_report(db: Session = Depends(get_db)):
    return svc.audit_report(db)


@router.get("/integrity")
def integrity(db: Session = Depends(get_db)):
    """Headline numbers of the table-link audit (the full report is /relations)."""
    return svc.audit_report(db)["summary"]


class RepairBody(BaseModel):
    only: list[str] | None = None
    mode: str = Field("all", pattern="^(all|links|fill)$")


@router.post("/relations/repair")
def relations_repair(body: RepairBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an administrator can repair table links")
    result = relationship_audit.run_repair(db, body.only, body.mode)
    svc.clear_cache()
    result["after"] = svc.audit_report(db)["summary"]
    return result
