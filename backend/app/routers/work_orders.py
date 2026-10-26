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
from ..workflow_models import (
    WO_SKILLS,
    WO_STAGES,
    WfEvent,
    WfNotification,
    WfPlannerPerson,
    WfWorkOrder,
    WfWorkOrderLabor,
)

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
        "processes": _process_dates(wo),
        "element_history": [
            {
                "id": row.id,
                "code": row.code,
                "status": row.status,
                "seq": row.seq,
                "processes": _process_dates(row),
            }
            for row in db.query(WfWorkOrder)
            .filter(WfWorkOrder.element_nr == wo.element_nr)
            .order_by(WfWorkOrder.seq.desc(), WfWorkOrder.id.desc())
            .limit(40)
            .all()
        ],
    }


def _process_dates(wo: WfWorkOrder) -> dict[str, str | None]:
    return {
        "generation": _iso(wo.generation_date),
        "install": _iso(wo.install_date),
        "pickup": _iso(wo.pickup_date),
        "store": _iso(wo.store_date),
        "disassemble": _iso(wo.disassemble_date),
    }


def _latest_process_day(wo: WfWorkOrder) -> date | None:
    days = [wo.disassemble_date, wo.store_date, wo.pickup_date, wo.install_date, wo.generation_date, wo.report_date]
    return next((d for d in days if d is not None), None)


def _summary(wo: WfWorkOrder) -> dict:
    processes = _process_dates(wo)
    done = [key for key, value in processes.items() if value]
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
        "actual_date": _iso(_latest_process_day(wo)),
        "delay_days": None,
        "element_nr": wo.element_nr,
        "anode_nr": wo.anode_nr,
        "cathode_nr": wo.cathode_nr,
        "install_cell": wo.install_cell,
        "processes": processes,
        "process_keys": done,
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


_STAGE_DATE = {
    "generation": "generation_date",
    "install": "install_date",
    "pickup": "pickup_date",
    "store": "store_date",
    "disassemble": "disassemble_date",
}


def _fill_header_from_element(wo: WfWorkOrder, el: models.Element | None) -> None:
    if el is None:
        return
    wo.element_id = el.id
    wo.anode_nr = wo.anode_nr or el.anode_nr
    wo.cathode_nr = wo.cathode_nr or el.cathode_nr
    wo.membrane_nr = wo.membrane_nr or el.membrane_nr


def _open_work_order(db: Session, nr: str, *, new_life: bool = False) -> WfWorkOrder | None:
    rows = (
        db.query(WfWorkOrder)
        .filter(WfWorkOrder.element_nr == nr, WfWorkOrder.status == "open")
        .order_by(WfWorkOrder.id.desc())
        .all()
    )
    if not rows:
        return None
    if new_life:
        for row in rows:
            if row.disassemble_date is None:
                return row
        return None
    return rows[0]


def ensure_work_order_process(
    db: Session,
    element_nr: str,
    stage: str,
    actor: Any,
    *,
    day: date | None = None,
    cell: str | None = None,
    cell_request_id: int | None = None,
    note: str | None = None,
) -> WfWorkOrder | None:
    """One open planner form per element; each plant process fills that stage on the same history."""
    nr = (element_nr or "").strip()
    if not nr or stage not in _STAGE_DATE:
        return None
    when = day or date.today()
    new_life = stage in ("generation", "install")
    wo = _open_work_order(db, nr, new_life=new_life)
    el = _life(db, nr)
    user = actor if isinstance(actor, models.User) else None
    actor_name = _display(user) if user else (getattr(actor, "full_name", None) or getattr(actor, "username", None) or "system")
    created = False
    if wo is None:
        seq = _next_seq(db, nr)
        wo = WfWorkOrder(
            code=_wo_code(nr, seq),
            seq=seq,
            status="open",
            report_date=when,
            element_nr=nr,
            created_by_id=user.id if user else None,
            created_by_name=actor_name,
            created_at=_now(),
            updated_at=_now(),
        )
        db.add(wo)
        db.flush()
        created = True
    _fill_header_from_element(wo, el)
    field = _STAGE_DATE[stage]
    if getattr(wo, field) is None:
        setattr(wo, field, when)
    if stage == "install" and cell:
        wo.install_cell = cell[:40]
    if cell_request_id and not wo.cell_request_id:
        wo.cell_request_id = cell_request_id
    wo.updated_at = _now()
    db.add(
        WfEvent(
            flow="workorder",
            record_id=wo.id,
            action="auto_created" if created else "process",
            from_status=None if created else wo.status,
            to_status=wo.status,
            actor_id=user.id if user else None,
            actor_name=actor_name,
            note=(note or "").strip() or f"{stage} registered",
            data={"stage": stage, "date": when.isoformat(), "cell": cell},
            created_at=_now(),
        )
    )
    if created:
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


def ensure_work_order_for_disassembly(
    db: Session,
    element_nr: str,
    actor: Any,
    *,
    disassemble_date: date | None = None,
    cell_request_id: int | None = None,
) -> WfWorkOrder | None:
    return ensure_work_order_process(
        db,
        element_nr,
        "disassemble",
        actor,
        day=disassemble_date,
        cell_request_id=cell_request_id,
        note="Disassembly registered",
    )


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


def _people_catalog(db: Session) -> list[dict[str, str | None]]:
    seen: dict[tuple[str, str], dict[str, str | None]] = {}
    for row in db.query(WfPlannerPerson).order_by(WfPlannerPerson.skill, WfPlannerPerson.person_code).all():
        code = (row.person_code or "").strip()
        skill = (row.skill or "").strip()
        if not code or not skill:
            continue
        seen[(code, skill)] = {"person_code": code, "person_name": row.person_name, "skill": skill}
    for row in (
        db.query(WfWorkOrderLabor)
        .filter(WfWorkOrderLabor.person_code.isnot(None), WfWorkOrderLabor.skill.isnot(None))
        .all()
    ):
        code = (row.person_code or "").strip()
        skill = (row.skill or "").strip()
        if not code or not skill:
            continue
        key = (code, skill)
        if key not in seen:
            seen[key] = {"person_code": code, "person_name": row.person_name, "skill": skill}
    return sorted(seen.values(), key=lambda r: (r["skill"] or "", r["person_code"] or ""))


def _upsert_people(db: Session, labors: list[LaborIn]) -> None:
    for item in labors:
        code = (item.person_code or "").strip()
        skill = (item.skill or "").strip()
        name = (item.person_name or "").strip() or None
        if not code or not skill:
            continue
        row = (
            db.query(WfPlannerPerson)
            .filter(WfPlannerPerson.person_code == code, WfPlannerPerson.skill == skill)
            .one_or_none()
        )
        if row is None:
            db.add(WfPlannerPerson(person_code=code, person_name=name, skill=skill, updated_at=_now()))
        else:
            if name:
                row.person_name = name
            row.updated_at = _now()


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
    _upsert_people(db, labors)


@router.get("/meta")
def meta(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user)
    return {
        "stages": list(WO_STAGES),
        "skills": list(WO_SKILLS),
        "people": _people_catalog(db),
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
