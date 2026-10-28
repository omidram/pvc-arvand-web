"""Membrane store: what was bought, what is left per type, and which membranes assemble requests consumed."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import element_dashboard as svc
from .. import models
from ..auth import get_current_user
from ..database import get_db
from ..warehouse import compact_nr
from ..workflow_models import MembraneStock, MembraneStockMove

router = APIRouter(prefix="/membrane-stock", tags=["membrane-stock"])

WRITE_GROUPS = {"c90", "warehouse"}


def _name(user: Any) -> str:
    return (getattr(user, "full_name", None) or "").strip() or getattr(user, "username", None) or "system"


def _iso(d: Any) -> str | None:
    return d.isoformat() if d is not None else None


def _type_key(value: str | None) -> str:
    return (value or "").strip().lower()


def _same_type(col):
    return func.lower(func.trim(col))


def _require_write(db: Session, user: models.User) -> None:
    from .workflow import _groups

    if user.role != "admin" and not (_groups(db, user) & WRITE_GROUPS):
        raise HTTPException(403, "Only C-90, the warehouse or an admin can change the membrane stock")


def _stock_rows(db: Session, mtype: str):
    return db.query(MembraneStock).filter(_same_type(MembraneStock.membrane_type) == _type_key(mtype), MembraneStock.quantity > 0)


def available(db: Session, mtype: str) -> int:
    return int(sum(r.quantity for r in _stock_rows(db, mtype).all()))


def tracked(db: Session, mtype: str) -> bool:
    key = _type_key(mtype)
    if not key:
        return False
    if db.query(MembraneStock.id).filter(_same_type(MembraneStock.membrane_type) == key).first():
        return True
    return db.query(MembraneStockMove.id).filter(_same_type(MembraneStockMove.membrane_type) == key, MembraneStockMove.from_stock.is_(True)).first() is not None


def _upsert_master(db: Session, serial: str, mtype: str, received: date | None) -> None:
    """A serial added to the store is a membrane master row, so every membrane combo offers it."""
    key = compact_nr(serial)
    if not key:
        return
    for row in db.query(models.Membrane).all():
        if compact_nr(row.membrane_nr) == key:
            if not (row.membrane_type or "").strip():
                row.membrane_type = mtype
            if row.received_date is None and received is not None:
                row.received_date = datetime.combine(received, datetime.min.time())
            return
    db.add(
        models.Membrane(
            membrane_nr=serial,
            membrane_type=mtype,
            received_date=datetime.combine(received, datetime.min.time()) if received else None,
        )
    )


def _add_stock(db: Session, mtype: str, serial: str | None, qty: int, purchase: date | None, note: str | None, who: str, kind: str = "purchase") -> MembraneStock:
    if serial:
        key = compact_nr(serial)
        for row in db.query(MembraneStock).filter(MembraneStock.serial.isnot(None), MembraneStock.quantity > 0).all():
            if compact_nr(row.serial) == key:
                raise HTTPException(409, f"Membrane {serial} is already in stock")
        row = MembraneStock(membrane_type=mtype, serial=serial, quantity=1, purchase_date=purchase, note=note, created_by_name=who)
        qty = 1
        _upsert_master(db, serial, mtype, purchase)
    else:
        row = MembraneStock(membrane_type=mtype, serial=None, quantity=qty, purchase_date=purchase, note=note, created_by_name=who)
    db.add(row)
    db.add(
        MembraneStockMove(
            kind=kind, membrane_type=mtype, serial=serial, quantity=qty, move_date=purchase or date.today(),
            purchase_date=purchase, note=note, user_name=who,
        )
    )
    return row


def consume(db: Session, mtype: str, serial: str | None, element_nr: str | None, request_code: str | None, who: str, day: date | None = None) -> None:
    """One membrane leaves the store for an assemble request (raises 409 when a tracked type has none left)."""
    mtype = (mtype or "").strip()
    serial = (serial or "").strip() or None
    if not mtype:
        return
    taken: MembraneStock | None = None
    if serial:
        key = compact_nr(serial)
        for row in _stock_rows(db, mtype).filter(MembraneStock.serial.isnot(None)).all():
            if compact_nr(row.serial) == key:
                taken = row
                break
    if taken is None:
        taken = _stock_rows(db, mtype).filter(MembraneStock.serial.is_(None)).order_by(MembraneStock.purchase_date, MembraneStock.id).first()
    from_stock = taken is not None
    if taken is None and tracked(db, mtype) and available(db, mtype) <= 0:
        raise HTTPException(409, f"No membrane of type '{mtype}' left in the membrane stock")
    if taken is None and tracked(db, mtype) and serial:
        raise HTTPException(409, f"Membrane {serial} of type '{mtype}' is not in the membrane stock")
    purchase = taken.purchase_date if taken is not None else None
    from_lot = taken is not None and taken.serial is None
    if taken is not None:
        taken.quantity -= 1
        if taken.quantity <= 0:
            db.delete(taken)
    db.add(
        MembraneStockMove(
            kind="used", membrane_type=mtype, serial=serial, quantity=-1, move_date=day or date.today(),
            purchase_date=purchase, element_nr=element_nr, request_code=request_code, from_stock=from_stock,
            note="lot" if from_lot else None, user_name=who,
        )
    )


def release_for_request(db: Session, request_code: str | None) -> None:
    """A cancelled assemble request puts its membrane back into the store."""
    if not request_code:
        return
    for mv in db.query(MembraneStockMove).filter(MembraneStockMove.kind == "used", MembraneStockMove.request_code == request_code).all():
        if mv.from_stock:
            lot = None
            if mv.serial and mv.note != "lot":
                db.add(MembraneStock(membrane_type=mv.membrane_type, serial=mv.serial, quantity=1, purchase_date=mv.purchase_date, created_by_name="rollback"))
            else:
                lot = (
                    _stock_rows(db, mv.membrane_type)
                    .filter(MembraneStock.serial.is_(None), MembraneStock.purchase_date == mv.purchase_date)
                    .first()
                )
                if lot is not None:
                    lot.quantity += 1
                else:
                    db.add(MembraneStock(membrane_type=mv.membrane_type, serial=None, quantity=1, purchase_date=mv.purchase_date, created_by_name="rollback"))
        db.delete(mv)


def _row(r: MembraneStock) -> dict:
    return {
        "id": r.id,
        "type": r.membrane_type,
        "serial": r.serial,
        "quantity": r.quantity,
        "purchase_date": _iso(r.purchase_date),
        "note": r.note,
        "created_by": r.created_by_name,
    }


def _used_row(m: MembraneStockMove) -> dict:
    return {
        "id": m.id,
        "type": m.membrane_type,
        "serial": m.serial,
        "date": _iso(m.move_date),
        "purchase_date": _iso(m.purchase_date),
        "element_nr": m.element_nr,
        "request_code": m.request_code,
        "from_stock": bool(m.from_stock),
        "user": m.user_name,
    }


def all_types(db: Session) -> list[str]:
    seen: dict[str, str] = {}
    sources = [
        db.query(MembraneStock.membrane_type),
        db.query(MembraneStockMove.membrane_type),
        db.query(models.Membrane.membrane_type),
        db.query(models.Element.membrane_type),
        db.query(models.GroupDefinition.membrane_type),
        db.query(models.FieldOption.value).filter(models.FieldOption.field_name == "membrane_type"),
    ]
    for q in sources:
        for (value,) in q.distinct().all():
            text = (value or "").strip()
            if text and text.lower() not in seen:
                seen[text.lower()] = text
    return sorted(seen.values(), key=str.lower)


def used_summary(db: Session) -> dict:
    """Totals for the dashboard: membranes taken from the store, by type."""
    moves = db.query(MembraneStockMove).filter(MembraneStockMove.kind == "used").all()
    by_type: dict[str, int] = {}
    for m in moves:
        label = (m.membrane_type or "").strip() or "—"
        by_type[label] = by_type.get(label, 0) + 1
    return {"total": len(moves), "types": [{"type": k, "count": v} for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])]}


@router.get("")
def overview(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    rows = db.query(MembraneStock).filter(MembraneStock.quantity > 0).order_by(MembraneStock.membrane_type, MembraneStock.purchase_date, MembraneStock.id).all()
    used = db.query(MembraneStockMove).filter(MembraneStockMove.kind == "used").all()
    types: dict[str, dict] = {}
    for name in all_types(db):
        types[name.lower()] = {"type": name, "in_stock": 0, "used": 0, "serials": 0, "last_purchase": None}
    for r in rows:
        t = types.setdefault(_type_key(r.membrane_type), {"type": r.membrane_type, "in_stock": 0, "used": 0, "serials": 0, "last_purchase": None})
        t["in_stock"] += r.quantity
        if r.serial:
            t["serials"] += 1
        if r.purchase_date and (t["last_purchase"] is None or _iso(r.purchase_date) > t["last_purchase"]):
            t["last_purchase"] = _iso(r.purchase_date)
    for m in used:
        t = types.get(_type_key(m.membrane_type))
        if t is not None:
            t["used"] += 1
    try:
        from .workflow import _groups

        can_edit = user.role == "admin" or bool(_groups(db, user) & WRITE_GROUPS)
    except Exception:
        can_edit = False
    return {
        "types": sorted(types.values(), key=lambda t: t["type"].lower()),
        "items": [_row(r) for r in rows],
        "total_in_stock": sum(r.quantity for r in rows),
        "total_used": len(used),
        "can_edit": can_edit,
    }


@router.get("/types")
def list_types(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    out = []
    for name in all_types(db):
        out.append({"type": name, "in_stock": available(db, name), "tracked": tracked(db, name)})
    return out


@router.get("/used")
def list_used(
    type: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    q = db.query(MembraneStockMove).filter(MembraneStockMove.kind == "used")
    if type:
        q = q.filter(_same_type(MembraneStockMove.membrane_type) == _type_key(type))
    rows = q.order_by(MembraneStockMove.move_date.desc(), MembraneStockMove.id.desc()).limit(limit).all()
    return {"items": [_used_row(m) for m in rows], **used_summary(db)}


@router.get("/moves")
def list_moves(limit: int = Query(300, ge=1, le=5000), db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    rows = db.query(MembraneStockMove).order_by(MembraneStockMove.id.desc()).limit(limit).all()
    return [
        {**_used_row(m), "kind": m.kind, "quantity": m.quantity, "note": m.note}
        for m in rows
    ]


class AddIn(BaseModel):
    type: str
    serial: str | None = None
    quantity: int = 1
    purchase_date: date | None = None
    note: str | None = None


@router.post("/add")
def add_stock(body: AddIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Buy or register membranes: give a serial (one membrane) or a count (a lot of that type)."""
    _require_write(db, user)
    mtype = (body.type or "").strip()
    if not mtype:
        raise HTTPException(400, "Choose or write the membrane type")
    serial = (body.serial or "").strip() or None
    qty = int(body.quantity or 0)
    if not serial and qty < 1:
        raise HTTPException(400, "Write a count or a serial number")
    _add_stock(db, mtype, serial, qty, body.purchase_date or date.today(), (body.note or "").strip() or None, _name(user))
    db.commit()
    svc.clear_cache()
    return {"ok": True, "in_stock": available(db, mtype)}


