"""Element management dashboard: cell-shop pipeline, electrode DOL / life, installed parts, coating, data links."""
from __future__ import annotations

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
    limit: int = Query(600, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    items = list(svc.build_pipeline(db))
    counts = svc.pipeline_counts(items)
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


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return svc.settings_dict(svc.get_settings(db))


@router.put("/settings")
def put_settings(body: SettingsBody, db: Session = Depends(get_db)):
    row = svc.get_settings(db)
    for key, value in body.model_dump().items():
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
