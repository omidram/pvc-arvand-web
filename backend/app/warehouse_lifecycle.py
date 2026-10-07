"""Anode/cathode lifecycle: companies, coating dispatch/receive, purchases, punch, decommission."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .warehouse import compact_nr, ensure_indexed, load_compact_index

LIFECYCLE_STATUSES = (
    "in_plant",
    "ready_dispatch",
    "at_coater",
    "pending_receive",
    "decommissioned",
)

EVENT_TYPES = (
    "purchase",
    "plant_entry",
    "dispatch",
    "receive",
    "punch",
    "decommission",
)


def _now() -> datetime:
    return datetime.utcnow()


def _stamp(day: date) -> datetime:
    return datetime.combine(day, datetime.min.time())


def next_doc_no(db: Session, prefix: str, on_date: date) -> str:
    """Example: CO-2025-024 (year from dispatch/purchase date, sequence per prefix+year)."""
    year = on_date.year
    pattern = f"{prefix}-{year}-%"
    if prefix == "CO":
        model = models.WhCoatingDispatch
        col = model.send_no
    elif prefix == "RC":
        model = models.WhCoatingReceiving
        col = model.receive_no
    elif prefix == "PO":
        model = models.WhPurchase
        col = model.purchase_no
    else:
        raise ValueError(f"Unknown doc prefix: {prefix}")
    rows = db.query(col).filter(col.like(pattern)).all()
    seq = 0
    for (val,) in rows:
        try:
            seq = max(seq, int(str(val).rsplit("-", 1)[-1]))
        except ValueError:
            continue
    return f"{prefix}-{year}-{seq + 1:03d}"


def ensure_element_master(db: Session, kind: str, serial: str) -> None:
    text = (serial or "").strip()
    if not text:
        return
    if kind == "anode":
        ensure_indexed(db, models.Anode, "anode_nr", text, load_compact_index(db, models.Anode, "anode_nr"))
    elif kind == "cathode":
        ensure_indexed(db, models.Cathode, "cathode_nr", text, load_compact_index(db, models.Cathode, "cathode_nr"))


def get_state(db: Session, kind: str, serial: str) -> models.WhElementState | None:
    key = compact_nr(serial)
    if not key:
        return None
    return (
        db.query(models.WhElementState)
        .filter(
            models.WhElementState.element_kind == kind,
            func.upper(func.replace(models.WhElementState.serial, " ", "")) == key,
        )
        .first()
    )


def upsert_state(
    db: Session,
    kind: str,
    serial: str,
    *,
    lifecycle_status: str,
    company_id: int | None = None,
    coating_status: str | None = None,
    appearance_status: str | None = None,
    qc_result: str | None = None,
    open_dispatch_id: int | None = None,
) -> models.WhElementState:
    ensure_element_master(db, kind, serial)
    row = get_state(db, kind, serial)
    if row is None:
        row = models.WhElementState(
            element_kind=kind,
            serial=serial.strip()[:50],
            lifecycle_status=lifecycle_status,
            company_id=company_id,
            coating_status=coating_status,
            appearance_status=appearance_status,
            qc_result=qc_result,
            open_dispatch_id=open_dispatch_id,
            updated_at=_now(),
        )
        db.add(row)
    else:
        row.lifecycle_status = lifecycle_status
        row.company_id = company_id
        if coating_status is not None:
            row.coating_status = coating_status
        if appearance_status is not None:
            row.appearance_status = appearance_status
        if qc_result is not None:
            row.qc_result = qc_result
        row.open_dispatch_id = open_dispatch_id
        row.updated_at = _now()
    return row


def log_event(
    db: Session,
    kind: str,
    serial: str,
    event_type: str,
    event_date: date,
    title: str,
    *,
    ref_kind: str | None = None,
    ref_id: int | None = None,
    details: dict | None = None,
) -> models.WhLifecycleEvent:
    ev = models.WhLifecycleEvent(
        element_kind=kind,
        serial=serial.strip()[:50],
        event_type=event_type,
        event_date=event_date,
        title=title,
        ref_kind=ref_kind,
        ref_id=ref_id,
        details=details or {},
        created_at=_now(),
    )
    db.add(ev)
    return ev


def refresh_dispatch_status(db: Session, dispatch_id: int) -> None:
    dispatch = db.get(models.WhCoatingDispatch, dispatch_id)
    if not dispatch:
        return
    items = db.query(models.WhCoatingDispatchItem).filter_by(dispatch_id=dispatch_id).all()
    if not items:
        dispatch.status = "sent"
        return
    received = sum(1 for i in items if i.received)
    if received == 0:
        dispatch.status = "sent"
    elif received == len(items):
        dispatch.status = "received"
    else:
        dispatch.status = "partial"


def company_payload(row: models.WhCompany) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "is_coating": row.is_coating,
        "is_supplier": row.is_supplier,
        "contact_person": row.contact_person,
        "phone": row.phone,
        "address": row.address,
        "contract_ref": row.contract_ref,
        "contract_valid_until": row.contract_valid_until.isoformat() if row.contract_valid_until else None,
        "remarks": row.remarks,
    }


def dashboard(db: Session) -> dict[str, Any]:
    counts = {s: 0 for s in LIFECYCLE_STATUSES}
    for status, n in (
        db.query(models.WhElementState.lifecycle_status, func.count())
        .group_by(models.WhElementState.lifecycle_status)
        .all()
    ):
        if status in counts:
            counts[status] = n
    decomm_master = (
        db.query(func.count()).select_from(models.Anode).filter(models.Anode.decommission_date.isnot(None)).scalar()
        or 0
    ) + (
        db.query(func.count()).select_from(models.Cathode).filter(models.Cathode.decommission_date.isnot(None)).scalar()
        or 0
    )
    counts["decommissioned"] = max(counts["decommissioned"], decomm_master)
    recent = (
        db.query(models.WhLifecycleEvent)
        .order_by(models.WhLifecycleEvent.event_date.desc(), models.WhLifecycleEvent.id.desc())
        .limit(15)
        .all()
    )
    return {
        "counts": counts,
        "recent": [
            {
                "id": e.id,
                "element_kind": e.element_kind,
                "serial": e.serial,
                "event_type": e.event_type,
                "event_date": e.event_date.isoformat(),
                "title": e.title,
                "details": e.details or {},
            }
            for e in recent
        ],
    }


def element_timeline(db: Session, kind: str, serial: str) -> dict[str, Any]:
    key = compact_nr(serial)
    state = get_state(db, kind, serial)
    events = (
        db.query(models.WhLifecycleEvent)
        .filter(
            models.WhLifecycleEvent.element_kind == kind,
            func.upper(func.replace(models.WhLifecycleEvent.serial, " ", "")) == key,
        )
        .order_by(models.WhLifecycleEvent.event_date.asc(), models.WhLifecycleEvent.id.asc())
        .all()
    )
    company_name = None
    if state and state.company_id:
        co = db.get(models.WhCompany, state.company_id)
        company_name = co.name if co else None
    return {
        "kind": kind,
        "serial": state.serial if state else serial,
        "current": {
            "lifecycle_status": state.lifecycle_status if state else None,
            "company_id": state.company_id if state else None,
            "company_name": company_name,
            "coating_status": state.coating_status if state else None,
            "appearance_status": state.appearance_status if state else None,
            "qc_result": state.qc_result if state else None,
            "open_dispatch_id": state.open_dispatch_id if state else None,
            "updated_at": state.updated_at.isoformat() if state and state.updated_at else None,
        },
        "events": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "event_date": e.event_date.isoformat(),
                "title": e.title,
                "ref_kind": e.ref_kind,
                "ref_id": e.ref_id,
                "details": e.details or {},
            }
            for e in events
        ],
    }


def company_history(db: Session, company_id: int) -> dict[str, Any]:
    co = db.get(models.WhCompany, company_id)
    if not co:
        raise ValueError("Company not found")
    dispatches = db.query(models.WhCoatingDispatch).filter_by(company_id=company_id).all()
    dispatch_ids = [d.id for d in dispatches]
    items_sent = (
        db.query(models.WhCoatingDispatchItem)
        .filter(models.WhCoatingDispatchItem.dispatch_id.in_(dispatch_ids))
        .all()
        if dispatch_ids
        else []
    )
    at_company = (
        db.query(models.WhElementState)
        .filter_by(company_id=company_id, lifecycle_status="at_coater")
        .count()
    )
    anode_sent = sum(1 for i in items_sent if i.element_kind == "anode")
    cathode_sent = sum(1 for i in items_sent if i.element_kind == "cathode")
    anode_back = sum(1 for i in items_sent if i.element_kind == "anode" and i.received)
    cathode_back = sum(1 for i in items_sent if i.element_kind == "cathode" and i.received)
    punches = db.query(models.WhPunch).filter_by(company_id=company_id).count()
    purchases = db.query(models.WhPurchase).filter_by(supplier_id=company_id).count()
    timeline: list[dict] = []
    for d in sorted(dispatches, key=lambda x: x.dispatch_date, reverse=True):
        timeline.append(
            {
                "kind": "dispatch",
                "date": d.dispatch_date.isoformat(),
                "doc_no": d.send_no,
                "status": d.status,
            }
        )
    return {
        "company": company_payload(co),
        "stats": {
            "dispatches": len(dispatches),
            "pieces_sent": len(items_sent),
            "pieces_returned": sum(1 for i in items_sent if i.received),
            "at_company": at_company,
            "anode_sent": anode_sent,
            "cathode_sent": cathode_sent,
            "anode_returned": anode_back,
            "cathode_returned": cathode_back,
            "punches": punches,
            "purchases": purchases,
        },
        "timeline": timeline[:50],
    }


def search_lifecycle(
    db: Session,
    *,
    element_kind: str | None = None,
    serial: str | None = None,
    lifecycle_status: str | None = None,
    company_id: int | None = None,
    send_no: str | None = None,
    receive_no: str | None = None,
    purchase_no: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 200,
) -> dict[str, Any]:
    """Combined search across states, events, and document numbers."""
    results: list[dict] = []

    q_state = db.query(models.WhElementState)
    if element_kind:
        q_state = q_state.filter(models.WhElementState.element_kind == element_kind)
    if lifecycle_status:
        q_state = q_state.filter(models.WhElementState.lifecycle_status == lifecycle_status)
    if company_id:
        q_state = q_state.filter(models.WhElementState.company_id == company_id)
    if serial:
        key = compact_nr(serial)
        q_state = q_state.filter(func.upper(func.replace(models.WhElementState.serial, " ", "")).like(f"%{key}%"))
    for row in q_state.limit(limit).all():
        results.append(
            {
                "hit": "state",
                "element_kind": row.element_kind,
                "serial": row.serial,
                "lifecycle_status": row.lifecycle_status,
                "company_id": row.company_id,
            }
        )

    q_ev = db.query(models.WhLifecycleEvent)
    if element_kind:
        q_ev = q_ev.filter(models.WhLifecycleEvent.element_kind == element_kind)
    if serial:
        key = compact_nr(serial)
        q_ev = q_ev.filter(func.upper(func.replace(models.WhLifecycleEvent.serial, " ", "")).like(f"%{key}%"))
    if date_from:
        q_ev = q_ev.filter(models.WhLifecycleEvent.event_date >= date_from)
    if date_to:
        q_ev = q_ev.filter(models.WhLifecycleEvent.event_date <= date_to)
    for ev in q_ev.order_by(models.WhLifecycleEvent.event_date.desc()).limit(limit).all():
        results.append(
            {
                "hit": "event",
                "element_kind": ev.element_kind,
                "serial": ev.serial,
                "event_type": ev.event_type,
                "event_date": ev.event_date.isoformat(),
                "title": ev.title,
            }
        )

    if send_no:
        d = db.query(models.WhCoatingDispatch).filter(models.WhCoatingDispatch.send_no.ilike(f"%{send_no.strip()}%")).all()
        for row in d:
            results.append({"hit": "dispatch", "send_no": row.send_no, "date": row.dispatch_date.isoformat(), "status": row.status})
    if receive_no:
        r = db.query(models.WhCoatingReceiving).filter(models.WhCoatingReceiving.receive_no.ilike(f"%{receive_no.strip()}%")).all()
        for row in r:
            results.append({"hit": "receiving", "receive_no": row.receive_no, "date": row.receive_date.isoformat()})
    if purchase_no:
        p = db.query(models.WhPurchase).filter(models.WhPurchase.purchase_no.ilike(f"%{purchase_no.strip()}%")).all()
        for row in p:
            results.append({"hit": "purchase", "purchase_no": row.purchase_no, "date": row.purchase_date.isoformat()})

    return {"results": results[:limit], "truncated": len(results) > limit}