class AdjustIn(BaseModel):
    type: str
    delta: int
    purchase_date: date | None = None
    note: str | None = None


@router.post("/adjust")
def adjust_stock(body: AdjustIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Raise or lower the count of one type (lowering takes the oldest lots first, then serials)."""
    _require_write(db, user)
    mtype = (body.type or "").strip()
    if not mtype or not body.delta:
        raise HTTPException(400, "Choose the type and a non-zero change")
    note = (body.note or "").strip() or None
    who = _name(user)
    if body.delta > 0:
        _add_stock(db, mtype, None, body.delta, body.purchase_date or date.today(), note, who, kind="adjust")
    else:
        need = -body.delta
        if available(db, mtype) < need:
            raise HTTPException(409, f"Only {available(db, mtype)} of '{mtype}' in stock")
        rows = _stock_rows(db, mtype).order_by(MembraneStock.serial.isnot(None), MembraneStock.purchase_date, MembraneStock.id).all()
        left = need
        for row in rows:
            if left <= 0:
                break
            take = min(row.quantity, left)
            row.quantity -= take
            left -= take
            db.add(
                MembraneStockMove(
                    kind="adjust", membrane_type=mtype, serial=row.serial, quantity=-take, move_date=date.today(),
                    purchase_date=row.purchase_date, note=note, user_name=who,
                )
            )
            if row.quantity <= 0:
                db.delete(row)
    db.commit()
    svc.clear_cache()
    return {"ok": True, "in_stock": available(db, mtype)}


@router.delete("/items/{item_id}")
def remove_item(item_id: int, note: str | None = None, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_write(db, user)
    row = db.get(MembraneStock, item_id)
    if row is None:
        raise HTTPException(404, "Stock row not found")
    db.add(
        MembraneStockMove(
            kind="adjust", membrane_type=row.membrane_type, serial=row.serial, quantity=-row.quantity,
            move_date=date.today(), purchase_date=row.purchase_date, note=note or "Removed from stock", user_name=_name(user),
        )
    )
    db.delete(row)
    db.commit()
    svc.clear_cache()
    return {"ok": True}
