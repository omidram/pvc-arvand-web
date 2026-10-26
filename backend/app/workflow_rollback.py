"""Undo plant-data writes when a workflow request is cancelled.

Cancel used to only mark the request cancelled. The operators expect the plant
to look as if that request had never been opened: Assembly Data, shop queue,
warehouse lifecycle, recoating rows, TAFKIK, and purchased masters go back.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from . import element_dashboard as svc
from . import models
from .warehouse import compact_eq, compact_nr
from .warehouse_lifecycle import get_state, upsert_state
from .workflow_models import (
    WfAssembleRequest,
    WfCoatingBatch,
    WfCoatingItem,
    WfCoatingPackage,
    WfEvent,
    WfInspectionRequest,
    WfPurchase,
    WfPurchaseItem,
    WfCellRequest,
    WfWorkOrder,
)

CLOSED = ("completed", "cancelled")
_ELEMENT_FIELDS = (
    "element_nr",
    "anode_nr",
    "cathode_nr",
    "membrane_nr",
    "membrane_type",
    "assembly_date",
    "commissioning_date",
    "decommissioning_date",
    "disassembly_date",
    "decommission_reason",
    "electrolyzer",
    "position",
    "group_nr",
    "dol_days",
    "remarks",
)


def _now() -> datetime:
    return datetime.utcnow()


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _parse_day(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value)[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def remember(db: Session, flow: str, record_id: int, patch: dict) -> None:
    row = (
        db.query(WfEvent)
        .filter_by(flow=flow, record_id=record_id, action="origin")
        .order_by(WfEvent.id)
        .first()
    )
    if row is None:
        db.add(
            WfEvent(
                flow=flow,
                record_id=record_id,
                action="origin",
                data=patch,
                created_at=_now(),
            )
        )
        return
    data = dict(row.data) if isinstance(row.data, dict) else {}
    states = list(data.get("wh_states") or [])
    incoming = patch.get("wh_states") or []
    seen = {(s.get("kind"), compact_nr(s.get("serial"))) for s in states}
    for item in incoming:
        key = (item.get("kind"), compact_nr(item.get("serial")))
        if key in seen:
            continue
        states.append(item)
        seen.add(key)
    merged = {**data, **{k: v for k, v in patch.items() if k != "wh_states"}}
    if states or incoming:
        merged["wh_states"] = states
    row.data = merged


def recall(db: Session, flow: str, record_id: int) -> dict:
    row = (
        db.query(WfEvent)
        .filter_by(flow=flow, record_id=record_id, action="origin")
        .order_by(WfEvent.id)
        .first()
    )
    return dict(row.data) if row is not None and isinstance(row.data, dict) else {}


def snapshot_element(el: models.Element | None) -> dict | None:
    if el is None:
        return None
    out: dict[str, Any] = {"id": el.id}
    for name in _ELEMENT_FIELDS:
        value = getattr(el, name, None)
        out[name] = _iso(value) if name.endswith("_date") else value
    return out


def snapshot_shop(db: Session, element_nr: str | None) -> str | None:
    key = compact_nr(element_nr)
    if not key:
        return None
    for row in db.query(models.ElementShopState).all():
        if compact_nr(row.element_nr) == key:
            return row.stage
    return None


def snapshot_wh(db: Session, kind: str, serial: str) -> dict:
    row = get_state(db, kind, serial)
    if row is None:
        return {"kind": kind, "serial": serial, "existed": False}
    return {
        "kind": kind,
        "serial": serial,
        "existed": True,
        "lifecycle_status": row.lifecycle_status,
        "company_id": row.company_id,
        "coating_status": row.coating_status,
        "appearance_status": row.appearance_status,
        "qc_result": row.qc_result,
        "open_dispatch_id": row.open_dispatch_id,
    }


def restore_shop(db: Session, element_nr: str | None, stage: str | None) -> None:
    key = compact_nr(element_nr)
    if not key:
        return
    row = next((s for s in db.query(models.ElementShopState).all() if compact_nr(s.element_nr) == key), None)
    if not stage:
        if row is not None:
            db.delete(row)
        return
    shown = (element_nr or "")[:50]
    if row is None:
        db.add(models.ElementShopState(element_nr=shown, stage=stage, updated_at=_now()))
        return
    row.stage = stage


def restore_element(db: Session, snap: dict | None) -> models.Element | None:
    if not snap or not snap.get("id"):
        return None
    el = db.get(models.Element, snap["id"])
    if el is None:
        return None
    for name in _ELEMENT_FIELDS:
        if name not in snap:
            continue
        value = snap[name]
        if name.endswith("_date"):
            setattr(el, name, _parse_day(value))
        else:
            setattr(el, name, value)
    return el


def restore_wh(db: Session, snap: dict) -> None:
    kind = snap.get("kind")
    serial = snap.get("serial")
    if kind not in ("anode", "cathode") or not serial:
        return
    if not snap.get("existed"):
        row = get_state(db, kind, serial)
        if row is not None:
            db.delete(row)
        return
    upsert_state(
        db,
        kind,
        serial,
        lifecycle_status=snap.get("lifecycle_status") or "in_plant",
        company_id=snap.get("company_id"),
        coating_status=snap.get("coating_status"),
        appearance_status=snap.get("appearance_status"),
        qc_result=snap.get("qc_result"),
        open_dispatch_id=snap.get("open_dispatch_id"),
    )


def _drop_lifecycle(db: Session, ref_kind: str, ref_id: int) -> None:
    for ev in db.query(models.WhLifecycleEvent).filter_by(ref_kind=ref_kind, ref_id=ref_id).all():
        db.delete(ev)


def _drop_shop_notes(db: Session, element_nr: str | None, token: str | None, since: datetime | None) -> None:
    key = compact_nr(element_nr)
    if not key:
        return
    for ev in db.query(models.ElementShopEvent).all():
        if compact_nr(ev.element_nr) != key:
            continue
        if since and ev.created_at and ev.created_at < since:
            continue
        blob = f"{ev.note or ''} {ev.to_stage or ''}"
        if token and token not in blob and ev.to_stage not in ("awaiting_qc", "ready", "decommissioned", "clear", "awaiting_disassembly"):
            continue
        db.delete(ev)


def _element_in_other_flow(db: Session, element_id: int, assemble_id: int) -> bool:
    for r in db.query(WfAssembleRequest).filter(WfAssembleRequest.id != assemble_id, WfAssembleRequest.status.notin_(CLOSED)).all():
        if r.element_id == element_id:
            return True
    for r in db.query(WfCellRequest).filter(WfCellRequest.status.notin_(CLOSED)).all():
        if r.element_id == element_id:
            return True
    return False


def _delete_air_for_assemble(db: Session, r: WfAssembleRequest) -> None:
    code = (r.code or "").strip()
    pinned = None
    dec = r.decisions if isinstance(r.decisions, dict) else {}
    if dec.get("air_id"):
        pinned = db.get(models.AssemblyInspectionReport, dec["air_id"])
    tagged = None
    if code:
        tagged = (
            db.query(models.AssemblyInspectionReport)
            .filter(models.AssemblyInspectionReport.remarks == f"Workflow {code}")
            .order_by(models.AssemblyInspectionReport.id.desc())
            .first()
        )
    for row in (pinned, tagged):
        if row is None:
            continue
        created = row.created_at
        if created and r.created_at and created < r.created_at:
            continue
        db.delete(row)


def _cancel_open_work_orders(db: Session, element_nr: str | None, since: datetime | None) -> None:
    key = compact_nr(element_nr)
    if not key:
        return
    for wo in db.query(WfWorkOrder).filter(WfWorkOrder.status == "open").all():
        if compact_nr(wo.element_nr) != key:
            continue
        if since and wo.created_at and wo.created_at < since:
            continue
        wo.status = "cancelled"
        wo.completed_at = _now()
        wo.updated_at = _now()
        wo.last_note = "Cancelled with the assemble request"


def rollback_assemble(db: Session, r: WfAssembleRequest) -> None:
    origin = recall(db, "assemble", r.id)
    _delete_air_for_assemble(db, r)
    el = db.get(models.Element, r.element_id) if r.element_id else None
    _cancel_open_work_orders(db, r.element_nr or (el.element_nr if el is not None else None), r.created_at)
    created_here = el is not None and origin.get("element") is None
    if el is not None and created_here and not _element_in_other_flow(db, el.id, r.id):
        _drop_shop_notes(db, el.element_nr, r.code, r.created_at)
        restore_shop(db, el.element_nr, None)
        db.delete(el)
    elif el is not None and origin.get("element"):
        restore_element(db, origin["element"])
        restore_shop(db, el.element_nr, origin.get("shop"))
        _drop_shop_notes(db, el.element_nr, r.code, r.created_at)
    elif el is not None:
        restore_shop(db, el.element_nr, None)
        _drop_shop_notes(db, el.element_nr, r.code, r.created_at)
        if (el.remarks or "").startswith(f"Assembled by {r.code}") and not el.commissioning_date:
            db.delete(el)
    r.element_id = None
    r.electrolyzer = None
    r.position = None
    svc.clear_cache()


def rollback_cell(db: Session, r: WfCellRequest) -> None:
    origin = recall(db, "cell", r.id)
    el = db.get(models.Element, r.element_id) if r.element_id else None
    if origin.get("element"):
        restore_element(db, origin["element"])
    elif el is not None and (r.request_kind or "removal") != "numbering":
        wrote_off = any(
            ev.action in ("shutdown", "assembly_data")
            for ev in db.query(WfEvent).filter_by(flow="cell", record_id=r.id).all()
        )
        if wrote_off and el.decommissioning_date and not el.disassembly_date:
            if _iso(el.decommissioning_date) == _iso(r.decommission_date) or (
                (el.decommission_reason or "").strip() == (r.reason or "").strip()
            ):
                el.decommissioning_date = None
                el.decommission_reason = None
    restore_shop(db, r.element_nr, origin.get("shop"))
    _drop_shop_notes(db, r.element_nr, r.code, r.created_at)
    svc.clear_cache()


def _workflow_recoating_rows(db: Session, kind: str, serial: str, codes: set[str]):
    if kind == "anode":
        rows = db.query(models.AnodeRecoating).all()
        for row in rows:
            if compact_nr(row.anode_nr) != compact_nr(serial):
                continue
            blob = f"{row.coating_nr or ''} {row.remarks or ''}"
            if any(code and code in blob for code in codes):
                yield row
        return
    rows = db.query(models.CathodeRecoating).all()
    for row in rows:
        if compact_nr(row.cathode_nr) != compact_nr(serial):
            continue
        blob = f"{row.remarks or ''}"
        if any(code and code in blob for code in codes):
            yield row


def _workflow_coating_checks(db: Session, kind: str, serial: str, codes: set[str]):
    model = models.AnodeCoatingCheck if kind == "anode" else models.CathodeCoatingCheck
    field = "anode_nr" if kind == "anode" else "cathode_nr"
    for row in db.query(model).all():
        if compact_nr(getattr(row, field)) != compact_nr(serial):
            continue
        blob = f"{getattr(row, 'coating_nr', None) or ''} {row.remarks or ''}"
        if any(code and code in blob for code in codes):
            yield row


def rollback_coating(db: Session, b: WfCoatingBatch) -> None:
    origin = recall(db, "coating", b.id)
    items = db.query(WfCoatingItem).filter_by(batch_id=b.id).all()
    codes = {p.code for p in db.query(WfCoatingPackage).filter_by(batch_id=b.id).all() if p.code}
    by_serial = {(s.get("kind"), compact_nr(s.get("serial"))): s for s in (origin.get("wh_states") or [])}
    for it in items:
        snap = by_serial.get((it.element_kind, compact_nr(it.serial)))
        if snap:
            restore_wh(db, snap)
        else:
            upsert_state(db, it.element_kind, it.serial, lifecycle_status="in_plant", company_id=None)
        for row in list(_workflow_recoating_rows(db, it.element_kind, it.serial, codes)):
            db.delete(row)
        for row in list(_workflow_coating_checks(db, it.element_kind, it.serial, codes)):
            db.delete(row)
    _drop_lifecycle(db, "wf_coating", b.id)
    for ev in db.query(WfEvent).filter_by(flow="inspection", action="created").all():
        data = ev.data if isinstance(ev.data, dict) else {}
        if data.get("coating_id") != b.id:
            continue
        child = db.get(WfInspectionRequest, ev.record_id)
        if child is None or child.status in CLOSED:
            continue
        rollback_inspection(db, child)
        child.status = "cancelled"
        child.completed_at = _now()
        child.updated_at = _now()


def _serial_mounted(db: Session, kind: str, serial: str) -> bool:
    field = "anode_nr" if kind == "anode" else "cathode_nr"
    key = compact_nr(serial)
    if not key:
        return False
    for el in db.query(models.Element).all():
        if compact_nr(getattr(el, field)) == key:
            return True
    return False


def rollback_purchase(db: Session, p: WfPurchase) -> None:
    for it in db.query(WfPurchaseItem).filter_by(purchase_id=p.id).all():
        if _serial_mounted(db, it.element_kind, it.serial):
            continue
        model = models.Anode if it.element_kind == "anode" else models.Cathode
        field = models.Anode.anode_nr if it.element_kind == "anode" else models.Cathode.cathode_nr
        match = compact_eq(field, it.serial)
        q = db.query(model)
        row = (q.filter(match).first() if match is not None else q.filter(field == it.serial).first())
        if row is not None and (getattr(row, "batch", None) or "") == (p.code or ""):
            db.delete(row)
        state = get_state(db, it.element_kind, it.serial)
        if state is not None:
            db.delete(state)
        db.delete(it)
    _drop_lifecycle(db, "wf_purchase", p.id)


def rollback_inspection(db: Session, r: WfInspectionRequest) -> None:
    marker = f"WF {r.code}" if r.code else ""
    if marker:
        for row in db.query(models.ElectrodeSegregation).all():
            blob = f"{row.remarks or ''}\n{row.inspection_form_serial or ''}"
            if marker in blob or (r.code and r.code == (row.inspection_form_serial or "")):
                db.delete(row)
    for kind, serial in (("anode", r.anode_nr), ("cathode", r.cathode_nr)):
        if not serial:
            continue
        for row in list(_workflow_coating_checks(db, kind, serial, {r.code or ""})):
            db.delete(row)
    origin = recall(db, "inspection", r.id)
    if origin.get("report_id") is None:
        r.report_id = None
    r.decisions = None
    svc.clear_cache()
