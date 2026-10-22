"""Cell-shop work orders (کارکرد C-90): planner fills who worked which stage, for how long."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..auth import LEVEL_RANK, get_current_user, user_permission_map
from ..database import get_db
from ..warehouse import compact_nr
from ..workflow_models import WO_SKILLS, WO_STAGES, WfEvent, WfNotification, WfWorkOrder, WfWorkOrderLabor

router = APIRouter(prefix="/work-orders", tags=["work-orders"], dependencies=[Depends(get_current_user)])

FORM_KEY = "wf_planner"
VIEW_KEYS = (FORM_KEY, "wf_c90", "wf_cellshop", "elements")
CLOSED = ("completed", "cancelled")


def _now() -> datetime:
    return datetime.now()


def _iso(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat(timespec="seconds") if isinstance(value, datetime) else value.isoformat()


def _display(user: models.User) -> str:
    return (user.full_name or "").strip() or user.username


def _perms(db: Session, user: models.User) -> dict[str, str]:
    if user.role == "admin":
        return {FORM_KEY: "edit"}
    return user_permission_map(db, user)


def _level(db: Session, user: models.User) -> str:
    if user.role == "admin":
        return "edit"
    perms = _perms(db, user)
    best = "none"
    for key in VIEW_KEYS:
        lvl = perms.get(key, "none")
        if LEVEL_RANK.get(lvl, 0) > LEVEL_RANK.get(best, 0):
            best = lvl
    # Planner key alone is enough for the page; other keys only unlock viewing.
    planner = perms.get(FORM_KEY, "none")
    if LEVEL_RANK.get(planner, 0) >= LEVEL_RANK["edit"]:
        return "edit"
    if LEVEL_RANK.get(planner, 0) >= LEVEL_RANK["view"]:
        return "view"
    if any(LEVEL_RANK.get(perms.get(k, "none"), 0) >= LEVEL_RANK["view"] for k in ("wf_c90", "wf_cellshop", "elements")):
        return "view"
    return "none"


def _require_view(db: Session, user: models.User) -> None:
    if _level(db, user) == "none":
        raise HTTPException(403, "No access to work orders")


def _require_edit(db: Session, user: models.User) -> None:
    if user.role == "admin":
        return
    perms = _perms(db, user)
    if LEVEL_RANK.get(perms.get(FORM_KEY, "none"), 0) < LEVEL_RANK["edit"]:
        raise HTTPException(403, "Only the planner can edit work orders")


def _planner_ids(db: Session) -> set[int]:
    found: set[int] = set()
    for u in db.query(models.User).filter(models.User.is_active.is_(True), models.User.role != "admin").all():
        if user_permission_map(db, u).get(FORM_KEY) == "edit":
            found.add(u.id)
    return found


def _wo_code(element_nr: str, seq: int) -> str:
    return f"wo-{element_nr}-{seq:06d}"


def _next_seq(db: Session, element_nr: str) -> int:
    return int(
        db.query(func.max(WfWorkOrder.seq)).filter(WfWorkOrder.element_nr == element_nr).scalar() or 0
    ) + 1


def _life(db: Session, element_nr: str) -> models.Element | None:
    key = compact_nr(element_nr)
    if not key:
        return None
    rows = db.query(models.Element).filter(models.Element.element_nr.isnot(None)).all()
    matches = [el for el in rows if compact_nr(el.element_nr) == key]
    if not matches:
        return None
    matches.sort(
        key=lambda el: (
            str(el.disassembly_date or ""),
            str(el.decommissioning_date or ""),
            str(el.assembly_date or ""),
            el.id or 0,
        ),
        reverse=True,
    )
    return matches[0]


def _labor_out(row: WfWorkOrderLabor) -> dict:
    return {
        "id": row.id,
        "stage": row.stage,
        "line_no": row.line_no,
        "person_code": row.person_code,
        "person_name": row.person_name,
        "skill": row.skill,
        "work_hours": row.work_hours,
        "work_qty": row.work_qty,
        "description": row.description,
    }


def _wo_out(db: Session, wo: WfWorkOrder) -> dict:
    labors = (
        db.query(WfWorkOrderLabor)
        .filter(WfWorkOrderLabor.work_order_id == wo.id)
        .order_by(WfWorkOrderLabor.stage, WfWorkOrderLabor.line_no, WfWorkOrderLabor.id)
        .all()
    )
    by_stage: dict[str, list[dict]] = {s: [] for s in WO_STAGES}
    for row in labors:
        by_stage.setdefault(row.stage, []).append(_labor_out(row))
    return {
        "id": wo.id,
        "code": wo.code,
        "seq": wo.seq,
        "status": wo.status,
        "report_date": _iso(wo.report_date),
        "element_nr": wo.element_nr,
        "element_id": wo.element_id,
        "anode_nr": wo.anode_nr,
        "cathode_nr": wo.cathode_nr,
        "membrane_nr": wo.membrane_nr,
        "cell_request_id": wo.cell_request_id,
        "generation_date": _iso(wo.generation_date),
        "install_date": _iso(wo.install_date),
        "install_cell": wo.install_cell,
        "pickup_date": _iso(wo.pickup_date),
        "store_date": _iso(wo.store_date),
        "disassemble_date": _iso(wo.disassemble_date),
        "remarks": wo.remarks,
        "last_note": wo.last_note,
        "created_by": wo.created_by_name,
        "created_at": _iso(wo.created_at),
        "updated_at": _iso(wo.updated_at),
        "completed_at": _iso(wo.completed_at),
        "labors": by_stage,
        "skills": list(WO_SKILLS),
        "stages": list(WO_STAGES),
    }


def _summary(wo: WfWorkOrder) -> dict:
    return {
        "flow": "workorder",
        "id": wo.id,
        "title": wo.code,
        "code": wo.code,
        "codes": [wo.code],
        "status": wo.status,
        "groups": ["planner"],
        "anode_count": 0,
        "cathode_count": 0,
        "company_id": None,
        "company_name": None,
        "indent_no": None,
        "dispatch_date": None,
        "expected_date": None,
        "actual_date": _iso(wo.disassemble_date or wo.report_date),
        "delay_days": None,
        "element_nr": wo.element_nr,
        "anode_nr": wo.anode_nr,
        "cathode_nr": wo.cathode_nr,
        "created_by": wo.created_by_name,
        "created_at": _iso(wo.created_at),
        "updated_at": _iso(wo.updated_at),
        "last_note": wo.last_note,
        "due_at": None,
        "sla_state": None,
    }


def _notify_planners(db: Session, wo: WfWorkOrder, actor: models.User) -> None:
    targets = _planner_ids(db)
    targets.discard(actor.id)
    for uid in targets:
        db.add(
            WfNotification(
                user_id=uid,
                flow="workorder",
                record_id=wo.id,
                status=wo.status,
                title=wo.code,
                from_name=_display(actor),
                created_at=_now(),
            )
        )


def _event(db: Session, wo: WfWorkOrder, action: str, actor: models.User, from_status: str | None, note: str | None = None, data: dict | None = None) -> None:
    db.add(
        WfEvent(
            flow="workorder",
            record_id=wo.id,
            action=action,
            from_status=from_status,
            to_status=wo.status,
            actor_id=actor.id,
            actor_name=_display(actor),
            note=(note or "").strip() or None,
            data=data or None,
            created_at=_now(),
        )
    )


def ensure_work_order_for_disassembly(
    db: Session,
    element_nr: str,
    actor: Any,
    *,
    disassemble_date: date | None = None,
    cell_request_id: int | None = None,
) -> WfWorkOrder | None:
    """Open a work order when dismantling is confirmed, so the planner can log cell-shop labor."""
    nr = (element_nr or "").strip()
    if not nr:
        return None
    day = disassemble_date or date.today()
    existing = (
        db.query(WfWorkOrder)
        .filter(
            WfWorkOrder.element_nr == nr,
            WfWorkOrder.status == "open",
            WfWorkOrder.disassemble_date.isnot(None),
        )
        .order_by(WfWorkOrder.id.desc())
        .first()
    )
    if existing is not None:
        if cell_request_id and not existing.cell_request_id:
            existing.cell_request_id = cell_request_id
        if existing.disassemble_date is None:
            existing.disassemble_date = day
        existing.updated_at = _now()
        return existing

    el = _life(db, nr)
    seq = _next_seq(db, nr)
    user = actor if isinstance(actor, models.User) else None
    actor_name = _display(user) if user else (getattr(actor, "full_name", None) or getattr(actor, "username", None) or "system")
    wo = WfWorkOrder(
        code=_wo_code(nr, seq),
        seq=seq,
        status="open",
        report_date=day,
        element_nr=nr,
        element_id=el.id if el else None,
        anode_nr=(el.anode_nr if el else None),
        cathode_nr=(el.cathode_nr if el else None),
        membrane_nr=(el.membrane_nr if el else None),
        cell_request_id=cell_request_id,
        disassemble_date=day,
        created_by_id=user.id if user else None,
        created_by_name=actor_name,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(wo)
    db.flush()
    db.add(
        WfEvent(
            flow="workorder",
            record_id=wo.id,
            action="auto_created",
            from_status=None,
            to_status=wo.status,
            actor_id=user.id if user else None,
            actor_name=actor_name,
            note="Disassembly registered",
            data={"date": day.isoformat()},
            created_at=_now(),
        )
    )
    targets = _planner_ids(db)
    if user is not None:
        targets.discard(user.id)
    for uid in targets:
        db.add(
            WfNotification(
                user_id=uid,
                flow="workorder",
                record_id=wo.id,
                status=wo.status,
                title=wo.code,
                from_name=actor_name,
                created_at=_now(),
            )
        )
    return wo


class LaborIn(BaseModel):
    id: int | None = None
    stage: str
    person_code: str | None = None
    person_name: str | None = None
    skill: str | None = None
    work_hours: float | None = None
    work_qty: str | None = None
    description: str | None = None


class WorkOrderIn(BaseModel):
    report_date: date | None = None
    element_nr: str = Field(min_length=1, max_length=50)
    anode_nr: str | None = None
    cathode_nr: str | None = None
    membrane_nr: str | None = None
    generation_date: date | None = None
    install_date: date | None = None
    install_cell: str | None = None
    pickup_date: date | None = None
    store_date: date | None = None
    disassemble_date: date | None = None
    remarks: str | None = None
    labors: list[LaborIn] = []


class NoteIn(BaseModel):
    note: str | None = None


def _apply_header(wo: WfWorkOrder, body: WorkOrderIn, el: models.Element | None) -> None:
    wo.report_date = body.report_date
    wo.anode_nr = (body.anode_nr or "").strip() or (el.anode_nr if el else None)
    wo.cathode_nr = (body.cathode_nr or "").strip() or (el.cathode_nr if el else None)
    wo.membrane_nr = (body.membrane_nr or "").strip() or (el.membrane_nr if el else None)
    wo.generation_date = body.generation_date
    wo.install_date = body.install_date
    wo.install_cell = (body.install_cell or "").strip() or None
    wo.pickup_date = body.pickup_date
    wo.store_date = body.store_date
    wo.disassemble_date = body.disassemble_date
    wo.remarks = (body.remarks or "").strip() or None
    if el is not None:
        wo.element_id = el.id


def _replace_labors(db: Session, wo: WfWorkOrder, labors: list[LaborIn]) -> None:
    db.query(WfWorkOrderLabor).filter(WfWorkOrderLabor.work_order_id == wo.id).delete()
    counters: dict[str, int] = {}
    for item in labors:
        stage = (item.stage or "").strip()
        if stage not in WO_STAGES:
            raise HTTPException(400, f"Unknown stage: {stage}")
        blank = not any(
            [
                (item.person_code or "").strip(),
                (item.person_name or "").strip(),
                (item.skill or "").strip(),
                item.work_hours is not None,
                (item.work_qty or "").strip(),
                (item.description or "").strip(),
            ]
        )
        if blank:
            continue
        counters[stage] = counters.get(stage, 0) + 1
        db.add(
            WfWorkOrderLabor(
                work_order_id=wo.id,
                stage=stage,
                line_no=counters[stage],
                person_code=(item.person_code or "").strip() or None,
                person_name=(item.person_name or "").strip() or None,
                skill=(item.skill or "").strip() or None,
                work_hours=item.work_hours,
                work_qty=(item.work_qty or "").strip() or None,
                description=(item.description or "").strip() or None,
            )
        )


@router.get("/meta")
def meta(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user)
    return {
        "stages": list(WO_STAGES),
        "skills": list(WO_SKILLS),
        "can_edit": _level(db, user) == "edit" or user.role == "admin",
    }


@router.get("")
def list_work_orders(
    q: str | None = None,
    status: str | None = None,
    element_nr: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_view(db, user)
    query = db.query(WfWorkOrder)
    if status:
        query = query.filter(WfWorkOrder.status == status)
    if element_nr:
        query = query.filter(WfWorkOrder.element_nr == element_nr.strip())
    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        query = query.filter(
            (WfWorkOrder.code.ilike(like))
            | (WfWorkOrder.element_nr.ilike(like))
            | (WfWorkOrder.anode_nr.ilike(like))
            | (WfWorkOrder.cathode_nr.ilike(like))
            | (WfWorkOrder.membrane_nr.ilike(like))
        )
    rows = query.order_by(WfWorkOrder.id.desc()).limit(limit).all()
    return [_summary(r) for r in rows]


@router.get("/{work_order_id}")
def get_work_order(work_order_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user)
    wo = db.get(WfWorkOrder, work_order_id)
    if wo is None:
        raise HTTPException(404, "Work order not found")
    return _wo_out(db, wo)


@router.post("")
def create_work_order(body: WorkOrderIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_edit(db, user)
    nr = body.element_nr.strip()
    el = _life(db, nr)
    seq = _next_seq(db, nr)
    wo = WfWorkOrder(
        code=_wo_code(nr, seq),
        seq=seq,
        status="open",
        element_nr=nr,
        created_by_id=user.id,
        created_by_name=_display(user),
        created_at=_now(),
        updated_at=_now(),
    )
    _apply_header(wo, body, el)
    if wo.report_date is None:
        wo.report_date = date.today()
    db.add(wo)
    db.flush()
    _replace_labors(db, wo, body.labors)
    _event(db, wo, "create", user, None)
    _notify_planners(db, wo, user)
    db.commit()
    return _wo_out(db, wo)


@router.put("/{work_order_id}")
def update_work_order(
    work_order_id: int,
    body: WorkOrderIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_edit(db, user)
    wo = db.get(WfWorkOrder, work_order_id)
    if wo is None:
        raise HTTPException(404, "Work order not found")
    if wo.status in CLOSED:
        raise HTTPException(409, "The work order is closed")
    nr = body.element_nr.strip()
    if compact_nr(nr) != compact_nr(wo.element_nr):
        raise HTTPException(400, "Element number on a work order cannot change")
    el = _life(db, wo.element_nr)
    _apply_header(wo, body, el)
    _replace_labors(db, wo, body.labors)
    wo.updated_at = _now()
    _event(db, wo, "update", user, wo.status)
    db.commit()
    return _wo_out(db, wo)


@router.post("/{work_order_id}/complete")
def complete_work_order(
    work_order_id: int,
    body: NoteIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_edit(db, user)
    wo = db.get(WfWorkOrder, work_order_id)
    if wo is None:
        raise HTTPException(404, "Work order not found")
    if wo.status in CLOSED:
        raise HTTPException(409, "Already closed")
    prev = wo.status
    wo.status = "completed"
    wo.completed_at = _now()
    wo.updated_at = _now()
    wo.last_note = (body.note or "").strip() or wo.last_note
    _event(db, wo, "complete", user, prev, body.note)
    db.commit()
    return _wo_out(db, wo)


@router.post("/{work_order_id}/cancel")
def cancel_work_order(
    work_order_id: int,
    body: NoteIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_edit(db, user)
    wo = db.get(WfWorkOrder, work_order_id)
    if wo is None:
        raise HTTPException(404, "Work order not found")
    if wo.status in CLOSED:
        raise HTTPException(409, "Already closed")
    prev = wo.status
    wo.status = "cancelled"
    wo.completed_at = _now()
    wo.updated_at = _now()
    wo.last_note = (body.note or "").strip() or wo.last_note
    _event(db, wo, "cancel", user, prev, body.note)
    db.commit()
    return _wo_out(db, wo)
