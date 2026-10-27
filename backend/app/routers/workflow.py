"""Recoating, new-purchase and cell-removal workflows with per-group cartables and notifications.

Groups are permission keys: wf_c90 (requesting unit), wf_procurement, wf_warehouse, wf_inspection,
wf_operation (switches cells off), wf_cellshop (receives them). "edit" on a key means the user belongs to
that group and may act on its stages; admins may act everywhere.
"""
from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import date, datetime, timedelta
from datetime import date as date_type
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import element_dashboard as svc
from .. import models
from ..auth import LEVEL_RANK, get_current_user, user_permission_map
from ..database import get_db
from ..paths import data_root
from ..plant_topology import all_electrolyzers, format_electrolyzer_name
from ..relations_sync import link_serial
from ..segregation_enrich import disassembly_monitoring, enrich_segregation_fields, format_service_life
from ..segregation_flow import classify_row
from ..warehouse import compact_eq, compact_nr, ensure_indexed, load_compact_index
from ..electrode_lifecycle import (
    coating_check_on_inspect,
    maintenance_from_inspection,
    recoating_on_approve,
    recoating_on_dispatch,
    recoating_on_return,
    write_tafkik_warranty,
)
from ..warehouse_lifecycle import _stamp, log_event, upsert_state
from ..workflow_rollback import (
    remember,
    rollback_assemble,
    rollback_cell,
    rollback_coating,
    rollback_inspection,
    rollback_purchase,
    snapshot_element,
    snapshot_shop,
    snapshot_wh,
)
from ..workflow_excel import build_workbook, parse_report
from ..workflow_models import (
    WfAssembleRequest,
    WfCellRequest,
    WfCoatingBatch,
    WfCoatingItem,
    WfCoatingPackage,
    WfEvent,
    WfFile,
    WfInspectionRequest,
    WfNotification,
    WfPurchase,
    WfPurchaseItem,
    WfSettings,
    WfWorkOrder,
    WfWorkOrderLabor,
)
from .tickets import BLOCKED_EXT, INLINE_TYPES, MAX_BYTES, _safe_name

router = APIRouter(prefix="/workflow", tags=["workflow"], dependencies=[Depends(get_current_user)])

GROUP_KEYS = {
    "c90": "wf_c90",
    "procurement": "wf_procurement",
    "warehouse": "wf_warehouse",
    "inspection": "wf_inspection",
    "operation": "wf_operation",
    "cellshop": "wf_cellshop",
    "process": "wf_process",
    "planner": "wf_planner",
}
VIEW_KEYS = ("storage", "anodes", "cathodes", "wf_c90", "wf_procurement", "wf_warehouse", "wf_inspection")
CELL_VIEW_KEYS = ("elements", "wf_operation", "wf_cellshop", "wf_c90", "wf_planner")

# Coating hand-off (chart): C-90 selects the piece and the system makes the code, then
# procurement plans the send, warehouse issues the indent, procurement ships and later
# receives it, inspection/process accepts or sends it back, C-90 returns it to service.
COATING_STAGES: dict[str, list[str]] = {
    "await_company": ["procurement"],
    "await_indent": ["warehouse"],
    "await_dispatch": ["procurement"],
    "await_return": ["procurement"],
    "await_inspection": ["inspection"],
    "await_approval": ["c90"],
}
# Purchase hand-off: process (technical services) opens the request, warehouse issues the indent,
# procurement uploads the purchase documents, process confirms, then inspection confirms (two separate steps), C-90 registers the pieces.
PURCHASE_STAGES: dict[str, list[str]] = {
    "await_indent": ["warehouse"],
    "await_order": ["procurement"],
    "await_confirm": ["process"],
    "await_confirm_insp": ["inspection"],
    "await_registration": ["c90"],
}
CELL_STAGES: dict[str, list[str]] = {
    "await_shutdown": ["operation"],
    "await_shop": ["cellshop"],
    "in_shop": ["cellshop"],
    "await_disassembly": ["c90"],
    "await_reinstall": ["c90"],
    "await_numbering": ["c90"],
}
INSPECTION_STAGES: dict[str, list[str]] = {
    "await_request": ["c90"],
    "await_inspection": ["inspection", "process"],
}
ASSEMBLE_STAGES: dict[str, list[str]] = {
    "await_assembly": ["c90"],
    "await_air": ["c90"],
    "await_insp_sign": ["inspection"],
    "await_proc_sign": ["process"],
    "await_position": ["c90"],
    "await_disassembly": ["c90"],  # a failed test sends the new element back to C-90 to be taken apart
}
WORKORDER_STAGES: dict[str, list[str]] = {
    "open": ["planner"],
}
STAGES = {
    "coating": COATING_STAGES,
    "purchase": PURCHASE_STAGES,
    "cell": CELL_STAGES,
    "inspection": INSPECTION_STAGES,
    "assemble": ASSEMBLE_STAGES,
    "workorder": WORKORDER_STAGES,
}
INSPECTION_VIEW_KEYS = VIEW_KEYS + CELL_VIEW_KEYS + ("inspections", "wf_process", "wf_planner")
# Allowed time per stage in hours (editable in Settings -> Workflow deadlines). A stage that has its own
# promised date (coater return, supplier delivery) is due on that date instead.
DEFAULT_SLA: dict[str, dict[str, int]] = {
    "coating": {"await_company": 72, "await_indent": 72, "await_dispatch": 120, "await_return": 720, "await_inspection": 72, "await_approval": 48},
    "purchase": {"await_indent": 72, "await_order": 120, "await_confirm": 72, "await_confirm_insp": 72, "await_registration": 72},
    "cell": {"await_shutdown": 48, "await_shop": 48, "in_shop": 120, "await_disassembly": 72, "await_reinstall": 120, "await_numbering": 72},
    "inspection": {"await_request": 24, "await_inspection": 72},
    "assemble": {"await_assembly": 72, "await_air": 72, "await_insp_sign": 72, "await_proc_sign": 72, "await_position": 120, "await_disassembly": 72},
    "workorder": {"open": 120},
}
DEFAULT_WARN_PERCENT = 25
CELL_DECISIONS = ("keep", "disassemble", "relocated")
AUTO_REQUEST_DAYS = 30  # a decommission typed into Assembly Data opens a request only when it is this recent
CLOSED = ("completed", "cancelled")
DELAY_PARTIES = ("employer", "company", "transport", "other")
MAX_PALLET = 20


# ------------------------------------------------------------------ helpers


def _now() -> datetime:
    return datetime.now()


def _iso(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat(timespec="seconds") if isinstance(value, datetime) else value.isoformat()


def _display(user: models.User) -> str:
    return (user.full_name or "").strip() or user.username


def _groups(db: Session, user: models.User, level: str = "edit") -> set[str]:
    if user.role == "admin":
        return set(GROUP_KEYS)
    perms = user_permission_map(db, user)
    need = LEVEL_RANK[level]
    return {g for g, key in GROUP_KEYS.items() if LEVEL_RANK.get(perms.get(key, "none"), 0) >= need}


def _can_view(db: Session, user: models.User, keys: tuple[str, ...] = VIEW_KEYS) -> bool:
    if user.role == "admin":
        return True
    perms = user_permission_map(db, user)
    return any(LEVEL_RANK.get(perms.get(k, "none"), 0) >= 1 for k in keys)


def _can_view_any(db: Session, user: models.User) -> bool:
    return _can_view(db, user, INSPECTION_VIEW_KEYS)


def _require_view(db: Session, user: models.User, keys: tuple[str, ...] = VIEW_KEYS) -> None:
    if not _can_view(db, user, keys):
        raise HTTPException(403, "You do not have access to the workflows")


def _require_group(db: Session, user: models.User, *groups: str) -> None:
    if not _groups(db, user) & set(groups):
        raise HTTPException(403, "This step belongs to another group")


def _require_stage(db: Session, user: models.User, flow: str, status: str, expected: tuple[str, ...]) -> None:
    if status not in expected:
        raise HTTPException(409, f"Not possible while the record is '{status}'")
    _require_group(db, user, *STAGES[flow].get(status, []))


def _members(db: Session, groups: list[str]) -> set[int]:
    keys = {GROUP_KEYS[g] for g in groups}
    found: set[int] = set()
    users = db.query(models.User).filter(models.User.is_active.is_(True), models.User.role != "admin").all()
    for u in users:
        perms = user_permission_map(db, u)
        if any(perms.get(k) == "edit" for k in keys):
            found.add(u.id)
    return found


def _title(flow: str, record: Any, db: Session) -> str:
    if flow == "purchase":
        return record.code
    if flow == "cell":
        cell = f" ({record.electrolyzer}-{record.position})" if record.electrolyzer else ""
        kind = "Numbering · " if getattr(record, "request_kind", "removal") == "numbering" else ""
        return f"{kind}{'⚠ ' if record.urgent else ''}{record.element_nr}{cell}"
    if flow == "inspection":
        return f"{record.code} · {record.element_nr or record.anode_nr or record.cathode_nr or ''}".strip(" ·")
    if flow == "assemble":
        return f"{record.code} · {record.element_nr or record.anode_nr or ''}".strip(" ·")
    if flow == "workorder":
        return f"{record.code} · {record.element_nr}"
    codes = [p.code for p in db.query(WfCoatingPackage).filter_by(batch_id=record.id).order_by(WfCoatingPackage.seq)]
    if not codes:
        return f"#{record.id}"
    return codes[0] if len(codes) == 1 else f"{codes[0]} … {codes[-1]}"


def _notify(db: Session, flow: str, record: Any, actor: models.User, extra_user_ids: set[int] | None = None) -> None:
    targets = set(extra_user_ids or set())
    groups = STAGES[flow].get(record.status)
    if groups:
        targets |= _members(db, groups)
    targets.discard(actor.id)
    title = _title(flow, record, db)
    for uid in targets:
        db.add(
            WfNotification(
                user_id=uid,
                flow=flow,
                record_id=record.id,
                status=record.status,
                title=title,
                from_name=_display(actor),
                created_at=_now(),
            )
        )


def _event(db: Session, flow: str, record: Any, action: str, actor: models.User, from_status: str | None, note: str | None = None, data: dict | None = None) -> None:
    db.add(
        WfEvent(
            flow=flow,
            record_id=record.id,
            action=action,
            from_status=from_status,
            to_status=record.status,
            actor_id=actor.id,
            actor_name=_display(actor),
            note=(note or "").strip() or None,
            data=data or None,
            created_at=_now(),
        )
    )
    record.updated_at = _now()
    if note and note.strip():
        record.last_note = note.strip()
    svc.clear_cache()


def _move(db: Session, flow: str, record: Any, to_status: str, action: str, actor: models.User, note: str | None = None, data: dict | None = None, notify_creator: bool = False) -> None:
    before = record.status
    record.status = to_status
    if to_status in CLOSED:
        record.completed_at = _now()
    _event(db, flow, record, action, actor, before, note, data)
    extra = {record.created_by_id} if notify_creator and record.created_by_id else set()
    _notify(db, flow, record, actor, extra)


def _company(db: Session, company_id: int | None) -> models.WhCompany | None:
    return db.get(models.WhCompany, company_id) if company_id else None


def _delay(expected: date | None, actual: date) -> int | None:
    return (actual - expected).days if expected else None


def _check_delay(days: int | None, party: str | None, reason: str | None) -> None:
    if days is not None and days > 0:
        if party not in DELAY_PARTIES or not (reason or "").strip():
            raise HTTPException(400, "Delivery is late: the responsible side and the reason are required")


def _folder(flow: str, record_id: int) -> Path:
    path = data_root() / "workflow" / flow / str(record_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _save_upload(db: Session, flow: str, record_id: int, upload: UploadFile, kind: str, user: models.User, package_id: int | None = None) -> tuple[WfFile, bytes]:
    original = _safe_name(upload.filename)
    ext = Path(original).suffix.lower()
    if ext in BLOCKED_EXT:
        raise HTTPException(400, f"Files of type {ext} are not allowed")
    content = upload.file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise HTTPException(400, f"{original} is larger than {MAX_BYTES // (1024 * 1024)} MB")
    stored = f"{uuid.uuid4().hex}{ext[:12]}"
    (_folder(flow, record_id) / stored).write_bytes(content)
    row = WfFile(
        flow=flow,
        record_id=record_id,
        package_id=package_id,
        kind=kind,
        original_name=original,
        stored_name=stored,
        content_type=INLINE_TYPES.get(ext) or "application/octet-stream",
        size_bytes=len(content),
        uploaded_by_name=_display(user),
        uploaded_at=_now(),
    )
    db.add(row)
    return row, content


def _files(db: Session, flow: str, record_id: int) -> list[dict]:
    rows = db.query(WfFile).filter_by(flow=flow, record_id=record_id).order_by(WfFile.uploaded_at).all()
    return [
        {
            "id": f.id,
            "name": f.original_name,
            "kind": f.kind,
            "package_id": f.package_id,
            "size": f.size_bytes,
            "uploaded_by": f.uploaded_by_name,
            "uploaded_at": _iso(f.uploaded_at),
        }
        for f in rows
    ]


def _events(db: Session, flow: str, record_id: int) -> list[dict]:
    rows = db.query(WfEvent).filter_by(flow=flow, record_id=record_id).order_by(WfEvent.created_at, WfEvent.id).all()
    return [
        {
            "id": e.id,
            "action": e.action,
            "from_status": e.from_status,
            "to_status": e.to_status,
            "actor": e.actor_name,
            "note": e.note,
            "data": e.data or {},
            "created_at": _iso(e.created_at),
        }
        for e in rows
    ]


class NoteIn(BaseModel):
    note: str | None = None


# ------------------------------------------------------------------ deadlines


def _settings_row(db: Session) -> WfSettings:
    row = db.get(WfSettings, 1)
    if row is None:
        row = WfSettings(id=1, sla_hours={}, warn_percent=DEFAULT_WARN_PERCENT)
        db.add(row)
        db.flush()
    return row


def sla_config(db: Session) -> dict:
    row = db.get(WfSettings, 1)
    saved = (row.sla_hours or {}) if row else {}
    hours = {
        flow: {status: int(saved.get(flow, {}).get(status, default)) for status, default in stages.items()}
        for flow, stages in DEFAULT_SLA.items()
    }
    warn = row.warn_percent if row and row.warn_percent is not None else DEFAULT_WARN_PERCENT
    return {"hours": hours, "warn_percent": warn}


def _stage_since(db: Session, flow: str, record: Any) -> datetime:
    ev = (
        db.query(WfEvent.created_at)
        .filter(WfEvent.flow == flow, WfEvent.record_id == record.id, WfEvent.to_status == record.status)
        .order_by(WfEvent.created_at.desc(), WfEvent.id.desc())
        .first()
    )
    return ev[0] if ev else record.created_at


def _promised(flow: str, record: Any) -> date | None:
    if flow == "coating" and record.status == "await_return":
        return record.expected_return_date
    if flow == "purchase" and record.status == "await_order" and record.expected_delivery_date and record.request_date:
        return None
    return None


def _sla_fields(db: Session, flow: str, record: Any, conf: dict | None = None) -> dict:
    """since / due_at / sla_state (ok | warn | late) of the stage the record waits in."""
    empty = {"stage_since": None, "due_at": None, "sla_hours": None, "sla_state": None, "sla_left_minutes": None}
    if record.status in CLOSED:
        return empty
    conf = conf or sla_config(db)
    hours = conf["hours"].get(flow, {}).get(record.status)
    if hours is None:
        return empty
    warn = conf["warn_percent"]
    since = _stage_since(db, flow, record) or _now()
    promised = _promised(flow, record)
    due = datetime.combine(promised, datetime.max.time().replace(microsecond=0)) if promised else since + timedelta(hours=hours)
    window = max((due - since).total_seconds(), 1)
    left = (due - _now()).total_seconds()
    state = "late" if left < 0 else "warn" if left < window * warn / 100 else "ok"
    return {"stage_since": _iso(since), "due_at": _iso(due), "sla_hours": hours, "sla_state": state, "sla_left_minutes": int(left // 60)}


# ------------------------------------------------------------------ cartable / notifications


def _coating_summary(db: Session, b: WfCoatingBatch, conf: dict | None = None) -> dict:
    co = _company(db, b.company_id)
    packages = db.query(WfCoatingPackage).filter_by(batch_id=b.id).order_by(WfCoatingPackage.seq).all()
    return {
        "flow": "coating",
        "id": b.id,
        "title": _title("coating", b, db),
        "codes": [p.code for p in packages],
        "status": b.status,
        "groups": COATING_STAGES.get(b.status, []),
        "anode_count": b.anode_count,
        "cathode_count": b.cathode_count,
        "company_id": b.company_id,
        "company_name": co.name if co else None,
        "indent_no": b.indent_no,
        "dispatch_date": _iso(b.dispatch_date),
        "expected_date": _iso(b.expected_return_date),
        "actual_date": _iso(b.return_date),
        "delay_days": b.delay_days,
        "rejected": b.rejected,
        "rework_count": b.rework_count,
        "warranty_months": b.warranty_months,
        "warranty_start": _iso(b.warranty_start),
        "created_by": b.created_by_name,
        "created_at": _iso(b.created_at),
        "updated_at": _iso(b.updated_at),
        "last_note": b.last_note,
        **_sla_fields(db, "coating", b, conf),
    }


def _purchase_summary(db: Session, p: WfPurchase, conf: dict | None = None) -> dict:
    co = _company(db, p.supplier_id)
    registered = db.query(func.count(WfPurchaseItem.id)).filter_by(purchase_id=p.id).scalar() or 0
    return {
        "flow": "purchase",
        "id": p.id,
        "title": p.code,
        "code": p.code,
        "codes": [p.code],
        "status": p.status,
        "groups": PURCHASE_STAGES.get(p.status, []),
        "anode_count": p.anode_count,
        "cathode_count": p.cathode_count,
        "company_id": p.supplier_id,
        "company_name": co.name if co else None,
        "indent_no": p.indent_no,
        "approval_ref": p.approval_ref,
        "dispatch_date": _iso(p.request_date),
        "expected_date": _iso(p.expected_delivery_date),
        "actual_date": _iso(p.delivery_date),
        "delay_days": p.delay_days,
        "registered": registered,
        "warranty_months": p.warranty_months,
        "warranty_start": _iso(p.warranty_start),
        "decisions": p.decisions or {},
        "created_by": p.created_by_name,
        "created_at": _iso(p.created_at),
        "updated_at": _iso(p.updated_at),
        "last_note": p.last_note,
        **_sla_fields(db, "purchase", p, conf),
    }


@router.get("/meta")
def meta(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return {
        "can_view": _can_view(db, user),
        "can_view_cell": _can_view(db, user, CELL_VIEW_KEYS),
        "can_request_cell": _can_request_cell(db, user),
        "groups": sorted(_groups(db, user)),
        "view_groups": sorted(_groups(db, user, "view")),
        "coating_stages": COATING_STAGES,
        "purchase_stages": PURCHASE_STAGES,
        "cell_stages": CELL_STAGES,
        "inspection_stages": INSPECTION_STAGES,
        "assemble_stages": ASSEMBLE_STAGES,
        "can_view_inspection": _can_view(db, user, INSPECTION_VIEW_KEYS),
        "can_request_inspection": _can_request_inspection(db, user),
        "can_request_assemble": _can_request_assemble(db, user),
        "delay_parties": list(DELAY_PARTIES),
        "sla": sla_config(db),
    }


class SlaIn(BaseModel):
    hours: dict[str, dict[str, int]]
    warn_percent: int = Field(ge=1, le=90)


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return {**sla_config(db), "defaults": DEFAULT_SLA}


@router.put("/settings")
def put_settings(body: SlaIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if user.role != "admin" and user_permission_map(db, user).get("settings") != "edit":
        raise HTTPException(403, "Only administrators can change the workflow deadlines")
    clean: dict[str, dict[str, int]] = {}
    for flow, stages in DEFAULT_SLA.items():
        for status in stages:
            value = body.hours.get(flow, {}).get(status)
            if value is None:
                continue
            if not 1 <= int(value) <= 24 * 365:
                raise HTTPException(400, f"{flow} / {status}: hours must be between 1 and 8760")
            clean.setdefault(flow, {})[status] = int(value)
    row = _settings_row(db)
    row.sla_hours = clean
    row.warn_percent = body.warn_percent
    row.updated_by = _display(user)
    row.updated_at = _now()
    db.commit()
    return {**sla_config(db), "defaults": DEFAULT_SLA}


def _resume_parked_cell_requests(db: Session) -> None:
    """A dismantle or a keep that was closed too early still has work: put it back in the cartable."""
    rows = (
        db.query(WfCellRequest)
        .filter(WfCellRequest.status == "completed", WfCellRequest.decision.in_(("disassemble", "keep")))
        .all()
    )
    if not rows:
        return
    pipeline = {item["key"]: item for item in svc.build_pipeline(db)}
    changed = False
    for r in rows:
        item = pipeline.get(compact_nr(r.element_nr))
        if item is None:
            continue
        if r.decision == "disassemble" and item["state"] == "awaiting_disassembly":
            r.status = "await_disassembly"
            r.completed_at = None
            r.updated_at = _now()
            changed = True
        elif r.decision == "keep" and item["state"] == "ready" and item["base_state"] == "decommissioned":
            r.status = "await_reinstall"
            r.completed_at = None
            r.updated_at = _now()
            changed = True
    if changed:
        db.commit()
        svc.clear_cache()


def _cartable(db: Session, user: models.User) -> list[dict]:
    _resume_parked_cell_requests(db)
    groups = _groups(db, user, "view")
    if not groups:
        return []
    out: list[dict] = []
    conf = sla_config(db)
    c_status = [s for s, g in COATING_STAGES.items() if groups & set(g)]
    p_status = [s for s, g in PURCHASE_STAGES.items() if groups & set(g)]
    if c_status:
        for b in db.query(WfCoatingBatch).filter(WfCoatingBatch.status.in_(c_status)).order_by(WfCoatingBatch.updated_at).all():
            out.append(_coating_summary(db, b, conf))
    if p_status:
        for p in db.query(WfPurchase).filter(WfPurchase.status.in_(p_status)).order_by(WfPurchase.updated_at).all():
            out.append(_purchase_summary(db, p, conf))
    r_status = [s for s, g in CELL_STAGES.items() if groups & set(g)]
    if r_status:
        for r in db.query(WfCellRequest).filter(WfCellRequest.status.in_(r_status)).order_by(WfCellRequest.updated_at).all():
            out.append(_cell_summary(db, r, conf))
    i_status = [s for s, g in INSPECTION_STAGES.items() if groups & set(g)]
    if i_status:
        for r in db.query(WfInspectionRequest).filter(WfInspectionRequest.status.in_(i_status)).order_by(WfInspectionRequest.updated_at).all():
            out.append(_insp_summary(db, r, conf))
    a_status = [s for s, g in ASSEMBLE_STAGES.items() if groups & set(g)]
    if a_status:
        for r in db.query(WfAssembleRequest).filter(WfAssembleRequest.status.in_(a_status)).order_by(WfAssembleRequest.updated_at).all():
            out.append(_assemble_summary(db, r, conf))
    if "planner" in groups:
        from .work_orders import _summary as _wo_summary

        for wo in db.query(WfWorkOrder).filter(WfWorkOrder.status == "open").order_by(WfWorkOrder.updated_at).all():
            out.append(_wo_summary(wo))
    # most urgent first: late, then the nearest deadline
    out.sort(key=lambda r: (r["due_at"] is None, r["due_at"] or "", r["updated_at"] or ""))
    return out


@router.get("/cartable")
def cartable(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _cartable(db, user)


def _element_brief(el: models.Element) -> dict:
    return {
        "id": el.id,
        "element_nr": el.element_nr,
        "electrolyzer": el.electrolyzer,
        "position": el.position,
        "anode_nr": el.anode_nr,
        "cathode_nr": el.cathode_nr,
        "membrane_nr": el.membrane_nr,
        "assembly_date": _iso(el.assembly_date),
        "disassembly_date": _iso(el.disassembly_date),
        "decommissioning_date": _iso(el.decommissioning_date),
    }


def _recent_by_date(db: Session, field: str, limit: int = 8) -> list[dict]:
    col = getattr(models.Element, field)
    rows = (
        db.query(models.Element)
        .filter(col.isnot(None))
        .order_by(col.desc(), models.Element.id.desc())
        .limit(limit)
        .all()
    )
    return [_element_brief(el) for el in rows]


def _items_for_group(items: list[dict], group: str) -> list[dict]:
    return [row for row in items if group in (row.get("groups") or [])]


@router.get("/cartable/desk")
def cartable_desk(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Role-specialized cartable home: same waiting list, split and enriched per workflow group."""
    if not _can_view_any(db, user):
        raise HTTPException(403, "No workflow access")
    edit_groups = sorted(_groups(db, user, "edit"))
    view_groups = sorted(_groups(db, user, "view"))
    # Prefer actor groups for desk tabs; fall back to view-only groups (e.g. plant management).
    desk_groups = edit_groups or view_groups
    waiting = _cartable(db, user)
    by_group: dict[str, dict] = {}
    for g in desk_groups:
        rows = _items_for_group(waiting, g)
        by_group[g] = {
            "waiting": len(rows),
            "late": sum(1 for r in rows if r.get("sla_state") == "late"),
            "items": rows,
        }

    snapshots: dict[str, Any] = {}
    need_pool = bool({"c90", "cellshop"} & set(desk_groups))
    pool_snap = None
    if need_pool:
        pool = assembly_pool(db)
        pool_snap = {
            "reusable": len(pool.get("reusable") or []),
            "purchased": len(pool.get("purchased") or []),
            "recoated": len(pool.get("recoated") or []),
            "reusable_preview": (pool.get("reusable") or [])[:6],
            "purchased_preview": (pool.get("purchased") or [])[:4],
            "recoated_preview": (pool.get("recoated") or [])[:4],
        }

    if "c90" in desk_groups:
        snapshots["c90"] = {
            "pool": pool_snap,
            "recent_assemblies": _recent_by_date(db, "assembly_date"),
            "recent_disassemblies": _recent_by_date(db, "disassembly_date"),
            "await_disassembly": sum(1 for r in waiting if r.get("flow") == "cell" and r.get("status") == "await_disassembly"),
            "await_reinstall": sum(1 for r in waiting if r.get("flow") == "cell" and r.get("status") == "await_reinstall"),
            "await_numbering": sum(1 for r in waiting if r.get("flow") == "cell" and r.get("status") == "await_numbering"),
            "await_inspection_request": sum(1 for r in waiting if r.get("flow") == "inspection" and r.get("status") == "await_request"),
            "coating_approval": sum(1 for r in waiting if r.get("flow") == "coating" and r.get("status") == "await_approval"),
            "purchase_registration": sum(1 for r in waiting if r.get("flow") == "purchase" and r.get("status") == "await_registration"),
            "await_assembly": sum(1 for r in waiting if r.get("flow") == "assemble" and r.get("status") == "await_assembly"),
            "await_air": sum(1 for r in waiting if r.get("flow") == "assemble" and r.get("status") == "await_air"),
            "await_position": sum(1 for r in waiting if r.get("flow") == "assemble" and r.get("status") == "await_position"),
        }
    if "cellshop" in desk_groups:
        snapshots["cellshop"] = {
            "pool": pool_snap,
            "await_shop": sum(1 for r in waiting if r.get("flow") == "cell" and r.get("status") == "await_shop"),
            "in_shop": sum(1 for r in waiting if r.get("flow") == "cell" and r.get("status") == "in_shop"),
            "recent_assemblies": _recent_by_date(db, "assembly_date", 5),
        }
    if "inspection" in desk_groups:
        snapshots["inspection"] = {
            "await_inspection": sum(
                1
                for r in waiting
                if (
                    (r.get("status") == "await_inspection" and "inspection" in (r.get("groups") or []))
                    or (r.get("flow") == "assemble" and r.get("status") == "await_insp_sign")
                )
            ),
            "coating_inspection": sum(1 for r in waiting if r.get("flow") == "coating" and r.get("status") == "await_inspection"),
            "element_inspection": sum(1 for r in waiting if r.get("flow") == "inspection" and r.get("status") == "await_inspection"),
            "purchase_confirm": sum(1 for r in waiting if r.get("flow") == "purchase" and r.get("status") == "await_confirm_insp"),
        }
    if "process" in desk_groups:
        snapshots["process"] = {
            "await_inspection": sum(
                1
                for r in waiting
                if (
                    (r.get("status") == "await_inspection" and "process" in (r.get("groups") or []))
                    or (r.get("flow") == "assemble" and r.get("status") == "await_proc_sign")
                )
            ),
            "element_inspection": sum(1 for r in waiting if r.get("flow") == "inspection" and r.get("status") == "await_inspection"),
            "coating_inspection": sum(1 for r in waiting if r.get("flow") == "coating" and r.get("status") == "await_inspection"),
            "purchase_confirm": sum(1 for r in waiting if r.get("flow") == "purchase" and r.get("status") == "await_confirm"),
        }
    if "operation" in desk_groups:
        snapshots["operation"] = {
            "await_shutdown": sum(1 for r in waiting if r.get("flow") == "cell" and r.get("status") == "await_shutdown"),
        }
    if "procurement" in desk_groups:
        snapshots["procurement"] = {
            "await_company": sum(1 for r in waiting if r.get("flow") == "coating" and r.get("status") == "await_company"),
            "await_dispatch": sum(1 for r in waiting if r.get("flow") == "coating" and r.get("status") == "await_dispatch"),
            "await_return": sum(1 for r in waiting if r.get("flow") == "coating" and r.get("status") == "await_return"),
            "await_order": sum(1 for r in waiting if r.get("flow") == "purchase" and r.get("status") == "await_order"),
            "await_confirm": sum(1 for r in waiting if r.get("flow") == "purchase" and r.get("status") in ("await_confirm", "await_confirm_insp")),
        }
    if "warehouse" in desk_groups:
        snapshots["warehouse"] = {
            "await_indent": sum(1 for r in waiting if r.get("status") == "await_indent"),
        }
    if "planner" in desk_groups:
        snapshots["planner"] = {
            "open_work_orders": sum(1 for r in waiting if r.get("flow") == "workorder"),
        }

    return {
        "groups": desk_groups,
        "edit_groups": edit_groups,
        "view_groups": view_groups,
        "waiting_total": len(waiting),
        "late_total": sum(1 for r in waiting if r.get("sla_state") == "late"),
        "waiting": waiting,
        "by_group": by_group,
        "snapshots": snapshots,
    }


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Bell data: items waiting for my groups and unread notices (cheap enough to poll)."""
    if not _can_view_any(db, user):
        return {"cartable": 0, "late": 0, "unread": 0, "items": []}
    unread = (
        db.query(WfNotification)
        .filter(WfNotification.user_id == user.id, WfNotification.read_at.is_(None))
        .order_by(WfNotification.created_at.desc())
        .limit(10)
        .all()
    )
    total_unread = (
        db.query(func.count(WfNotification.id))
        .filter(WfNotification.user_id == user.id, WfNotification.read_at.is_(None))
        .scalar()
        or 0
    )
    waiting = _cartable(db, user)
    return {
        "cartable": len(waiting),
        "late": sum(1 for r in waiting if r["sla_state"] == "late"),
        "unread": total_unread,
        "items": [_notice(n) for n in unread],
    }


def _notice(n: WfNotification) -> dict:
    return {
        "id": n.id,
        "flow": n.flow,
        "record_id": n.record_id,
        "status": n.status,
        "title": n.title,
        "from_name": n.from_name,
        "created_at": _iso(n.created_at),
        "read": n.read_at is not None,
    }


@router.get("/notifications")
def notifications(limit: int = Query(20, ge=1, le=200), db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    rows = (
        db.query(WfNotification)
        .filter(WfNotification.user_id == user.id)
        .order_by(WfNotification.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_notice(n) for n in rows]


class ReadIn(BaseModel):
    ids: list[int] | None = None
    flow: str | None = None
    record_id: int | None = None
    all: bool = False


@router.post("/notifications/read")
def notifications_read(body: ReadIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    q = db.query(WfNotification).filter(WfNotification.user_id == user.id, WfNotification.read_at.is_(None))
    if not body.all:
        if body.ids:
            q = q.filter(WfNotification.id.in_(body.ids))
        elif body.flow and body.record_id:
            q = q.filter(WfNotification.flow == body.flow, WfNotification.record_id == body.record_id)
        else:
            return {"marked": 0}
    n = q.update({WfNotification.read_at: _now()}, synchronize_session=False)
    db.commit()
    return {"marked": n}


# ------------------------------------------------------------------ recoating workflow


class CoatingLineIn(BaseModel):
    serial: str
    problem: str | None = None


class CoatingCreateIn(BaseModel):
    anodes: list[CoatingLineIn] = []
    cathodes: list[CoatingLineIn] = []
    pallet_size: int = Field(20, ge=1, le=MAX_PALLET)
    separate_kinds: bool = True
    remarks: str | None = None


def _next_seq(db: Session, column) -> int:
    return int(db.query(func.max(column)).scalar() or 0) + 1


def _code(prefix: str, day: date, seq: int) -> str:
    return f"{prefix}-{day:%Y%m%d}-{seq:04d}"


def _clean_lines(lines: list[CoatingLineIn], kind: str, index: dict[str, str], unknown: list[str]) -> list[dict]:
    out = []
    for line in lines:
        raw = (line.serial or "").strip()
        if not raw:
            continue
        key = compact_nr(raw)
        serial = index.get(key)
        if serial is None:
            unknown.append(raw)
            continue
        out.append({"kind": kind, "serial": serial, "key": key, "problem": (line.problem or "").strip()[:500] or None})
    return out


def _meaningful(text: str | None) -> str | None:
    t = (text or "").strip()
    return t[:500] if any(ch.isalpha() for ch in t) else None


def segregation_problems(db: Session, wanted: set[tuple[str, str]]) -> dict[tuple[str, str], str]:
    """(kind, compact serial) -> problem text from the latest segregation record,
    falling back to the newest decommission reason of an element that used the electrode."""
    if not wanted:
        return {}
    out: dict[tuple[str, str], str] = {}
    S = models.ElectrodeSegregation
    segs = (
        db.query(S.serial_nr, S.electrode_kind, S.problems)
        .filter(S.problems.isnot(None), S.problems != "")
        .order_by(func.coalesce(S.inspection_date, S.disassemble_date, S.decommission_date), S.id)
        .all()
    )
    for serial, kind, text in segs:
        k = ((kind or "").lower(), compact_nr(serial))
        p = _meaningful(text)
        if k in wanted and p:
            out[k] = p
    missing = wanted - out.keys()
    if missing:
        E = models.Element
        rows = (
            db.query(E.anode_nr, E.cathode_nr, E.decommission_reason)
            .filter(E.decommission_reason.isnot(None), E.decommission_reason != "")
            .order_by(func.coalesce(E.decommissioning_date, E.disassembly_date, E.assembly_date), E.id)
            .all()
        )
        fallback: dict[tuple[str, str], str] = {}
        for anode, cathode, text in rows:
            p = _meaningful(text)
            if not p:
                continue
            for kind, serial in (("anode", anode), ("cathode", cathode)):
                k = (kind, compact_nr(serial or ""))
                if k in missing:
                    fallback[k] = p
        out.update(fallback)
    return out


def _fill_problems(db: Session, items: list) -> None:
    """Fill empty item problems from segregation (in memory; persisted only if the caller commits)."""
    empty = [i for i in items if not (i.problem or "").strip()]
    if not empty:
        return
    found = segregation_problems(db, {(i.element_kind, compact_nr(i.serial)) for i in empty})
    for i in empty:
        p = found.get((i.element_kind, compact_nr(i.serial)))
        if p:
            i.problem = p


@router.get("/coating-candidates")
def coating_candidates(db: Session = Depends(get_db)):
    """Every anode / cathode of the TAFKIK segregation form (latest record per serial) for the C-90 picker."""
    S = models.ElectrodeSegregation
    rows = (
        db.query(S)
        .filter(S.serial_nr.isnot(None), S.serial_nr != "", S.electrode_kind.in_(("anode", "cathode")))
        .order_by(func.coalesce(S.inspection_date, S.disassemble_date, S.decommission_date), S.id)
        .all()
    )
    busy = {
        (k, compact_nr(s))
        for s, k in db.query(WfCoatingItem.serial, WfCoatingItem.element_kind)
        .join(WfCoatingBatch, WfCoatingBatch.id == WfCoatingItem.batch_id)
        .filter(WfCoatingBatch.status.notin_(CLOSED))
        .all()
    }
    latest: dict[tuple[str, str], Any] = {}
    for r in rows:
        latest[(r.electrode_kind, compact_nr(r.serial_nr))] = r
    out = []
    for (kind, key), r in latest.items():
        out.append(
            {
                "serial": r.serial_nr.strip(),
                "kind": kind,
                "decision": r.decision,
                "problem": _meaningful(r.problems),
                "outcome": classify_row(r)["outcome"],
                "pallet": r.pallet,
                "date": (r.inspection_date or r.disassemble_date or r.decommission_date),
                "busy": (kind, key) in busy,
            }
        )
    out.sort(key=lambda x: x["serial"])
    return out


@router.post("/coating")
def create_coating(body: CoatingCreateIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_group(db, user, "c90")
    unknown: list[str] = []
    anodes = _clean_lines(body.anodes, "anode", load_compact_index(db, models.Anode, "anode_nr"), unknown)
    cathodes = _clean_lines(body.cathodes, "cathode", load_compact_index(db, models.Cathode, "cathode_nr"), unknown)
    lines = anodes + cathodes
    if not lines:
        raise HTTPException(400, "Enter at least one anode or cathode number")
    if unknown:
        raise HTTPException(422, {"code": "unknown_serials", "serials": unknown[:50]})
    seen: set[tuple[str, str]] = set()
    dup = []
    for ln in lines:
        k = (ln["kind"], ln["key"])
        if k in seen:
            dup.append(ln["serial"])
        seen.add(k)
    if dup:
        raise HTTPException(400, f"Entered twice: {', '.join(dup[:20])}")
    busy = (
        db.query(WfCoatingItem.serial, WfCoatingItem.element_kind)
        .join(WfCoatingBatch, WfCoatingBatch.id == WfCoatingItem.batch_id)
        .filter(WfCoatingBatch.status.notin_(CLOSED))
        .all()
    )
    busy_keys = {(k, compact_nr(s)) for s, k in busy}
    clash = [ln["serial"] for ln in lines if (ln["kind"], ln["key"]) in busy_keys]
    if clash:
        raise HTTPException(409, f"Already in an open recoating request: {', '.join(clash[:20])}")
    found = segregation_problems(db, {(ln["kind"], ln["key"]) for ln in lines})
    for ln in lines:
        ln["problem"] = found.get((ln["kind"], ln["key"])) or ln["problem"]

    origin_states = [snapshot_wh(db, ln["kind"], ln["serial"]) for ln in lines]
    today = date.today()
    batch = WfCoatingBatch(
        status="await_indent",
        anode_count=len(anodes),
        cathode_count=len(cathodes),
        pallet_size=body.pallet_size,
        remarks=(body.remarks or "").strip() or None,
        created_by_id=user.id,
        created_by_name=_display(user),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(batch)
    db.flush()
    groups = [anodes, cathodes] if body.separate_kinds else [lines]
    pallets: list[list[dict]] = []
    for group in groups:
        for i in range(0, len(group), body.pallet_size):
            pallets.append(group[i : i + body.pallet_size])
    seq = _next_seq(db, WfCoatingPackage.seq)
    codes = []
    for n, chunk in enumerate(pallets, start=1):
        code = _code("CO", today, seq)
        pkg = WfCoatingPackage(batch_id=batch.id, code=code, seq=seq, pallet_no=n, created_at=_now())
        db.add(pkg)
        db.flush()
        codes.append(code)
        seq += 1
        for line_no, ln in enumerate(chunk, start=1):
            db.add(
                WfCoatingItem(
                    batch_id=batch.id,
                    package_id=pkg.id,
                    line_no=line_no,
                    element_kind=ln["kind"],
                    serial=ln["serial"],
                    problem=ln["problem"],
                )
            )
            upsert_state(db, ln["kind"], ln["serial"], lifecycle_status="ready_dispatch")
            log_event(db, ln["kind"], ln["serial"], "coating_request", today, f"Recoating request {code}", ref_kind="wf_coating", ref_id=batch.id, details={"code": code})
    remember(db, "coating", batch.id, {"wh_states": origin_states})
    _event(db, "coating", batch, "created", user, None, body.remarks, {"codes": codes})
    _notify(db, "coating", batch, user)
    db.commit()
    return _coating_detail(db, batch, user)


def coating_from_board(db: Session, kind: str, serial: str, user: models.User, note: str | None) -> dict:
    """Live board "Send to recoating": the piece joins the open request that still waits for the
    warehouse indent, otherwise a new request is opened."""
    model, field = (models.Anode, "anode_nr") if kind == "anode" else (models.Cathode, "cathode_nr")
    ensure_indexed(db, model, field, serial, None)
    stored = load_compact_index(db, model, field).get(compact_nr(serial)) or serial.strip()[:50]
    problem = segregation_problems(db, {(kind, compact_nr(stored))}).get((kind, compact_nr(stored))) or note
    today = date.today()
    b = (
        db.query(WfCoatingBatch)
        .filter(WfCoatingBatch.status == "await_indent")
        .order_by(WfCoatingBatch.created_at.desc())
        .first()
    )
    created = b is None
    if created:
        b = WfCoatingBatch(
            status="await_indent",
            pallet_size=20,
            remarks="Live board",
            created_by_id=user.id,
            created_by_name=_display(user),
            created_at=_now(),
            updated_at=_now(),
        )
        db.add(b)
        db.flush()
    pkg = db.query(WfCoatingPackage).filter_by(batch_id=b.id).order_by(WfCoatingPackage.seq.desc()).first()
    lines = db.query(WfCoatingItem).filter_by(package_id=pkg.id).all() if pkg else []
    if pkg is None or len(lines) >= (b.pallet_size or 20) or any(i.element_kind != kind for i in lines):
        seq = _next_seq(db, WfCoatingPackage.seq)
        pallet_no = (db.query(func.count(WfCoatingPackage.id)).filter_by(batch_id=b.id).scalar() or 0) + 1
        pkg = WfCoatingPackage(batch_id=b.id, code=_code("CO", today, seq), seq=seq, pallet_no=pallet_no, created_at=_now())
        db.add(pkg)
        db.flush()
        lines = []
    db.add(
        WfCoatingItem(
            batch_id=b.id,
            package_id=pkg.id,
            line_no=len(lines) + 1,
            element_kind=kind,
            serial=stored,
            problem=(problem or "").strip()[:500] or None,
        )
    )
    if kind == "anode":
        b.anode_count = (b.anode_count or 0) + 1
    else:
        b.cathode_count = (b.cathode_count or 0) + 1
    remember(db, "coating", b.id, {"wh_states": [snapshot_wh(db, kind, stored)]})
    upsert_state(db, kind, stored, lifecycle_status="ready_dispatch")
    log_event(db, kind, stored, "coating_request", today, f"Recoating request {pkg.code} (Live board)", ref_kind="wf_coating", ref_id=b.id, details={"code": pkg.code})
    _event(db, "coating", b, "created" if created else "board_add", user, None if created else b.status, note, {"codes": [pkg.code], "serial": stored, "kind": kind})
    _notify(db, "coating", b, user, {b.created_by_id} if b.created_by_id else None)
    db.commit()
    return {"wf_id": b.id, "wf_code": pkg.code, "wf_status": b.status, "added": not created}


def _can_manage(db: Session, user: models.User, flow: str, status: str) -> bool:
    """Admin, or a section supervisor who can edit the group that currently owns this step."""
    if status in CLOSED:
        return False
    if user.role == "admin":
        return True
    stage = set(STAGES.get(flow, {}).get(status, []))
    return bool(stage and _groups(db, user) & stage)


def _can_cancel(user: models.User, status: str, created_by_id: int | None, first_status: str, also: bool = False) -> bool:
    """The requester may drop a new request on its first step. An admin or the section supervisor may cancel any open step."""
    if status in CLOSED:
        return False
    if user.role == "admin":
        return True
    if status == first_status and created_by_id is not None and created_by_id == user.id:
        return True
    return also


def _admin_cancel_note(user: models.User, note: str | None, *, required: bool | None = None) -> None:
    must = user.role == "admin" if required is None else required
    if must and not (note or "").strip():
        raise HTTPException(400, "Write why this request is cancelled")


def _coating_actions(db: Session, b: WfCoatingBatch, user: models.User) -> list[str]:
    groups = _groups(db, user)
    stage = set(COATING_STAGES.get(b.status, []))
    acts: list[str] = []
    mine = bool(groups & stage)
    if b.status == "await_company" and mine:
        acts.append("company")
    if b.status == "await_indent" and mine:
        acts.append("indent")
    if b.status == "await_dispatch" and mine:
        acts.append("dispatch")
    if b.status == "await_return" and mine:
        acts += ["receive", "report", "submit", "rework"]
    if b.status == "await_inspection" and mine:
        acts += ["inspect_ok", "inspect_reject"]
    if b.status == "await_approval" and mine:
        acts.append("approve")
    early = b.status in ("await_company", "await_indent", "await_dispatch")
    if early and ("c90" in groups or user.role == "admin"):
        acts.append("request_inspections")
    managed = _can_manage(db, user, "coating", b.status)
    if _can_cancel(user, b.status, b.created_by_id, "await_company", also=(early and "c90" in groups) or managed):
        acts.append("cancel")
    if managed:
        acts.append("edit")
    if b.status not in CLOSED and groups:
        acts.append("attach")
    return acts


def _coating_detail(db: Session, b: WfCoatingBatch, user: models.User) -> dict:
    data = _coating_summary(db, b)
    packages = db.query(WfCoatingPackage).filter_by(batch_id=b.id).order_by(WfCoatingPackage.seq).all()
    items = db.query(WfCoatingItem).filter_by(batch_id=b.id).order_by(WfCoatingItem.package_id, WfCoatingItem.line_no).all()
    _fill_problems(db, items)
    files = _files(db, "coating", b.id)
    forms = coating_inspections(db, items)
    asked = _open_inspection_by_serial(db)
    data.update(
        {
            "inspections_done": sum(1 for i in items if forms.get(i.id)),
            "inspections_total": len(items),
            "pallet_size": b.pallet_size,
            "delay_party": b.delay_party,
            "delay_reason": b.delay_reason,
            "remarks": b.remarks,
            "completed_at": _iso(b.completed_at),
            "packages": [
                {
                    "id": p.id,
                    "code": p.code,
                    "pallet_no": p.pallet_no,
                    "dispatch_date": _iso(p.dispatch_date),
                    "expected_return_date": _iso(p.expected_return_date),
                    "has_report": any(f["kind"] == "report" and f["package_id"] == p.id for f in files),
                    "items": [
                        {
                            "id": i.id,
                            "line_no": i.line_no,
                            "element_kind": i.element_kind,
                            "serial": i.serial,
                            "problem": i.problem,
                            "pre_inspection": i.pre_inspection,
                            "final_report": i.final_report,
                            "remark": i.remark,
                            "inspection": forms.get(i.id),
                            "inspection_request": asked.get((i.element_kind, compact_nr(i.serial))),
                        }
                        for i in items
                        if i.package_id == p.id
                    ],
                }
                for p in packages
            ],
            "files": files,
            "events": _events(db, "coating", b.id),
            "actions": _coating_actions(db, b, user),
        }
    )
    return data


def _load_batch(db: Session, batch_id: int) -> WfCoatingBatch:
    b = db.get(WfCoatingBatch, batch_id)
    if not b:
        raise HTTPException(404, "Recoating request not found")
    return b


def _batch_items(db: Session, b: WfCoatingBatch) -> list[WfCoatingItem]:
    return db.query(WfCoatingItem).filter_by(batch_id=b.id).all()


@router.get("/coating")
def list_coating(
    status: str | None = None,
    open_only: bool = False,
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_view(db, user)
    query = db.query(WfCoatingBatch).order_by(WfCoatingBatch.created_at.desc())
    if status:
        query = query.filter(WfCoatingBatch.status == status)
    if open_only:
        query = query.filter(WfCoatingBatch.status.notin_(CLOSED))
    needle = (q or "").strip()
    if needle:
        # Match CO-* package code, indent, or any anode/cathode serial on the batch.
        like = f"%{needle}%"
        key = compact_nr(needle)
        item_clauses = [WfCoatingItem.serial.ilike(like)]
        if key and key != needle.lower().replace(" ", ""):
            item_clauses.append(WfCoatingItem.serial.ilike(f"%{key}%"))
        batch_ids = {r[0] for r in db.query(WfCoatingItem.batch_id).filter(or_(*item_clauses)).distinct().all()}
        pkg_ids = {r[0] for r in db.query(WfCoatingPackage.batch_id).filter(WfCoatingPackage.code.ilike(like)).distinct().all()}
        ids = batch_ids | pkg_ids
        clauses = [WfCoatingBatch.indent_no.ilike(like), WfCoatingBatch.remarks.ilike(like)]
        if ids:
            clauses.append(WfCoatingBatch.id.in_(ids))
        query = query.filter(or_(*clauses))
    return [_coating_summary(db, b) for b in query.limit(500).all()]


@router.get("/coating/{batch_id}")
def get_coating(batch_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user)
    return _coating_detail(db, _load_batch(db, batch_id), user)


class PackagePlanIn(BaseModel):
    package_id: int
    dispatch_date: date
    expected_return_date: date


class CompanyPickIn(NoteIn):
    company_id: int
    excel_emailed: bool = False
    packages: list[PackagePlanIn] = Field(default_factory=list)


@router.post("/coating/{batch_id}/company")
def coating_company(batch_id: int, body: CompanyPickIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Procurement: coating company, a send date and expected return for every code, and the Excel emailed."""
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_company",))
    co = _company(db, body.company_id)
    if not co or not co.is_coating:
        raise HTTPException(400, "Choose a coating company")
    if not body.excel_emailed:
        raise HTTPException(400, "Email the Excel report to the coating company before continuing")
    stored = db.query(WfCoatingPackage).filter_by(batch_id=b.id).all()
    if not stored:
        raise HTTPException(400, "There is no code on this request")
    plans = {p.package_id: p for p in body.packages}
    if {p.id for p in stored} != set(plans):
        raise HTTPException(400, "Enter the send date and the expected return date for every code")
    for pkg in stored:
        plan = plans[pkg.id]
        if plan.expected_return_date < plan.dispatch_date:
            raise HTTPException(400, f"Expected return of {pkg.code} is before its send date")
        pkg.dispatch_date = plan.dispatch_date
        pkg.expected_return_date = plan.expected_return_date
    b.company_id = co.id
    b.dispatch_date = min(p.dispatch_date for p in plans.values())
    b.expected_return_date = max(p.expected_return_date for p in plans.values())
    b.excel_emailed_at = _now()
    # Warehouse issues the indent first. If that is already done, procurement hands the batch to dispatch.
    next_status = "await_dispatch" if (b.indent_no or "").strip() else "await_indent"
    _move(
        db, "coating", b, next_status, "company", user, body.note,
        {
            "company": co.name,
            "excel_emailed": True,
            "codes": [
                {"code": pkg.code, "dispatch_date": plans[pkg.id].dispatch_date.isoformat(), "expected_return_date": plans[pkg.id].expected_return_date.isoformat()}
                for pkg in stored
            ],
        },
    )
    db.commit()
    return _coating_detail(db, b, user)


class IndentIn(NoteIn):
    indent_no: str


@router.post("/coating/{batch_id}/indent")
def coating_indent(batch_id: int, body: IndentIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_indent",))
    indent = body.indent_no.strip()[:60]
    if not indent:
        raise HTTPException(400, "Indent number required")
    b.indent_no = indent
    # Procurement chooses the company after the indent, unless this batch already has one.
    next_status = "await_dispatch" if b.company_id else "await_company"
    _move(db, "coating", b, next_status, "indent", user, body.note, {"indent_no": indent})
    db.commit()
    return _coating_detail(db, b, user)


class DispatchIn(NoteIn):
    dispatch_date: date | None = None
    expected_return_date: date | None = None


def _do_dispatch(db: Session, b: WfCoatingBatch, body: DispatchIn, user: models.User, action: str) -> None:
    dispatch_date = body.dispatch_date or b.dispatch_date
    expected = body.expected_return_date or b.expected_return_date
    if dispatch_date is None or expected is None:
        raise HTTPException(400, "Send date and expected return date are required")
    if expected < dispatch_date:
        raise HTTPException(400, "Expected return date is before the send date")
    co = _company(db, b.company_id)
    b.dispatch_date = dispatch_date
    b.expected_return_date = expected
    b.return_date = None
    b.delay_days = None
    b.delay_party = None
    b.delay_reason = None
    codes = {p.id: p.code for p in db.query(WfCoatingPackage).filter_by(batch_id=b.id)}
    for it in _batch_items(db, b):
        upsert_state(db, it.element_kind, it.serial, lifecycle_status="at_coater", company_id=b.company_id)
        label = "Rework sent" if action == "rework" else "Sent for recoating"
        code = codes.get(it.package_id)
        log_event(
            db, it.element_kind, it.serial, "dispatch", dispatch_date,
            f"{label} {code or ''} → {co.name if co else ''}",
            ref_kind="wf_coating", ref_id=b.id, details={"code": code, "indent_no": b.indent_no},
        )
        recoating_on_dispatch(
            db,
            kind=it.element_kind,
            serial=it.serial,
            code=code,
            dispatch_date=dispatch_date,
            manufacturer=co.name[:100] if co else None,
            prior_days=_prior_coating_service_days(db, it.element_kind, it.serial, dispatch_date),
        )
    _move(
        db, "coating", b, "await_return", action, user, body.note,
        {"dispatch_date": dispatch_date.isoformat(), "expected_return_date": expected.isoformat()},
    )


@router.post("/coating/{batch_id}/dispatch")
def coating_dispatch(batch_id: int, body: DispatchIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_dispatch",))
    items = _batch_items(db, b)
    forms = coating_inspections(db, items)
    missing = [i.serial for i in items if not forms.get(i.id)]
    if missing:
        raise HTTPException(
            409,
            f"Element Inspection form missing for {len(missing)} of {len(items)} pieces: {', '.join(missing[:30])}"
            f"{' …' if len(missing) > 30 else ''}. Every piece sent for recoating needs its inspection form.",
        )
    _do_dispatch(db, b, body, user, "dispatch")
    db.commit()
    return _coating_detail(db, b, user)


class ReceiveIn(NoteIn):
    actual_date: date
    delay_party: str | None = None
    delay_reason: str | None = None
    warranty_months: int | None = Field(None, ge=0, le=240)
    warranty_start: date


@router.post("/coating/{batch_id}/receive")
def coating_receive(batch_id: int, body: ReceiveIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_return",))
    if b.dispatch_date and body.actual_date < b.dispatch_date:
        raise HTTPException(400, "Return date is before the send date")
    days = _delay(b.expected_return_date, body.actual_date)
    _check_delay(days, body.delay_party, body.delay_reason)
    b.return_date = body.actual_date
    b.delay_days = days
    late = days is not None and days > 0
    b.delay_party = body.delay_party if late else None
    b.delay_reason = ((body.delay_reason or "").strip() or None) if late else None
    b.warranty_start = body.warranty_start
    if body.warranty_months is not None:
        b.warranty_months = body.warranty_months
    co = _company(db, b.company_id)
    codes = {p.id: p.code for p in db.query(WfCoatingPackage).filter_by(batch_id=b.id)}
    for it in _batch_items(db, b):
        upsert_state(db, it.element_kind, it.serial, lifecycle_status="pending_receive", company_id=b.company_id)
        code = codes.get(it.package_id)
        log_event(
            db, it.element_kind, it.serial, "receive", body.actual_date,
            f"Returned from coating {code or ''}",
            ref_kind="wf_coating", ref_id=b.id, details={"code": code, "delay_days": days},
        )
        recoating_on_return(
            db,
            kind=it.element_kind,
            serial=it.serial,
            code=code,
            return_date=body.actual_date,
            warranty_months=b.warranty_months,
            warranty_start=b.warranty_start,
        )
        write_tafkik_warranty(
            db,
            serial=it.serial,
            kind=it.element_kind,
            company=co.name if co else None,
            warranty_start=b.warranty_start,
            warranty_months=b.warranty_months,
        )
    _event(
        db, "coating", b, "receive", user, b.status, body.note,
        {
            "return_date": body.actual_date.isoformat(),
            "delay_days": days,
            "delay_party": b.delay_party,
            "delay_reason": b.delay_reason,
            "warranty_months": b.warranty_months,
            "warranty_start": b.warranty_start.isoformat() if b.warranty_start else None,
        },
    )
    db.commit()
    return _coating_detail(db, b, user)


def _apply_report(db: Session, b: WfCoatingBatch, content: bytes, package_id: int | None) -> int:
    try:
        sheets = parse_report(content)
    except Exception:
        return 0
    packages = {p.code.upper(): p for p in db.query(WfCoatingPackage).filter_by(batch_id=b.id)}
    items = _batch_items(db, b)
    filled = 0
    for sheet in sheets:
        pkg = packages.get((sheet["code"] or "").strip().upper())
        scope = [i for i in items if (pkg and i.package_id == pkg.id) or (not pkg and (package_id is None or i.package_id == package_id))]
        by_serial = {compact_nr(i.serial): i for i in scope}
        for row in sheet["rows"]:
            it = by_serial.get(compact_nr(row["serial"]))
            if not it:
                continue
            it.pre_inspection = row["pre_inspection"][:2000] or it.pre_inspection
            it.final_report = row["final_report"][:2000] or it.final_report
            it.remark = row["remark"][:2000] or it.remark
            filled += 1
    return filled


@router.post("/coating/{batch_id}/report")
def coating_report(
    batch_id: int,
    package_id: int | None = Form(None),
    note: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_return",))
    if package_id is not None and not db.query(WfCoatingPackage).filter_by(id=package_id, batch_id=b.id).first():
        raise HTTPException(400, "Unknown pallet")
    filled = 0
    names = []
    for up in files:
        if not (up.filename or "").strip():
            continue
        row, content = _save_upload(db, "coating", b.id, up, "report", user, package_id)
        names.append(row.original_name)
        if row.original_name.lower().endswith((".xlsx", ".xlsm")):
            filled += _apply_report(db, b, content, package_id)
    if not names:
        raise HTTPException(400, "Choose the report file")
    _event(db, "coating", b, "report", user, b.status, note, {"files": names, "rows_filled": filled})
    db.commit()
    return {"rows_filled": filled, "detail": _coating_detail(db, b, user)}


@router.post("/coating/{batch_id}/submit")
def coating_submit(batch_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_return",))
    if b.return_date is None:
        raise HTTPException(400, "Record the delivery date before sending this to inspection")
    if not db.query(WfFile).filter_by(flow="coating", record_id=b.id, kind="report").first():
        raise HTTPException(400, "Attach the Excel report received from the coating company first")
    b.rejected = False
    _move(db, "coating", b, "await_inspection", "submit", user, body.note, notify_creator=True)
    db.commit()
    return _coating_detail(db, b, user)


@router.post("/coating/{batch_id}/inspect_ok")
def coating_inspect_ok(batch_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Inspection checked the returned pieces and the company report; C-90 gives the final approval next."""
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_inspection",))
    codes = {p.id: p.code for p in db.query(WfCoatingPackage).filter_by(batch_id=b.id)}
    inspector = (user.full_name or user.username or "").strip()[:100] or None
    for it in _batch_items(db, b):
        coating_check_on_inspect(
            db,
            kind=it.element_kind,
            serial=it.serial,
            code=codes.get(it.package_id),
            inspector=inspector,
            note=body.note,
            day=date.today(),
        )
    _move(db, "coating", b, "await_approval", "inspect_ok", user, body.note)
    db.commit()
    return _coating_detail(db, b, user)


@router.post("/coating/{batch_id}/inspect_reject")
def coating_inspect_reject(batch_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_inspection",))
    if not (body.note or "").strip():
        raise HTTPException(400, "Write why the result is not accepted")
    b.rejected = True
    _move(db, "coating", b, "await_return", "inspect_reject", user, body.note, notify_creator=True)
    db.commit()
    return _coating_detail(db, b, user)


@router.post("/coating/{batch_id}/rework")
def coating_rework(batch_id: int, body: DispatchIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_return",))
    if body.dispatch_date is None or body.expected_return_date is None:
        raise HTTPException(400, "Send date and expected return date are required")
    b.rework_count = (b.rework_count or 0) + 1
    b.rejected = False
    _do_dispatch(db, b, body, user, "rework")
    db.commit()
    return _coating_detail(db, b, user)


def _prior_coating_service_days(db: Session, kind: str, serial: str, until: date | None) -> int | None:
    """Operating days of the previous coating when this piece is sent again (return → this dispatch)."""
    if not until:
        return None
    if kind == "anode":
        prev = (
            db.query(models.AnodeRecoating)
            .filter(models.AnodeRecoating.anode_nr == serial, models.AnodeRecoating.return_date.isnot(None))
            .order_by(models.AnodeRecoating.return_date.desc())
            .first()
        )
        start = prev.return_date.date() if prev and prev.return_date else None
    else:
        prev = (
            db.query(models.CathodeRecoating)
            .filter(models.CathodeRecoating.cathode_nr == serial, models.CathodeRecoating.return_date.isnot(None))
            .order_by(models.CathodeRecoating.return_date.desc())
            .first()
        )
        start = prev.return_date.date() if prev and prev.return_date else None
    if not start:
        return None
    return max(0, (until - start).days)


@router.post("/coating/{batch_id}/approve")
def coating_approve(batch_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_approval",))
    co = _company(db, b.company_id)
    codes = {p.id: p.code for p in db.query(WfCoatingPackage).filter_by(batch_id=b.id)}
    day = date.today()
    for it in _batch_items(db, b):
        code = codes.get(it.package_id)
        upsert_state(db, it.element_kind, it.serial, lifecycle_status="in_plant", company_id=None)
        log_event(db, it.element_kind, it.serial, "coating_approved", day, f"Recoating approved {code}", ref_kind="wf_coating", ref_id=b.id, details={"code": code})
        remark = f"Workflow {code}" + (f" — {it.final_report}" if it.final_report else "")
        prior = _prior_coating_service_days(db, it.element_kind, it.serial, b.dispatch_date)
        recoating_on_approve(
            db,
            kind=it.element_kind,
            serial=it.serial,
            code=code,
            dispatch_date=b.dispatch_date,
            return_date=b.return_date,
            manufacturer=co.name[:100] if co else None,
            remark=remark,
            warranty_months=b.warranty_months,
            warranty_start=b.warranty_start,
            prior_days=prior,
        )
    _move(db, "coating", b, "completed", "approve", user, body.note, notify_creator=True)
    db.commit()
    return _coating_detail(db, b, user)


@router.post("/coating/{batch_id}/reject")
def coating_reject(batch_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_approval",))
    if not (body.note or "").strip():
        raise HTTPException(400, "Write why the result is not accepted")
    b.rejected = True
    _move(db, "coating", b, "await_return", "reject", user, body.note, notify_creator=True)
    db.commit()
    return _coating_detail(db, b, user)


@router.post("/coating/{batch_id}/cancel")
def coating_cancel(batch_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    managed = _can_manage(db, user, "coating", b.status)
    early = b.status in ("await_company", "await_indent", "await_dispatch") and "c90" in _groups(db, user)
    if not _can_cancel(user, b.status, b.created_by_id, "await_company", also=early or managed):
        raise HTTPException(409, "Only the requester, the section supervisor, or an admin can cancel this request")
    _admin_cancel_note(user, body.note, required=managed)
    rollback_coating(db, b)
    _move(db, "coating", b, "cancelled", "cancel", user, body.note, notify_creator=True)
    db.commit()
    return _coating_detail(db, b, user)


@router.get("/coating/{batch_id}/excel")
def coating_excel(batch_id: int, package_id: int | None = None, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user)
    b = _load_batch(db, batch_id)
    co = _company(db, b.company_id)
    q = db.query(WfCoatingPackage).filter_by(batch_id=b.id).order_by(WfCoatingPackage.seq)
    packages = q.all()
    total = len(packages)
    if package_id is not None:
        packages = [p for p in packages if p.id == package_id]
        if not packages:
            raise HTTPException(404, "Pallet not found")
    items = _batch_items(db, b)
    _fill_problems(db, items)
    sheets = []
    for p in packages:
        rows = sorted((i for i in items if i.package_id == p.id), key=lambda i: i.line_no)
        sheets.append(
            {
                "code": p.code,
                "pallet_no": p.pallet_no,
                "pallets": total,
                "date": p.created_at.date().isoformat() if p.created_at else "",
                "company": co.name if co else "",
                "indent_no": b.indent_no or "",
                "items": [{"kind": i.element_kind, "serial": i.serial, "problem": i.problem} for i in rows],
            }
        )
    name = packages[0].code if len(packages) == 1 else f"recoating-{b.id}"
    return Response(
        content=build_workbook(sheets),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'},
    )


@router.get("/coating/{batch_id}/dispatch-pack")
def coating_dispatch_pack(batch_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """ZIP for the coater: Excel of all pallets + latest Element Inspection PDF per piece (named by serial)."""
    _require_view(db, user)
    b = _load_batch(db, batch_id)
    co = _company(db, b.company_id)
    packages = db.query(WfCoatingPackage).filter_by(batch_id=b.id).order_by(WfCoatingPackage.seq).all()
    items = _batch_items(db, b)
    _fill_problems(db, items)
    forms = coating_inspections(db, items)
    sheets = []
    for p in packages:
        rows = sorted((i for i in items if i.package_id == p.id), key=lambda i: i.line_no)
        sheets.append(
            {
                "code": p.code,
                "pallet_no": p.pallet_no,
                "pallets": len(packages),
                "date": p.created_at.date().isoformat() if p.created_at else "",
                "company": co.name if co else "",
                "indent_no": b.indent_no or "",
                "items": [{"kind": i.element_kind, "serial": i.serial, "problem": i.problem} for i in rows],
            }
        )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"recoating-{b.id}.xlsx", build_workbook(sheets))
        from ..inspection_pdf import inspection_pdf_bytes
        from ..routers.inspections import _pack

        for it in items:
            info = forms.get(it.id) or {}
            report_id = info.get("id")
            if not report_id:
                continue
            report = db.get(models.InspectionReport, int(report_id))
            if report is None:
                continue
            try:
                pdf = inspection_pdf_bytes(_pack(db, [report]))
            except Exception:  # noqa: BLE001
                continue
            if not pdf:
                continue
            safe = "".join(ch if ch.isalnum() or ch in "-_ ." else "_" for ch in (it.serial or "piece")).strip() or "piece"
            zf.writestr(f"{safe}.pdf", pdf)
    codes = "-".join(p.code for p in packages[:3])
    fname = f"{codes or f'recoating-{b.id}'}-pack.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ------------------------------------------------------------------ new purchase workflow


class PurchaseCreateIn(BaseModel):
    supplier_id: int
    anode_count: int = Field(0, ge=0, le=5000)
    cathode_count: int = Field(0, ge=0, le=5000)
    approval_ref: str | None = None
    remarks: str | None = None


def _purchase_actions(db: Session, p: WfPurchase, user: models.User) -> list[str]:
    groups = _groups(db, user)
    mine = bool(groups & set(PURCHASE_STAGES.get(p.status, [])))
    acts: list[str] = []
    if mine and p.status in ("await_indent", "await_order", "await_confirm", "await_confirm_insp", "await_registration"):
        acts.append({"await_indent": "indent", "await_order": "order", "await_confirm": "confirm", "await_confirm_insp": "confirm", "await_registration": "register"}[p.status])
    early = p.status in ("await_indent", "await_order", "await_confirm", "await_confirm_insp") and ("procurement" in groups or "process" in groups)
    managed = _can_manage(db, user, "purchase", p.status)
    if _can_cancel(user, p.status, p.created_by_id, "await_indent", also=early or managed):
        acts.append("cancel")
    if managed:
        acts.append("edit")
    if p.status not in CLOSED and groups:
        acts.append("attach")
    return acts


def _purchase_detail(db: Session, p: WfPurchase, user: models.User) -> dict:
    data = _purchase_summary(db, p)
    items = db.query(WfPurchaseItem).filter_by(purchase_id=p.id).order_by(WfPurchaseItem.id).all()
    data.update(
        {
            "delay_party": p.delay_party,
            "delay_reason": p.delay_reason,
            "remarks": p.remarks,
            "completed_at": _iso(p.completed_at),
            "items": [
                {"id": i.id, "element_kind": i.element_kind, "serial": i.serial, "coating": i.coating, "manufacturer": i.manufacturer}
                for i in items
            ],
            "files": _files(db, "purchase", p.id),
            "events": _events(db, "purchase", p.id),
            "actions": _purchase_actions(db, p, user),
        }
    )
    return data


def _load_purchase(db: Session, purchase_id: int) -> WfPurchase:
    p = db.get(WfPurchase, purchase_id)
    if not p:
        raise HTTPException(404, "Purchase not found")
    return p


@router.get("/purchase")
def list_purchases(status: str | None = None, open_only: bool = False, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user)
    q = db.query(WfPurchase).order_by(WfPurchase.created_at.desc())
    if status:
        q = q.filter(WfPurchase.status == status)
    if open_only:
        q = q.filter(WfPurchase.status.notin_(CLOSED))
    return [_purchase_summary(db, p) for p in q.limit(500).all()]


@router.get("/purchase/{purchase_id}")
def get_purchase(purchase_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user)
    return _purchase_detail(db, _load_purchase(db, purchase_id), user)


@router.post("/purchase")
def create_purchase(body: PurchaseCreateIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_group(db, user, "process")
    if body.anode_count + body.cathode_count <= 0:
        raise HTTPException(400, "Enter how many anodes and/or cathodes are bought")
    sup = _company(db, body.supplier_id)
    if not sup or not sup.is_supplier:
        raise HTTPException(400, "Choose a supplier company")
    seq = _next_seq(db, WfPurchase.seq)
    p = WfPurchase(
        code=_code("PO", date.today(), seq),
        seq=seq,
        status="await_indent",
        supplier_id=sup.id,
        anode_count=body.anode_count,
        cathode_count=body.cathode_count,
        approval_ref=(body.approval_ref or "").strip()[:120] or None,
        remarks=(body.remarks or "").strip() or None,
        created_by_id=user.id,
        created_by_name=_display(user),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(p)
    db.flush()
    _event(db, "purchase", p, "created", user, None, body.remarks, {"supplier": sup.name, "anodes": body.anode_count, "cathodes": body.cathode_count})
    _notify(db, "purchase", p, user)
    db.commit()
    return _purchase_detail(db, p, user)


@router.post("/purchase/{purchase_id}/indent")
def purchase_indent(purchase_id: int, body: IndentIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    p = _load_purchase(db, purchase_id)
    _require_stage(db, user, "purchase", p.status, ("await_indent",))
    indent = body.indent_no.strip()[:60]
    if not indent:
        raise HTTPException(400, "Indent number required")
    p.indent_no = indent
    _move(db, "purchase", p, "await_order", "indent", user, body.note, {"indent_no": indent})
    db.commit()
    return _purchase_detail(db, p, user)


class OrderIn(NoteIn):
    request_date: date
    expected_delivery_date: date
    delivery_date: date
    delay_party: str | None = None
    delay_reason: str | None = None


@router.post("/purchase/{purchase_id}/order")
def purchase_order(purchase_id: int, body: OrderIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Procurement attaches the purchase documents, then process and inspection confirm."""
    p = _load_purchase(db, purchase_id)
    _require_stage(db, user, "purchase", p.status, ("await_order",))
    if not db.query(WfFile).filter_by(flow="purchase", record_id=p.id).first():
        raise HTTPException(400, "Attach the purchase documents before sending them on")
    if body.expected_delivery_date < body.request_date:
        raise HTTPException(400, "Expected delivery date is before the request date")
    if body.delivery_date < body.request_date:
        raise HTTPException(400, "Delivery date is before the request date")
    days = _delay(body.expected_delivery_date, body.delivery_date)
    _check_delay(days, body.delay_party, body.delay_reason)
    late = days is not None and days > 0
    p.request_date = body.request_date
    p.expected_delivery_date = body.expected_delivery_date
    p.delivery_date = body.delivery_date
    p.delay_days = days
    p.delay_party = body.delay_party if late else None
    p.delay_reason = ((body.delay_reason or "").strip() or None) if late else None
    _move(
        db, "purchase", p, "await_confirm", "order", user, body.note,
        {
            "request_date": body.request_date.isoformat(),
            "expected_delivery_date": body.expected_delivery_date.isoformat(),
            "delivery_date": body.delivery_date.isoformat(),
            "delay_days": days,
            "delay_reason": p.delay_reason,
        },
    )
    db.commit()
    return _purchase_detail(db, p, user)


@router.post("/purchase/{purchase_id}/confirm")
def purchase_confirm(purchase_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Two separate steps: process confirms first, then inspection; only then does C-90 register the pieces."""
    p = _load_purchase(db, purchase_id)
    _require_stage(db, user, "purchase", p.status, ("await_confirm", "await_confirm_insp"))
    side = "process" if p.status == "await_confirm" else "inspection"
    signed = dict(p.decisions or {})
    signed[side] = {"name": _display(user), "at": _iso(_now()), "note": (body.note or "").strip() or None}
    p.decisions = signed
    if side == "process" and "inspection" not in signed:
        target = "await_confirm_insp"
    else:
        target = "await_registration"
    _move(db, "purchase", p, target, "confirm", user, body.note, {"signed": side})
    db.commit()
    return _purchase_detail(db, p, user)


@router.post("/purchase/{purchase_id}/deliver")
def purchase_deliver(purchase_id: int, body: ReceiveIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    p = _load_purchase(db, purchase_id)
    _require_stage(db, user, "purchase", p.status, ("ordered",))
    if p.request_date and body.actual_date < p.request_date:
        raise HTTPException(400, "Delivery date is before the request date")
    days = _delay(p.expected_delivery_date, body.actual_date)
    _check_delay(days, body.delay_party, body.delay_reason)
    late = days is not None and days > 0
    p.delivery_date = body.actual_date
    p.delay_days = days
    p.delay_party = body.delay_party if late else None
    p.delay_reason = ((body.delay_reason or "").strip() or None) if late else None
    _move(
        db, "purchase", p, "await_registration", "deliver", user, body.note,
        {"delivery_date": body.actual_date.isoformat(), "delay_days": days, "delay_party": p.delay_party, "delay_reason": p.delay_reason},
    )
    db.commit()
    return _purchase_detail(db, p, user)


class ElectrodeSpecIn(BaseModel):
    assembly_group: str | None = None
    component_nr: str | None = None
    customer_drawing_nr: str | None = None
    manufacturer: str | None = None
    manufacturer_order_nr: str | None = None
    manufacturer_drawing_nr: str | None = None
    manufacturer_date: date | None = None
    tank: str | None = None
    contact_strip: str | None = None
    electrode_support: str | None = None
    electrode_shape: str | None = None
    coating: str | None = None
    baffle_plate: str | None = None
    downcomer: str | None = None
    inlet_system: str | None = None
    standpipe_diameter: str | None = None
    flange_width: str | None = None
    received_date: date | None = None
    remarks: str | None = None
    batch: str | None = None
    generation: str | None = None


class RegisterItemIn(ElectrodeSpecIn):
    element_kind: str = Field(pattern="^(anode|cathode)$")
    serial: str


class RegisterIn(NoteIn):
    items: list[RegisterItemIn]
    warranty_start: date
    warranty_months: int | None = Field(None, ge=0, le=240)


_SPEC_STR = {
    "assembly_group": 50,
    "component_nr": 50,
    "customer_drawing_nr": 50,
    "manufacturer": 100,
    "manufacturer_order_nr": 50,
    "manufacturer_drawing_nr": 50,
    "tank": 50,
    "contact_strip": 50,
    "electrode_support": 50,
    "electrode_shape": 50,
    "coating": 50,
    "baffle_plate": 50,
    "downcomer": 50,
    "inlet_system": 50,
    "standpipe_diameter": 50,
    "flange_width": 50,
    "batch": 50,
    "generation": 50,
}


def _spec_kwargs(
    it: ElectrodeSpecIn,
    kind: str,
    *,
    manufacturer: str | None,
    coating: str | None,
    received: date,
    batch: str,
) -> dict:
    raw = it.model_dump(exclude={"element_kind", "serial"}, exclude_none=True)
    if kind == "cathode":
        raw.pop("baffle_plate", None)
        raw.pop("downcomer", None)
    out: dict = {}
    for key, width in _SPEC_STR.items():
        if key not in raw:
            continue
        text = str(raw[key]).strip()[:width]
        if text:
            out[key] = text
    remarks = str(raw.get("remarks") or "").strip()
    if remarks:
        out["remarks"] = remarks
    out["manufacturer"] = out.get("manufacturer") or manufacturer
    out["coating"] = out.get("coating") or coating
    rec = raw.get("received_date") or received
    out["received_date"] = _stamp(rec) if rec else None
    made = raw.get("manufacturer_date")
    if made:
        out["manufacturer_date"] = _stamp(made)
    out["batch"] = out.get("batch") or batch
    return {k: v for k, v in out.items() if v is not None}


@router.post("/purchase/{purchase_id}/register")
def purchase_register(purchase_id: int, body: RegisterIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    p = _load_purchase(db, purchase_id)
    _require_stage(db, user, "purchase", p.status, ("await_registration",))
    sup = _company(db, p.supplier_id)
    done = db.query(WfPurchaseItem).filter_by(purchase_id=p.id).all()
    have = {"anode": sum(1 for i in done if i.element_kind == "anode"), "cathode": sum(1 for i in done if i.element_kind == "cathode")}
    limit = {"anode": p.anode_count, "cathode": p.cathode_count}
    indexes = {
        "anode": load_compact_index(db, models.Anode, "anode_nr"),
        "cathode": load_compact_index(db, models.Cathode, "cathode_nr"),
    }
    clean = []
    seen: set[tuple[str, str]] = set()
    for it in body.items:
        serial = it.serial.strip()[:50]
        if not serial:
            continue
        key = compact_nr(serial)
        if (it.element_kind, key) in seen:
            raise HTTPException(400, f"Entered twice: {serial}")
        seen.add((it.element_kind, key))
        if key in indexes[it.element_kind]:
            raise HTTPException(409, f"{serial} is already defined in the system")
        have[it.element_kind] += 1
        clean.append((it, serial))
    if not clean:
        raise HTTPException(400, "Enter the element numbers")
    for kind in ("anode", "cathode"):
        if have[kind] > limit[kind]:
            raise HTTPException(400, f"More {kind}s than purchased ({limit[kind]})")
    delivered = p.delivery_date or date.today()
    p.warranty_start = body.warranty_start
    if body.warranty_months is not None:
        p.warranty_months = body.warranty_months
    for it, serial in clean:
        manufacturer = (it.manufacturer or "").strip()[:100] or (sup.name[:100] if sup else None)
        coating = (it.coating or "").strip()[:50] or None
        master_cls = models.Anode if it.element_kind == "anode" else models.Cathode
        key_field = "anode_nr" if it.element_kind == "anode" else "cathode_nr"
        spec = _spec_kwargs(
            it,
            it.element_kind,
            manufacturer=manufacturer,
            coating=coating,
            received=delivered,
            batch=p.code,
        )
        db.add(master_cls(**{key_field: serial}, **spec))
        db.flush()
        db.add(
            WfPurchaseItem(
                purchase_id=p.id,
                element_kind=it.element_kind,
                serial=serial,
                coating=spec.get("coating"),
                manufacturer=spec.get("manufacturer"),
                registered_at=_now(),
            )
        )
        upsert_state(db, it.element_kind, serial, lifecycle_status="in_plant", company_id=None)
        log_event(db, it.element_kind, serial, "purchase", delivered, f"Purchase {p.code} from {sup.name if sup else ''}", ref_kind="wf_purchase", ref_id=p.id, details={"code": p.code, "indent_no": p.indent_no, "warranty_start": body.warranty_start.isoformat()})
        log_event(db, it.element_kind, serial, "plant_entry", delivered, "Entered plant inventory", ref_kind="wf_purchase", ref_id=p.id)
        write_tafkik_warranty(
            db,
            serial=serial,
            kind=it.element_kind,
            company=sup.name if sup else spec.get("manufacturer"),
            warranty_start=body.warranty_start,
            warranty_months=p.warranty_months,
        )
    finished = have["anode"] >= limit["anode"] and have["cathode"] >= limit["cathode"]
    data = {"registered": [s for _, s in clean]}
    if finished:
        _move(db, "purchase", p, "completed", "register", user, body.note, data, notify_creator=True)
    else:
        _event(db, "purchase", p, "register", user, p.status, body.note, data)
    db.commit()
    return _purchase_detail(db, p, user)


@router.post("/purchase/{purchase_id}/cancel")
def purchase_cancel(purchase_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    p = _load_purchase(db, purchase_id)
    managed = _can_manage(db, user, "purchase", p.status)
    early = p.status in ("await_indent", "await_order") and "procurement" in _groups(db, user)
    if not _can_cancel(user, p.status, p.created_by_id, "await_indent", also=early or managed):
        raise HTTPException(409, "Only the requester, the section supervisor, or an admin can cancel this request")
    _admin_cancel_note(user, body.note, required=managed)
    rollback_purchase(db, p)
    _move(db, "purchase", p, "cancelled", "cancel", user, body.note, notify_creator=True)
    db.commit()
    return _purchase_detail(db, p, user)


# ------------------------------------------------------------------ cell removal (operation -> cell shop)


def _can_request_cell(db: Session, user: models.User) -> bool:
    if user.role == "admin" or "operation" in _groups(db, user):
        return True
    return user_permission_map(db, user).get("elements") == "edit"


def _plant_reason(db: Session, element_nr: str | None, element_id: int | None) -> str | None:
    """The Assembly Data decommission reason is the reason shown on cell and inspection requests."""
    el = db.get(models.Element, element_id) if element_id else None
    if el is None and element_nr:
        el = _life_of(db, element_nr=element_nr)
    text = (el.decommission_reason or "").strip() if el is not None else ""
    return text[:800] or None


def _write_plant_reason(db: Session, element_nr: str | None, element_id: int | None, reason: str | None) -> None:
    if not reason:
        return
    el = db.get(models.Element, element_id) if element_id else None
    if el is None and element_nr:
        el = _life_of(db, element_nr=element_nr)
    if el is not None:
        el.decommission_reason = reason[:800]


def _latest_xrf(db: Session, serial: str | None) -> str | None:
    match = compact_eq(models.ElectrodeSegregation.serial_nr, serial or "")
    if match is None:
        return None
    row = (
        db.query(models.ElectrodeSegregation)
        .filter(match, models.ElectrodeSegregation.xrf.isnot(None), models.ElectrodeSegregation.xrf != "")
        .order_by(models.ElectrodeSegregation.id.desc())
        .first()
    )
    text = (row.xrf or "").strip() if row is not None else ""
    return text[:100] or None


def _cell_summary(db: Session, r: WfCellRequest, conf: dict | None = None) -> dict:
    return {
        "flow": "cell",
        "id": r.id,
        "title": _title("cell", r, db),
        "code": r.code,
        "codes": [r.code],
        "status": r.status,
        "request_kind": getattr(r, "request_kind", None) or "removal",
        "groups": CELL_STAGES.get(r.status, []),
        "element_nr": r.element_nr,
        "element_id": r.element_id,
        "electrolyzer": r.electrolyzer,
        "position": r.position,
        "reason": _plant_reason(db, r.element_nr, r.element_id) or r.reason,
        "urgent": r.urgent,
        "problem": r.problem,
        "planned_date": _iso(r.planned_date),
        "decommission_date": _iso(r.decommission_date),
        "received_date": _iso(r.received_date),
        "decision": r.decision,
        "anode_count": 0,
        "cathode_count": 0,
        "company_id": None,
        "company_name": None,
        "indent_no": None,
        "dispatch_date": _iso(r.planned_date),
        "expected_date": None,
        "actual_date": _iso(r.decommission_date),
        "delay_days": None,
        "created_by": r.created_by_name,
        "created_at": _iso(r.created_at),
        "updated_at": _iso(r.updated_at),
        "last_note": r.last_note,
        **_sla_fields(db, "cell", r, conf),
    }


def _cell_actions(db: Session, r: WfCellRequest, user: models.User) -> list[str]:
    groups = _groups(db, user)
    acts: list[str] = []
    if (getattr(r, "request_kind", None) or "removal") == "numbering":
        if r.status == "await_numbering" and "c90" in groups:
            acts.append("review")
        managed = _can_manage(db, user, "cell", r.status)
        if _can_cancel(user, r.status, r.created_by_id, "await_numbering", also=managed):
            acts.append("cancel")
        if managed:
            acts.append("edit")
        if r.status not in CLOSED and (groups or r.created_by_id == user.id):
            acts.extend(["comment", "attach"])
        return acts
    if r.status == "await_disassembly" and "c90" in groups:
        acts.append("dismantle")
    if r.status == "await_reinstall" and "c90" in groups:
        acts.append("install")
    if r.status == "await_shutdown" and "operation" in groups:
        acts.append("shutdown")
    if r.status == "await_shop" and "cellshop" in groups:
        acts.append("receive")
    if r.status in ("await_shop", "in_shop") and "cellshop" in groups:
        acts.append("decide")
    managed = _can_manage(db, user, "cell", r.status)
    if _can_cancel(user, r.status, r.created_by_id, "await_shutdown", also=(r.status == "await_shutdown" and "operation" in groups) or managed):
        acts.append("cancel")
    if managed:
        acts.append("edit")
    if r.status not in CLOSED and (groups or r.created_by_id == user.id):
        acts.extend(["comment", "attach"])
    return acts


def _cell_item(db: Session, element_nr: str) -> dict | None:
    key = compact_nr(element_nr)
    return next((i for i in svc.build_pipeline(db) if i["key"] == key), None) if key else None


def _cell_detail(db: Session, r: WfCellRequest, user: models.User) -> dict:
    data = _cell_summary(db, r)
    data.update(
        {
            "completed_at": _iso(r.completed_at),
            "remarks": None,
            "delay_party": None,
            "delay_reason": None,
            "element": _cell_item(db, r.element_nr),
            "files": _files(db, "cell", r.id),
            "events": _events(db, "cell", r.id),
            "actions": _cell_actions(db, r, user),
        }
    )
    return data


def _load_cell(db: Session, request_id: int) -> WfCellRequest:
    r = db.get(WfCellRequest, request_id)
    if not r:
        raise HTTPException(404, "Request not found")
    return r


def _open_cell_requests(db: Session, element_nr: str) -> list[WfCellRequest]:
    key = compact_nr(element_nr)
    rows = db.query(WfCellRequest).filter(WfCellRequest.status.notin_(CLOSED)).all()
    if not key:
        return []
    return [r for r in rows if compact_nr(r.element_nr) == key and (getattr(r, "request_kind", None) or "removal") != "numbering"]


def _cell_move(
    db: Session, r: WfCellRequest, to_status: str, action: str, actor: models.User,
    note: str | None = None, data: dict | None = None, also: tuple[str, ...] = (),
) -> None:
    """Like _move, plus the creator and the given groups hear about it (both sides follow the cell)."""
    before = r.status
    r.status = to_status
    if to_status in CLOSED:
        r.completed_at = _now()
    _event(db, "cell", r, action, actor, before, note, data)
    extra = _members(db, list(also)) if also else set()
    if r.created_by_id:
        extra.add(r.created_by_id)
    _notify(db, "cell", r, actor, extra)


def _write_decommission(db: Session, r: WfCellRequest, day: date, reason: str | None, actor: models.User) -> date:
    """Switch-off date and reason go to the Assembly Data row of this installation (the one source of truth)."""
    el = db.get(models.Element, r.element_id) if r.element_id else None
    if el is None:
        raise HTTPException(409, f"Element {r.element_nr} has no Assembly Data row")
    if el.disassembly_date:
        raise HTTPException(409, f"Element {r.element_nr} is already dismantled in Assembly Data")
    if el.decommissioning_date:
        day = svc._as_date(el.decommissioning_date) or day
    else:
        if day > date.today():
            raise HTTPException(400, "The switch-off date cannot be in the future")
        started = svc._as_date(el.commissioning_date) or svc._as_date(el.assembly_date)
        if started and day < started:
            raise HTTPException(400, f"The switch-off date is before the element was started ({started.isoformat()})")
        el.decommissioning_date = day
        from ..warehouse import dol_for_element, load_shutdown_windows

        el.dol_days = dol_for_element(el, load_shutdown_windows(db))
        db.add(
            models.ElementShopEvent(
                element_nr=str(el.element_nr)[:50], from_stage="in_service" if el.commissioning_date else "installed",
                to_stage="decommissioned", note=f"{r.code}: {reason or r.reason}"[:500], user=_display(actor), created_at=_now(),
            )
        )
    if not (el.decommission_reason or "").strip():
        el.decommission_reason = (reason or r.reason)[:800]
    r.decommission_date = day
    return day


class CellCreateIn(BaseModel):
    element_nr: str = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=800)
    urgent: bool = False
    problem: str | None = None
    planned_date: date | None = None
    decommission_date: date | None = None  # already switched off: written to Assembly Data right away


@router.get("/cell")
def list_cell_requests(
    status: str | None = None,
    open_only: bool = False,
    element_nr: str | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_view(db, user, CELL_VIEW_KEYS)
    _resume_parked_cell_requests(db)
    q = db.query(WfCellRequest).order_by(WfCellRequest.created_at.desc())
    if status:
        q = q.filter(WfCellRequest.status == status)
    if open_only:
        q = q.filter(WfCellRequest.status.notin_(CLOSED))
    rows = q.limit(2000).all()
    if element_nr:
        key = compact_nr(element_nr)
        rows = [r for r in rows if compact_nr(r.element_nr) == key]
    return [_cell_summary(db, r) for r in rows[:500]]


@router.get("/cell/{request_id}")
def get_cell_request(request_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user, CELL_VIEW_KEYS)
    _resume_parked_cell_requests(db)
    return _cell_detail(db, _load_cell(db, request_id), user)


@router.post("/cell")
def create_cell_request(body: CellCreateIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if not _can_request_cell(db, user):
        raise HTTPException(403, "Only operation or Assembly Data editors can ask for a cell to be taken out")
    svc.clear_cache()
    item = _cell_item(db, body.element_nr)
    if item is None or item["row_id"] is None:
        raise HTTPException(404, f"Element {body.element_nr} is not in Assembly Data")
    base, state = item["base_state"], item["state"]
    if base not in ("in_service", "installed") and not (base == "decommissioned" and state == "decommissioned"):
        raise HTTPException(409, f"Element {item['element_nr']} is '{state}'; only an element that sits in a cell can be sent to the cell shop")
    existing = _open_cell_requests(db, item["element_nr"])
    if existing:
        raise HTTPException(409, f"Request {existing[0].code} for element {item['element_nr']} is still open")
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(400, "Enter the reason")
    seq = _next_seq(db, WfCellRequest.seq)
    r = WfCellRequest(
        code=_code("CR", date.today(), seq),
        seq=seq,
        status="await_shutdown",
        element_nr=item["element_nr"][:50],
        element_id=item["row_id"],
        electrolyzer=item["electrolyzer"],
        position=item["position"],
        reason=reason[:800],
        urgent=body.urgent,
        problem=(body.problem or "").strip() or None,
        planned_date=body.planned_date,
        created_by_id=user.id,
        created_by_name=_display(user),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(r)
    db.flush()
    el_row = db.get(models.Element, item["row_id"])
    remember(db, "cell", r.id, {"element": snapshot_element(el_row), "shop": snapshot_shop(db, item["element_nr"])})
    _event(db, "cell", r, "created", user, None, body.problem, {"reason": r.reason, "urgent": r.urgent})
    off = svc._as_date(item["decommissioning_date"]) if base == "decommissioned" else body.decommission_date
    if off is not None:
        day = _write_decommission(db, r, off, reason, user)
        r.status = "await_shop"
        _event(db, "cell", r, "shutdown", user, "await_shutdown", None, {"date": day.isoformat()})
    # the cell shop hears about it from the start, even while operation still has to switch the cell off
    _notify(db, "cell", r, user, _members(db, ["cellshop"]))
    db.commit()
    svc.clear_cache()
    return _cell_detail(db, r, user)


class NumberingCreateIn(BaseModel):
    electrolyzer: str = Field(min_length=1, max_length=50)
    position: str = Field(min_length=1, max_length=20)
    element_nr: str | None = None
    note: str | None = None


@router.post("/cell/numbering")
def create_numbering_review(body: NumberingCreateIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Operation asks C-90 to check that element numbers still match the cell positions."""
    if not _can_request_cell(db, user):
        raise HTTPException(403, "Only operation or Assembly Data editors can ask C-90 to review the numbering")
    ez = body.electrolyzer.strip()
    pos = body.position.strip()
    if not ez or not pos:
        raise HTTPException(400, "Choose the electrolyzer and the cell")
    open_rows = (
        db.query(WfCellRequest)
        .filter(WfCellRequest.status.notin_(CLOSED), WfCellRequest.request_kind == "numbering", WfCellRequest.electrolyzer == ez)
        .all()
    )
    if any(str(r.position or "").strip() == pos for r in open_rows):
        raise HTTPException(409, f"A numbering review for {ez}-{pos} is already open")
    shown = (body.element_nr or "").strip()
    item = _cell_item(db, shown) if shown else None
    seq = _next_seq(db, WfCellRequest.seq)
    note = (body.note or "").strip() or None
    r = WfCellRequest(
        code=_code("NR", date.today(), seq),
        seq=seq,
        status="await_numbering",
        request_kind="numbering",
        element_nr=(shown or f"{ez}-{pos}")[:50],
        element_id=item["row_id"] if item else None,
        electrolyzer=ez[:50],
        position=pos[:20],
        reason="Numbering mismatch",
        problem=note,
        created_by_id=user.id,
        created_by_name=_display(user),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(r)
    db.flush()
    remember(
        db,
        "cell",
        r.id,
        {
            "element": snapshot_element(db.get(models.Element, item["row_id"]) if item else None),
            "shop": snapshot_shop(db, shown or None),
        },
    )
    _event(db, "cell", r, "created", user, None, note, {"kind": "numbering", "cell": f"{ez}-{pos}"})
    _notify(db, "cell", r, user)
    db.commit()
    return _cell_detail(db, r, user)


class CellShutdownIn(NoteIn):
    date: date_type
    reason: str | None = None


@router.post("/cell/{request_id}/shutdown")
def cell_shutdown(request_id: int, body: CellShutdownIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_cell(db, request_id)
    _require_stage(db, user, "cell", r.status, ("await_shutdown",))
    reason = (body.reason or "").strip() or None
    if reason:
        r.reason = reason[:800]
    day = _write_decommission(db, r, body.date, reason, user)
    from .work_orders import ensure_work_order_process

    ensure_work_order_process(db, r.element_nr, "pickup", user, day=day, note=body.note)
    _cell_move(db, r, "await_shop", "shutdown", user, body.note, {"date": day.isoformat()})
    db.commit()
    svc.clear_cache()
    return _cell_detail(db, r, user)


class CellReceiveIn(NoteIn):
    date: date_type


@router.post("/cell/{request_id}/receive")
def cell_receive(request_id: int, body: CellReceiveIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_cell(db, request_id)
    _require_stage(db, user, "cell", r.status, ("await_shop",))
    if r.decommission_date and body.date < r.decommission_date:
        raise HTTPException(400, f"The cell cannot arrive before it was switched off ({r.decommission_date.isoformat()})")
    if body.date > date.today():
        raise HTTPException(400, "The arrival date cannot be in the future")
    r.received_date = body.date
    from .work_orders import ensure_work_order_process

    ensure_work_order_process(db, r.element_nr, "store", user, day=body.date, note=body.note)
    _cell_move(db, r, "in_shop", "receive", user, body.note, {"date": body.date.isoformat()}, also=("operation",))
    db.commit()
    return _cell_detail(db, r, user)


class CellDecideIn(NoteIn):
    choice: str = Field(pattern="^(keep|disassemble|relocate)$")
    electrolyzer: str | None = None
    position: str | None = None
    date: date_type | None = None


@router.post("/cell/{request_id}/decide")
def cell_decide(request_id: int, body: CellDecideIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """The cell shop's decision is the Element Workflow decision itself: kept healthy, dismantled, or moved to a new cell."""
    from .element_dashboard import ShopRelocate, relocate_element

    r = _load_cell(db, request_id)
    _require_stage(db, user, "cell", r.status, ("await_shop", "in_shop"))
    note = (body.note or "").strip() or None
    svc.clear_cache()
    data: dict[str, Any] = {"choice": body.choice}
    if body.choice == "relocate":
        if not (body.electrolyzer or "").strip() or not (body.position or "").strip():
            raise HTTPException(400, "Choose the electrolyzer and the position of the new cell")
        moved = relocate_element(
            db, ShopRelocate(element_nr=r.element_nr, electrolyzer=body.electrolyzer, position=body.position, date=body.date, note=note), user
        )
        data["cell"] = f"{moved['electrolyzer']}-{moved['position']}"
        r.decision = "relocated"
    else:
        try:
            svc.decide_decommissioned(db, r.element_nr, body.choice, note, _display(user))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        r.decision = body.choice
    if r.received_date is None:
        r.received_date = date.today()
    if body.choice == "disassemble":
        # C-90 still has to confirm the dismantling; the request stays in their cartable.
        _cell_move(db, r, "await_disassembly", "decide", user, note, data, also=("c90",))
    elif body.choice == "keep":
        # A healthy cell in the shop is not finished until someone puts it back in a position.
        _cell_move(db, r, "await_reinstall", "decide", user, note, data, also=("c90",))
    else:
        _cell_move(db, r, "completed", "decide", user, note, data, also=("operation",))
    db.commit()
    svc.clear_cache()
    return _cell_detail(db, r, user)


class CellDismantleIn(NoteIn):
    date: date_type


@router.post("/cell/{request_id}/dismantle")
def cell_dismantle(request_id: int, body: CellDismantleIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """C-90 confirms the element is taken apart: the disassembly date is written and inspection is asked for."""
    r = _load_cell(db, request_id)
    if "dismantle" not in _cell_actions(db, r, user):
        raise HTTPException(403, "C-90 confirms the dismantling")
    svc.clear_cache()
    try:
        svc.advance_stage(db, r.element_nr, (body.note or "").strip() or None, _display(user), body.date)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.flush()
    inspection_on_element_dismantled(db, r.element_nr, user)
    from .work_orders import ensure_work_order_for_disassembly

    ensure_work_order_for_disassembly(
        db, r.element_nr, user, disassemble_date=body.date, cell_request_id=r.id
    )
    _cell_move(db, r, "completed", "dismantle", user, body.note, {"date": body.date.isoformat()}, also=("operation", "cellshop", "inspection", "planner"))
    db.commit()
    svc.clear_cache()
    return _cell_detail(db, r, user)


class CellInstallIn(NoteIn):
    electrolyzer: str = Field(min_length=1)
    position: str = Field(min_length=1)
    date: date_type | None = None


@router.post("/cell/{request_id}/install")
def cell_install(request_id: int, body: CellInstallIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """A healthy cell kept in the shop goes back into a position. Same element number, a new installation row."""
    from .element_dashboard import ShopRelocate, relocate_element

    r = _load_cell(db, request_id)
    if "install" not in _cell_actions(db, r, user):
        raise HTTPException(403, "Operation or the cell shop returns this cell to a position")
    note = (body.note or "").strip() or None
    svc.clear_cache()
    moved = relocate_element(
        db, ShopRelocate(element_nr=r.element_nr, electrolyzer=body.electrolyzer, position=body.position, date=body.date, note=note), user
    )
    cell = f"{moved['electrolyzer']}-{moved['position']}"
    r.decision = "relocated"
    from .work_orders import ensure_work_order_process

    ensure_work_order_process(db, r.element_nr, "install", user, day=body.date or date.today(), cell=cell, note=note)
    _cell_move(db, r, "completed", "install", user, note, {"cell": cell}, also=("operation", "cellshop"))
    db.commit()
    svc.clear_cache()
    return _cell_detail(db, r, user)


class CellReviewIn(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


@router.post("/cell/{request_id}/review")
def cell_numbering_review(request_id: int, body: CellReviewIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_cell(db, request_id)
    if "review" not in _cell_actions(db, r, user):
        raise HTTPException(403, "C-90 reviews a numbering request")
    note = body.note.strip()
    r.last_note = note
    _cell_move(db, r, "completed", "review", user, note, {"kind": "numbering"}, also=("operation",))
    db.commit()
    return _cell_detail(db, r, user)


class CellCommentIn(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


@router.post("/cell/{request_id}/comment")
def cell_comment(request_id: int, body: CellCommentIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_cell(db, request_id)
    if "comment" not in _cell_actions(db, r, user):
        raise HTTPException(403, "Only the requester and the workflow groups can write on this request")
    text = body.note.strip()
    if not text:
        raise HTTPException(400, "Write a message")
    _event(db, "cell", r, "comment", user, r.status, text)
    hear = ["operation", "c90"] if (getattr(r, "request_kind", None) or "removal") == "numbering" else ["operation", "cellshop"]
    extra = _members(db, hear)
    if r.created_by_id:
        extra.add(r.created_by_id)
    _notify(db, "cell", r, user, extra)
    db.commit()
    return _cell_detail(db, r, user)


@router.post("/cell/{request_id}/cancel")
def cell_cancel(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_cell(db, request_id)
    if "cancel" not in _cell_actions(db, r, user):
        raise HTTPException(409, "Only the requester, the section supervisor, or an admin can cancel this request")
    _admin_cancel_note(user, body.note, required=_can_manage(db, user, "cell", r.status))
    rollback_cell(db, r)
    _cell_move(db, r, "cancelled", "cancel", user, body.note, also=("cellshop",))
    db.commit()
    return _cell_detail(db, r, user)


def close_cell_requests(db: Session, element_nr: str, decision: str, actor: models.User, note: str | None = None, cell: str | None = None) -> None:
    """The cell shop decided from the element pipeline (not from the request): the open request is done too."""
    for r in _open_cell_requests(db, element_nr):
        r.decision = "relocated" if decision in ("relocate", "relocated") else decision
        if r.received_date is None:
            r.received_date = date.today()
        data = {"choice": r.decision, **({"cell": cell} if cell else {})}
        _cell_move(db, r, "completed", "decide", actor, (note or "").strip() or None, data, also=("operation",))


def handoff_cell_requests(db: Session, element_nr: str, decision: str, actor: models.User, note: str | None = None) -> None:
    """Keep and dismantle are not finished: C-90 still confirms dismantling, and a healthy cell still has to go back."""
    status = "await_disassembly" if decision == "disassemble" else "await_reinstall" if decision == "keep" else None
    if status is None:
        close_cell_requests(db, element_nr, decision, actor, note)
        return
    also = ("c90",) if status == "await_disassembly" else ("operation", "cellshop")
    for r in _open_cell_requests(db, element_nr):
        r.decision = decision
        if r.received_date is None:
            r.received_date = date.today()
        _cell_move(db, r, status, "decide", actor, (note or "").strip() or None, {"choice": decision}, also=also)


def cell_on_element_saved(db: Session, el: models.Element, actor: models.User, had_decommission: bool, had_disassembly: bool) -> None:
    """Assembly Data typed by hand stays in step with the requests (and the cell shop is told about a new switch-off)."""
    key = compact_nr(el.element_nr)
    if not key:
        return
    later = (
        db.query(models.Element)
        .filter(models.Element.element_nr == el.element_nr, models.Element.id != el.id, models.Element.assembly_date > el.assembly_date)
        .first()
        if el.assembly_date
        else None
    )
    if later is not None:  # an older life was edited
        return
    opened = [r for r in _open_cell_requests(db, el.element_nr) if r.element_id in (None, el.id)]
    if el.disassembly_date and not had_disassembly:
        for r in opened:
            r.decision = r.decision or "disassemble"
            if r.decommission_date is None:
                r.decommission_date = svc._as_date(el.decommissioning_date)
            _cell_move(db, r, "completed", "assembly_data", actor, None, {"choice": "disassemble"}, also=("operation", "cellshop"))
        inspection_on_disassembly(db, el, actor)
        return
    if not el.decommissioning_date or had_decommission or el.disassembly_date:
        return
    day = svc._as_date(el.decommissioning_date)
    for r in opened:
        if r.status == "await_shutdown":
            r.decommission_date = day
            _cell_move(db, r, "await_shop", "assembly_data", actor, None, {"date": _iso(day)})
    if opened or _open_cell_requests(db, el.element_nr) or day is None:
        return
    if not (0 <= (date.today() - day).days <= AUTO_REQUEST_DAYS):
        return
    seq = _next_seq(db, WfCellRequest.seq)
    r = WfCellRequest(
        code=_code("CR", date.today(), seq),
        seq=seq,
        status="await_shop",
        element_nr=str(el.element_nr)[:50],
        element_id=el.id,
        electrolyzer=format_electrolyzer_name(el.electrolyzer) if el.electrolyzer else None,
        position=el.position,
        reason=((el.decommission_reason or "").strip() or "Assembly Data")[:800],
        decommission_date=day,
        created_by_id=actor.id,
        created_by_name=_display(actor),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(r)
    db.flush()
    _event(db, "cell", r, "auto_created", actor, None, None, {"date": _iso(day)})
    _notify(db, "cell", r, actor)


# ------------------------------------------------------------------ element inspection (C-90 -> inspection)


def _can_request_inspection(db: Session, user: models.User) -> bool:
    return user.role == "admin" or bool(_groups(db, user) & {"c90", "cellshop"})


def _report_index(db: Session) -> dict[tuple[str, str], list[tuple[date | None, int]]]:
    """(anode | cathode | element, compact nr) -> [(inspection day, report id)] of every Element Inspection."""
    R = models.InspectionReport
    out: dict[tuple[str, str], list[tuple[date | None, int]]] = {}
    for rid, day, a, c, ea, ec, el in db.query(R.id, R.inspection_date, R.anode_nr, R.cathode_nr, R.electrode_nr_anode, R.electrode_nr_cathode, R.element_nr):
        d = svc._as_date(day)
        for kind, value in (("anode", a), ("anode", ea), ("cathode", c), ("cathode", ec), ("element", el)):
            k = compact_nr(value)
            if k and (d, rid) not in out.setdefault((kind, k), []):
                out[(kind, k)].append((d, rid))
    return out


def _last_disassembly(db: Session) -> dict[tuple[str, str], date]:
    E = models.Element
    out: dict[tuple[str, str], date] = {}
    for a, c, off in db.query(E.anode_nr, E.cathode_nr, E.disassembly_date).filter(E.disassembly_date.isnot(None)):
        d = svc._as_date(off)
        for kind, value in (("anode", a), ("cathode", c)):
            k = compact_nr(value)
            if k and d and (out.get((kind, k)) is None or d > out[(kind, k)]):
                out[(kind, k)] = d
    return out


def _pick_report(index: dict, kind: str, key: str, after: date | None) -> int | None:
    """Newest report of the piece made since its last dismantling (an undated report counts)."""
    hits = [h for h in index.get((kind, key), []) if after is None or h[0] is None or h[0] >= after]
    return max(hits, key=lambda h: (h[0] or date.min, h[1]))[1] if hits else None


def _report_brief(db: Session, report_id: int | None) -> dict | None:
    r = db.get(models.InspectionReport, report_id) if report_id else None
    if r is None:
        return None
    return {"id": r.id, "element_nr": r.element_nr, "date": _iso(svc._as_date(r.inspection_date)), "inspector": r.inspector_name or r.sign_insp_name}


def coating_inspections(db: Session, items: list[WfCoatingItem]) -> dict[int, dict | None]:
    """Recoating item id -> the Element Inspection form attached to that piece (None when missing)."""
    if not items:
        return {}
    index, off = _report_index(db), _last_disassembly(db)
    out: dict[int, dict | None] = {}
    for it in items:
        key = compact_nr(it.serial)
        out[it.id] = _report_brief(db, _pick_report(index, it.element_kind, key, off.get((it.element_kind, key))))
    return out


def _open_inspection_by_serial(db: Session) -> dict[tuple[str, str], dict]:
    out: dict[tuple[str, str], dict] = {}
    for r in db.query(WfInspectionRequest).filter(WfInspectionRequest.status.notin_(CLOSED)):
        brief = {"id": r.id, "code": r.code, "status": r.status}
        for kind, value in (("anode", r.anode_nr), ("cathode", r.cathode_nr)):
            if compact_nr(value):
                out[(kind, compact_nr(value))] = brief
    return out


def _insp_summary(db: Session, r: WfInspectionRequest, conf: dict | None = None) -> dict:
    return {
        "flow": "inspection",
        "id": r.id,
        "title": _title("inspection", r, db),
        "code": r.code,
        "codes": [r.code],
        "status": r.status,
        "groups": INSPECTION_STAGES.get(r.status, []),
        "element_nr": r.element_nr,
        "element_id": r.element_id,
        "electrolyzer": r.electrolyzer,
        "position": r.position,
        "anode_nr": r.anode_nr,
        "cathode_nr": r.cathode_nr,
        "membrane_nr": r.membrane_nr,
        "disassembly_date": _iso(r.disassembly_date),
        "reason": _plant_reason(db, r.element_nr, r.element_id) or r.reason,
        "report_id": r.report_id,
        "anode_count": 1 if r.anode_nr else 0,
        "cathode_count": 1 if r.cathode_nr else 0,
        "company_id": None,
        "company_name": None,
        "indent_no": None,
        "dispatch_date": _iso(r.disassembly_date),
        "expected_date": None,
        "actual_date": None,
        "delay_days": None,
        "created_by": r.created_by_name,
        "created_at": _iso(r.created_at),
        "updated_at": _iso(r.updated_at),
        "last_note": r.last_note,
        **_sla_fields(db, "inspection", r, conf),
    }


def _piece_kinds(r: WfInspectionRequest) -> list[str]:
    kinds = [k for k, value in (("anode", r.anode_nr), ("cathode", r.cathode_nr)) if (value or "").strip()]
    return kinds or ["anode", "cathode"]


def _decision_map(r: WfInspectionRequest) -> dict:
    raw = r.decisions if isinstance(r.decisions, dict) else {}
    return raw


def _side_ready(dec: dict, side: str, kinds: list[str]) -> bool:
    block = dec.get(side) if isinstance(dec.get(side), dict) else {}
    for kind in kinds:
        item = block.get(kind) if isinstance(block.get(kind), dict) else {}
        if not str(item.get("result") or "").strip():
            return False
    return True


def _cell_card(db: Session, r: WfInspectionRequest) -> dict | None:
    el = db.get(models.Element, r.element_id) if r.element_id else _life_of(db, element_nr=r.element_nr)
    if el is None:
        return None
    return {
        "assembly_date": _iso(el.assembly_date),
        "commissioning_date": _iso(el.commissioning_date),
        "decommissioning_date": _iso(el.decommissioning_date),
        "disassembly_date": _iso(el.disassembly_date),
        "membrane_type": el.membrane_type,
        "gap_mm": el.gap_mm,
        "anode_coating": el.anode_coating,
        "cathode_coating": el.cathode_coating,
        "anode_remark": el.anode_remark,
        "cathode_remark": el.cathode_remark,
        "decommission_reason": el.decommission_reason,
        "dol_days": el.dol_days,
    }


def _finish_if_both(db: Session, r: WfInspectionRequest, actor: Any) -> bool:
    """The request stays open until the inspector form is attached and both groups have judged anode and cathode."""
    if r.status in CLOSED or not r.report_id:
        return False
    kinds = _piece_kinds(r)
    dec = _decision_map(r)
    if not (_side_ready(dec, "inspection", kinds) and _side_ready(dec, "process", kinds)):
        return False
    _insp_move(db, r, "completed", "both_confirmed", actor, None, {"report_id": r.report_id})
    return True


def _attach_report(db: Session, r: WfInspectionRequest, report_id: int, actor: Any, note: str | None = None) -> None:
    r.report_id = report_id
    r.updated_at = _now()
    _event(db, "inspection", r, "report_filled", actor, r.status, note, {"report_id": report_id})
    _sync_inspection_segregation(db, r)
    if not _finish_if_both(db, r, actor):
        _notify(db, "inspection", r, actor)


def _insp_actions(db: Session, r: WfInspectionRequest, user: models.User) -> list[str]:
    groups = _groups(db, user)
    acts: list[str] = []
    if r.status == "await_request" and "c90" in groups:
        acts.append("send")
    if r.status == "await_inspection" and "inspection" in groups:
        acts += ["fill", "link", "decide_inspection"]
    if r.status == "await_inspection" and "process" in groups:
        acts.append("decide_process")
    early = (r.status == "await_request" and "c90" in groups) or (r.status == "await_inspection" and ("c90" in groups or r.created_by_id == user.id))
    managed = _can_manage(db, user, "inspection", r.status)
    if _can_cancel(user, r.status, r.created_by_id, "await_request", also=early or managed):
        acts.append("cancel")
    if managed:
        acts.append("edit")
    if r.status not in CLOSED and (groups or r.created_by_id == user.id):
        acts += ["comment", "attach"]
    return acts


def _insp_candidates(db: Session, r: WfInspectionRequest) -> list[dict]:
    """Element Inspection forms that could belong to this request (same element, anode or cathode)."""
    index = _report_index(db)
    ids: set[int] = set()
    for kind, value in (("element", r.element_nr), ("anode", r.anode_nr), ("cathode", r.cathode_nr)):
        for day, rid in index.get((kind, compact_nr(value)), []) if compact_nr(value) else []:
            if r.disassembly_date is None or day is None or day >= r.disassembly_date:
                ids.add(rid)
    return [b for b in (_report_brief(db, i) for i in sorted(ids, reverse=True)[:20]) if b]


def _insp_detail(db: Session, r: WfInspectionRequest, user: models.User) -> dict:
    data = _insp_summary(db, r)
    data.update(
        {
            "completed_at": _iso(r.completed_at),
            "remarks": None,
            "anode_xrf": _latest_xrf(db, r.anode_nr),
            "cathode_xrf": _latest_xrf(db, r.cathode_nr),
            "report": _report_brief(db, r.report_id),
            "decisions": _decision_map(r),
            "cell": _cell_card(db, r),
            "candidates": _insp_candidates(db, r) if r.status not in CLOSED else [],
            "files": _files(db, "inspection", r.id),
            "events": _events(db, "inspection", r.id),
            "actions": _insp_actions(db, r, user),
        }
    )
    return data


def _load_insp(db: Session, request_id: int) -> WfInspectionRequest:
    r = db.get(WfInspectionRequest, request_id)
    if not r:
        raise HTTPException(404, "Inspection request not found")
    return r


def _insp_move(db: Session, r: WfInspectionRequest, to_status: str, action: str, actor: Any, note: str | None = None, data: dict | None = None) -> None:
    before = r.status
    r.status = to_status
    if to_status in CLOSED:
        r.completed_at = _now()
    _event(db, "inspection", r, action, actor, before, note, data)
    extra = _members(db, ["c90"]) if to_status in CLOSED else set()
    if r.created_by_id:
        extra.add(r.created_by_id)
    _notify(db, "inspection", r, actor, extra)


def _life_of(db: Session, element_nr: str | None = None, kind: str | None = None, serial: str | None = None) -> models.Element | None:
    """Latest Assembly Data row of an element, or the latest one an anode / cathode was mounted in."""
    E = models.Element
    if element_nr:
        key = compact_nr(element_nr)
        rows = [e for e in db.query(E).filter(func.upper(func.replace(E.element_nr, " ", "")) == key)]
    elif kind and serial:
        col = E.anode_nr if kind == "anode" else E.cathode_nr
        rows = db.query(E).filter(func.upper(func.replace(col, " ", "")) == compact_nr(serial)).all()
    else:
        return None
    return max(rows, key=svc._life_key) if rows else None


def _open_insp_for(db: Session, element_nr: str | None, anode_nr: str | None, cathode_nr: str | None) -> WfInspectionRequest | None:
    keys = {("e", compact_nr(element_nr)), ("a", compact_nr(anode_nr)), ("c", compact_nr(cathode_nr))} - {("e", ""), ("a", ""), ("c", "")}
    for r in db.query(WfInspectionRequest).filter(WfInspectionRequest.status.notin_(CLOSED)):
        mine = {("e", compact_nr(r.element_nr)), ("a", compact_nr(r.anode_nr)), ("c", compact_nr(r.cathode_nr))}
        if keys & mine:
            return r
    return None


def _new_insp(
    db: Session, actor: Any, status: str, el: models.Element | None, *, element_nr: str | None = None,
    anode_nr: str | None = None, cathode_nr: str | None = None, reason: str | None = None,
) -> WfInspectionRequest:
    seq = _next_seq(db, WfInspectionRequest.seq)
    r = WfInspectionRequest(
        code=_code("IN", date.today(), seq),
        seq=seq,
        status=status,
        element_nr=(str(el.element_nr) if el is not None and el.element_nr else element_nr or None),
        element_id=el.id if el is not None else None,
        electrolyzer=format_electrolyzer_name(el.electrolyzer) if el is not None and el.electrolyzer else None,
        position=el.position if el is not None else None,
        anode_nr=(el.anode_nr if el is not None else None) or anode_nr,
        cathode_nr=(el.cathode_nr if el is not None else None) or cathode_nr,
        membrane_nr=el.membrane_nr if el is not None else None,
        disassembly_date=svc._as_date(el.disassembly_date) if el is not None else None,
        reason=(reason or "").strip()[:800] or None,
        created_by_id=getattr(actor, "id", None),
        created_by_name=_display(actor),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(r)
    db.flush()
    remember(db, "inspection", r.id, {"report_id": None})
    return r


def _close_if_reported(db: Session, r: WfInspectionRequest, actor: Any) -> bool:
    found = _insp_candidates(db, r)
    if not found:
        return False
    _attach_report(db, r, found[0]["id"], actor)
    return True


class InspCreateIn(BaseModel):
    element_nr: str | None = None
    anode_nr: str | None = None
    cathode_nr: str | None = None
    reason: str | None = None
    note: str | None = None


@router.get("/inspection")
def list_inspection_requests(
    status: str | None = None,
    open_only: bool = False,
    serial: str | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_view(db, user, INSPECTION_VIEW_KEYS)
    q = db.query(WfInspectionRequest).order_by(WfInspectionRequest.created_at.desc())
    if status:
        q = q.filter(WfInspectionRequest.status == status)
    if open_only:
        q = q.filter(WfInspectionRequest.status.notin_(CLOSED))
    rows = q.limit(2000).all()
    if serial:
        key = compact_nr(serial)
        rows = [r for r in rows if key in {compact_nr(r.element_nr), compact_nr(r.anode_nr), compact_nr(r.cathode_nr)}]
    conf = sla_config(db)
    return [_insp_summary(db, r, conf) for r in rows[:500]]


@router.get("/inspection/{request_id}")
def get_inspection_request(request_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user, INSPECTION_VIEW_KEYS)
    return _insp_detail(db, _load_insp(db, request_id), user)


@router.post("/inspection")
def create_inspection_request(body: InspCreateIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """C-90 (or the cell shop) asks inspection for the Element Inspection form of an element, anode or cathode."""
    if not _can_request_inspection(db, user):
        raise HTTPException(403, "Only C-90 or the cell shop can ask for an Element Inspection")
    el = None
    if (body.element_nr or "").strip():
        el = _life_of(db, element_nr=body.element_nr)
        if el is None:
            raise HTTPException(404, f"Element {body.element_nr} is not in Assembly Data")
    elif (body.anode_nr or "").strip():
        el = _life_of(db, kind="anode", serial=body.anode_nr)
    elif (body.cathode_nr or "").strip():
        el = _life_of(db, kind="cathode", serial=body.cathode_nr)
    else:
        raise HTTPException(400, "Enter the element, anode or cathode number")
    existing = _open_insp_for(db, el.element_nr if el is not None else None, body.anode_nr or (el.anode_nr if el else None), body.cathode_nr or (el.cathode_nr if el else None))
    if existing:
        raise HTTPException(409, f"Inspection request {existing.code} is still open for this element")
    r = _new_insp(db, user, "await_inspection", el, anode_nr=(body.anode_nr or "").strip() or None, cathode_nr=(body.cathode_nr or "").strip() or None, reason=body.reason)
    _event(db, "inspection", r, "created", user, None, body.note, {"reason": r.reason})
    if not _close_if_reported(db, r, user):
        _notify(db, "inspection", r, user)
    db.commit()
    return _insp_detail(db, r, user)


@router.post("/inspection/{request_id}/send")
def inspection_send(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_insp(db, request_id)
    _require_stage(db, user, "inspection", r.status, ("await_request",))
    if not _close_if_reported(db, r, user):
        _insp_move(db, r, "await_inspection", "send", user, body.note)
    db.commit()
    return _insp_detail(db, r, user)


class InspLinkIn(NoteIn):
    report_id: int


@router.post("/inspection/{request_id}/link")
def inspection_link(request_id: int, body: InspLinkIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_insp(db, request_id)
    _require_stage(db, user, "inspection", r.status, ("await_inspection",))
    if body.report_id not in {c["id"] for c in _insp_candidates(db, r)}:
        raise HTTPException(400, "This Element Inspection form is not for this element (or it is older than the disassemble)")
    if "link" not in _insp_actions(db, r, user):
        raise HTTPException(403, "Only inspection can attach the Element Inspection form")
    _attach_report(db, r, body.report_id, user, body.note)
    db.commit()
    return _insp_detail(db, r, user)


class PieceCall(BaseModel):
    usable: bool | None = None
    quality: str | None = None
    problem: str | None = None
    warranty: bool | None = None
    problems: str = ""
    result: str = ""
    healthy: bool = False
    xrf: str | None = None


class InspDecideIn(NoteIn):
    side: str
    anode: PieceCall | None = None
    cathode: PieceCall | None = None


def _normalize_piece(piece: PieceCall, kind: str, side: str = "process") -> dict:
    """One anode or cathode. Inspection records XRF and a comment. Process records the final path."""
    note = (piece.problems or "").strip()[:500]
    if side == "inspection" and piece.usable is None and not piece.quality and not piece.problem:
        xrf = (piece.xrf or "").strip()[:100]
        if not xrf and not note:
            raise HTTPException(400, f"Enter the XRF value and the inspection comment for the {kind}")
        if not xrf:
            raise HTTPException(400, f"Enter the XRF value for the {kind}")
        if not note:
            raise HTTPException(400, f"Enter the inspection comment for the {kind}")
        return {"xrf": xrf, "problems": note, "result": f"XRF {xrf} — {note}", "usable": None}
    if piece.usable is None and (piece.result or "").strip() and not piece.quality and not piece.problem:
        text = piece.result.strip()[:300]
        return {"healthy": bool(piece.healthy), "result": text, "problems": note}
    if piece.usable:
        quality = (piece.quality or "").strip().lower()
        if quality not in ("good", "medium"):
            raise HTTPException(400, f"Choose coating quality (good or medium) for the {kind}")
        phrase = "قابل استفاده / کیفیت پوشش خوب" if quality == "good" else "قابل استفاده / کیفیت پوشش متوسط"
        return {
            "usable": True,
            "healthy": True,
            "quality": quality,
            "problem": None,
            "warranty": None,
            "problems": note,
            "result": phrase,
        }
    problem = (piece.problem or "").strip().lower()
    if problem not in ("coating", "mechanical", "rate_off"):
        raise HTTPException(400, f"Choose the problem (mechanical, coating or rate off) for the {kind}")
    warranty = None
    if problem in ("coating", "mechanical"):
        if piece.warranty is None:
            raise HTTPException(400, f"Say whether the {kind} is under warranty")
        warranty = bool(piece.warranty)
    label = {"coating": "coating problem", "mechanical": "mechanical problem", "rate_off": "rate off"}[problem]
    war = ""
    if warranty is True:
        war = " / تحت گارانتی"
    elif warranty is False:
        war = " / بدون گارانتی"
    return {
        "usable": False,
        "healthy": False,
        "quality": None,
        "problem": problem,
        "warranty": warranty,
        "problems": note,
        "result": f"غیر قابل استفاده / {label}{war}",
    }


def _flow_fields(rec: dict) -> dict:
    """Texts classify() already understands, so the TAFKIK flowchart lights the same path."""
    if rec.get("usable"):
        quality = "خوب" if rec.get("quality") == "good" else "متوسط"
        return {
            "decision": "قابل استفاده",
            "coating_quality": quality,
            "warranty": None,
            "segregation": f"کیفیت پوشش دهی {quality}",
        }
    if rec.get("problem") == "rate_off":
        return {"decision": "خارج از رده", "coating_quality": None, "warranty": None, "segregation": "خارج از رده"}
    war = "تحت گارانتی" if rec.get("warranty") else "بدون گارانتی"
    if rec.get("problem") == "mechanical":
        return {
            "decision": "mechanical problem",
            "coating_quality": None,
            "warranty": war,
            "segregation": f"مشکل مکانیکی — {war}",
        }
    return {
        "decision": "coating problem",
        "coating_quality": None,
        "warranty": war,
        "segregation": f"مشکل پوشش — {war}",
    }


def _same_path(left: dict | None, right: dict | None) -> bool:
    if not left or not right or "usable" not in left or "usable" not in right:
        return False
    keys = ("usable", "quality", "problem", "warranty")
    return tuple(left.get(k) for k in keys) == tuple(right.get(k) for k in keys)


def _sync_inspection_segregation(db: Session, r: WfInspectionRequest) -> None:
    """Write each anode and cathode onto Electrode segregation, linked to this request and its inspection form."""
    dec = _decision_map(r)
    kinds = _piece_kinds(r)
    report = db.get(models.InspectionReport, r.report_id) if r.report_id else None
    form_serial = None
    if report is not None:
        form_serial = (report.client or "").strip() or f"IR-{report.id}"
    marker = f"WF {r.code}"
    for kind in kinds:
        serial = (r.anode_nr if kind == "anode" else r.cathode_nr) or ""
        serial = serial.strip()
        if not serial:
            continue
        inspection = (dec.get("inspection") or {}).get(kind) if isinstance(dec.get("inspection"), dict) else None
        process = (dec.get("process") or {}).get(kind) if isinstance(dec.get("process"), dict) else None
        inspection = inspection if isinstance(inspection, dict) else None
        process = process if isinstance(process, dict) else None
        if not inspection and not process:
            continue
        inspection_note = bool(inspection and (inspection.get("xrf") or inspection.get("problems") or "usable" in inspection))
        process_note = bool(process and "usable" in process)
        if not inspection_note and not process_note:
            continue
        # The process wording is the final segregation decision.
        if process and "usable" in process:
            chosen = process
        elif inspection and "usable" in inspection:
            chosen = inspection
        else:
            chosen = None
        flow = _flow_fields(chosen) if chosen and "usable" in chosen else None
        notes = []
        for label, block in (("بازرسی", inspection), ("فرآیند", process)):
            text = str((block or {}).get("problems") or "").strip()
            if text:
                notes.append(f"{label}: {text}")
        lines = [marker]
        for label, block in (("Inspection", inspection), ("Process", process)):
            lines.append(f"{label}: {(block or {}).get('result') or '—'}")
        remarks = "\n".join(lines)
        match = compact_eq(models.ElectrodeSegregation.serial_nr, serial)
        existing = None
        if match is not None:
            for row in (
                db.query(models.ElectrodeSegregation)
                .filter(match)
                .order_by(models.ElectrodeSegregation.id.desc())
                .all()
            ):
                blob = f"{row.remarks or ''}\n{row.inspection_form_serial or ''}"
                if marker in blob or (r.code and r.code == (row.inspection_form_serial or "")):
                    existing = row
                    break
        fields = enrich_segregation_fields(
            db,
            serial_nr=serial,
            electrode_kind=kind,
            preserve_service_life=existing.service_life if existing is not None else None,
        )
        if flow:
            fields.update(flow)
        prev_w = ((existing.warranty if existing is not None else None) or "").strip()
        if len(prev_w) >= 10 and prev_w[4:5] == "-" and prev_w[7:8] == "-":
            incoming = (fields.get("warranty") or "").strip()
            if not incoming or incoming in prev_w:
                fields["warranty"] = prev_w[:100]
            else:
                fields["warranty"] = f"{prev_w} / {incoming}"[:100]
        if inspection and inspection.get("xrf"):
            fields["xrf"] = inspection["xrf"]
            if report is not None:
                if kind == "anode":
                    report.xrf_anode = inspection["xrf"]
                elif kind == "cathode":
                    report.xrf_cathode = inspection["xrf"]
        fields["electrode_kind"] = kind
        fields["serial_nr"] = serial
        fields["inspection_date"] = date_type.today()
        fields["inspection_form_serial"] = form_serial or r.code
        fields["remarks"] = remarks
        if not fields.get("service_life"):
            life = format_service_life(fields.get("install_date"), fields.get("decommission_date") or fields.get("disassemble_date"))
            if life:
                fields["service_life"] = life
        # The cell that was dismantled, even when the newest assembly row has no electrolyzer yet.
        fields.update(
            disassembly_monitoring(
                db,
                element_nr=r.element_nr,
                electrolyzer=r.electrolyzer,
                position=r.position,
                on=r.disassembly_date or fields.get("disassemble_date") or fields.get("decommission_date"),
            )
        )
        if notes:
            base = str(fields.get("problems") or "").strip()
            joined = "\n".join(notes)
            fields["problems"] = f"{joined}\n{base}".strip() if base and base not in joined else joined
        cols = {c.key for c in models.ElectrodeSegregation.__table__.columns}
        row = existing or models.ElectrodeSegregation(serial_nr=serial, electrode_kind=kind)
        for key, value in fields.items():
            if key not in cols or key == "id":
                continue
            if value is None and key not in {"decision", "coating_quality", "warranty", "segregation"} and existing is not None:
                continue
            setattr(row, key, value)
        spelled = link_serial(db, kind, serial)
        if spelled:
            row.serial_nr = spelled
        if existing is None:
            db.add(row)
        db.flush()
        if chosen and chosen.get("problem") == "mechanical":
            maintenance_from_inspection(
                db,
                kind=kind,
                serial=spelled or serial,
                finding=str(chosen.get("result") or "mechanical problem"),
                action="\n".join(notes) or None,
                day=date_type.today(),
            )


@router.post("/inspection/{request_id}/decide")
def inspection_decide(request_id: int, body: InspDecideIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Inspector and process each place the anode and the cathode on the segregation flowchart."""
    r = _load_insp(db, request_id)
    if r.status != "await_inspection":
        raise HTTPException(409, "The anode and cathode decision is only open while inspection and process are both working")
    if body.side not in ("inspection", "process"):
        raise HTTPException(400, "Choose inspection or process")
    if body.side not in _groups(db, user):
        raise HTTPException(403, "This decision belongs to the other group")
    kinds = _piece_kinds(r)
    block: dict = {}
    for kind in kinds:
        piece = body.anode if kind == "anode" else body.cathode
        if piece is None:
            raise HTTPException(400, f"Choose the status of the {kind}")
        block[kind] = _normalize_piece(piece, kind, body.side)
    r.decisions = {**_decision_map(r), body.side: block}
    r.updated_at = _now()
    _event(db, "inspection", r, "piece_decision", user, r.status, body.note, {"side": body.side, **block})
    _sync_inspection_segregation(db, r)
    if not _finish_if_both(db, r, user):
        _notify(db, "inspection", r, user)
    db.commit()
    return _insp_detail(db, r, user)


@router.post("/inspection/{request_id}/comment")
def inspection_comment(request_id: int, body: CellCommentIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_insp(db, request_id)
    if "comment" not in _insp_actions(db, r, user):
        raise HTTPException(403, "Only the requester and the workflow groups can write on this request")
    text = body.note.strip()
    _event(db, "inspection", r, "comment", user, r.status, text)
    extra = _members(db, ["c90", "inspection"])
    if r.created_by_id:
        extra.add(r.created_by_id)
    _notify(db, "inspection", r, user, extra)
    db.commit()
    return _insp_detail(db, r, user)


@router.post("/inspection/{request_id}/cancel")
def inspection_cancel(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_insp(db, request_id)
    if "cancel" not in _insp_actions(db, r, user):
        raise HTTPException(409, "Only the requester can cancel a new inspection request, or an admin at any open step")
    if user.role == "admin" and not (body.note or "").strip():
        raise HTTPException(400, "Write why this request is cancelled")
    if user.role != "admin" and not (body.note or "").strip():
        raise HTTPException(400, "Write why the inspection is not needed")
    rollback_inspection(db, r)
    _insp_move(db, r, "cancelled", "cancel", user, body.note)
    db.commit()
    return _insp_detail(db, r, user)


@router.post("/coating/{batch_id}/request_inspections")
def coating_request_inspections(batch_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """C-90 asks inspection for the missing Element Inspection forms of a recoating request in one go."""
    b = _load_batch(db, batch_id)
    if "request_inspections" not in _coating_actions(db, b, user):
        raise HTTPException(403, "Only C-90 can ask for inspections before the pieces are sent")
    items = _batch_items(db, b)
    forms = coating_inspections(db, items)
    codes = _title("coating", b, db)
    made = 0
    for it in items:
        if forms.get(it.id):
            continue
        a = it.serial if it.element_kind == "anode" else None
        c = it.serial if it.element_kind == "cathode" else None
        el = _life_of(db, kind=it.element_kind, serial=it.serial)
        if _open_insp_for(db, None, a, c):
            continue
        r = _new_insp(db, user, "await_inspection", el, anode_nr=a, cathode_nr=c, reason=f"Recoating {codes}")
        _event(db, "inspection", r, "created", user, None, body.note, {"coating_id": b.id})
        _notify(db, "inspection", r, user)
        made += 1
    _event(db, "coating", b, "request_inspections", user, b.status, body.note, {"count": made})
    db.commit()
    return {"created": made, "detail": _coating_detail(db, b, user)}


class _System:
    """Actor for changes that come from a saved form rather than a workflow button."""

    def __init__(self, name: str):
        self.id = None
        self.full_name = name
        self.username = name
        self.role = "system"


def inspection_on_disassembly(db: Session, el: models.Element, actor: Any) -> None:
    """A dismantled element waits in C-90's cartable until C-90 sends the inspection request."""
    day = svc._as_date(el.disassembly_date)
    if day is None or not (0 <= (date.today() - day).days <= AUTO_REQUEST_DAYS):
        return
    from .work_orders import ensure_work_order_for_disassembly

    ensure_work_order_for_disassembly(db, el.element_nr or "", actor, disassemble_date=day)
    if _open_insp_for(db, el.element_nr, el.anode_nr, el.cathode_nr):
        return
    done = db.query(WfInspectionRequest).filter(WfInspectionRequest.element_id == el.id, WfInspectionRequest.status.in_(CLOSED)).first()
    if done is not None:
        return
    r = _new_insp(db, actor, "await_request", el, reason=(el.decommission_reason or "").strip()[:800] or "Dismantled")
    _event(db, "inspection", r, "auto_created", actor, None, None, {"date": _iso(svc._as_date(el.disassembly_date))})
    if not _close_if_reported(db, r, actor):
        _notify(db, "inspection", r, actor)


def inspection_on_element_dismantled(db: Session, element_nr: str, actor: Any) -> None:
    el = _life_of(db, element_nr=element_nr)
    if el is not None:
        inspection_on_disassembly(db, el, actor)


def inspection_report_saved(db: Session, report: models.InspectionReport) -> None:
    """crud after_save hook: an Element Inspection saved for an element closes its open inspection request."""
    db.flush()
    keys = {("e", compact_nr(report.element_nr)), ("a", compact_nr(report.anode_nr)), ("a", compact_nr(report.electrode_nr_anode)),
            ("c", compact_nr(report.cathode_nr)), ("c", compact_nr(report.electrode_nr_cathode))}
    keys = {k for k in keys if k[1]}
    if not keys:
        return
    day = svc._as_date(report.inspection_date)
    actor = _System(report.inspector_name or report.sign_insp_name or "Element Inspection")
    for r in db.query(WfInspectionRequest).filter(WfInspectionRequest.status.notin_(CLOSED)).all():
        mine = {("e", compact_nr(r.element_nr)), ("a", compact_nr(r.anode_nr)), ("c", compact_nr(r.cathode_nr))}
        if not keys & mine:
            continue
        if r.disassembly_date and day and day < r.disassembly_date:
            continue
        _attach_report(db, r, report.id, actor)


# ------------------------------------------------------------------ assemble a new element (C-90 -> inspection/process -> cell)


def _can_request_assemble(db: Session, user: models.User) -> bool:
    return user.role == "admin" or "c90" in _groups(db, user)


def _load_assemble(db: Session, request_id: int) -> WfAssembleRequest:
    r = db.get(WfAssembleRequest, request_id)
    if not r:
        raise HTTPException(404, "Assemble request not found")
    return r


def _assemble_summary(db: Session, r: WfAssembleRequest, conf: dict | None = None) -> dict:
    return {
        "flow": "assemble",
        "id": r.id,
        "title": _title("assemble", r, db),
        "code": r.code,
        "codes": [r.code],
        "status": r.status,
        "groups": ASSEMBLE_STAGES.get(r.status, []),
        "element_nr": r.element_nr,
        "element_id": r.element_id,
        "electrolyzer": r.electrolyzer,
        "position": r.position,
        "anode_nr": r.anode_nr,
        "cathode_nr": r.cathode_nr,
        "membrane_nr": r.membrane_nr,
        "membrane_type": r.membrane_type,
        "anode_source": r.anode_source,
        "cathode_source": r.cathode_source,
        "assembly_date": _iso(r.assembly_date),
        "reason": None,
        "anode_count": 1 if r.anode_nr else 0,
        "cathode_count": 1 if r.cathode_nr else 0,
        "company_id": None,
        "company_name": None,
        "indent_no": None,
        "dispatch_date": _iso(r.assembly_date),
        "expected_date": None,
        "actual_date": None,
        "delay_days": None,
        "created_by": r.created_by_name,
        "created_at": _iso(r.created_at),
        "updated_at": _iso(r.updated_at),
        "last_note": r.last_note,
        **_sla_fields(db, "assemble", r, conf),
    }


def _assemble_decisions(r: WfAssembleRequest) -> dict:
    return r.decisions if isinstance(r.decisions, dict) else {}


def _air_signed(report: models.AssemblyInspectionReport | None, side: str) -> bool:
    if report is None:
        return False
    name = (getattr(report, f"sign_{side}_name", None) or "").strip()
    image = (getattr(report, f"sign_{side}_image", None) or "").strip()
    return bool(name or image)


def _json_map(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _air_filled(report: models.AssemblyInspectionReport | None) -> bool:
    """True once C-90 has saved real content on the paper form (not the empty skeleton)."""
    if report is None:
        return False
    if any(_air_signed(report, side) for side in ("maint", "insp", "proc")):
        return True
    checks = _json_map(report.checks)
    if any(bool(v) for v in checks.values()):
        return True
    remarks = _json_map(report.check_remarks)
    if any(str(v or "").strip() for v in remarks.values()):
        return True
    for field in (
        "group_nr",
        "electrolyzer",
        "position",
        "spacer_thickness_anode",
        "spacer_thickness_cathode",
        "electrode_distance",
    ):
        if str(getattr(report, field, None) or "").strip():
            return True
    note = (report.remarks or "").strip()
    if note and not note.lower().startswith("workflow "):
        return True
    return False


def _clear_air_sign(report: models.AssemblyInspectionReport | None, *sides: str) -> None:
    if report is None:
        return
    for side in sides:
        setattr(report, f"sign_{side}_name", None)
        setattr(report, f"sign_{side}_image", None)
        setattr(report, f"sign_{side}_at", None)


def _pin_air(r: WfAssembleRequest, report: models.AssemblyInspectionReport | None) -> None:
    if report is None:
        return
    dec = _assemble_decisions(r)
    if dec.get("air_id") == report.id:
        return
    r.decisions = {**dec, "air_id": report.id}


def _pinned_air_id(db: Session, r: WfAssembleRequest) -> int | None:
    raw = _assemble_decisions(r).get("air_id")
    try:
        if raw is not None and str(raw).strip() != "":
            return int(raw)
    except (TypeError, ValueError):
        pass
    for ev in reversed(_events(db, "assemble", r.id)):
        data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
        aid = data.get("air_id")
        if aid is None:
            continue
        try:
            return int(aid)
        except (TypeError, ValueError):
            continue
    code = (r.code or "").strip()
    if code:
        tagged = (
            db.query(models.AssemblyInspectionReport)
            .filter(models.AssemblyInspectionReport.remarks == f"Workflow {code}")
            .order_by(models.AssemblyInspectionReport.id.desc())
            .first()
        )
        if tagged is not None:
            return tagged.id
    return None


def _air_for(db: Session, r: WfAssembleRequest) -> models.AssemblyInspectionReport | None:
    """Prefer a filled report for this element; fall back to the pinned skeleton."""
    key = compact_nr(r.element_nr)
    anode_key = compact_nr(r.anode_nr)
    cathode_key = compact_nr(r.cathode_nr)
    pinned_id = _pinned_air_id(db, r)
    pinned = db.get(models.AssemblyInspectionReport, pinned_id) if pinned_id else None
    matches: list[models.AssemblyInspectionReport] = []
    for row in db.query(models.AssemblyInspectionReport).order_by(models.AssemblyInspectionReport.id.desc()).all():
        if key and compact_nr(row.element_nr) == key:
            matches.append(row)
        elif anode_key and cathode_key and compact_nr(row.anode_nr) == anode_key and compact_nr(row.cathode_nr) == cathode_key:
            matches.append(row)
    filled = [row for row in matches if _air_filled(row)]
    cutoff = r.created_at
    recent = []
    if cutoff:
        for row in filled:
            stamp = row.updated_at or row.created_at
            if stamp and stamp >= cutoff:
                recent.append(row)
    if pinned is not None and _air_filled(pinned):
        return pinned
    if recent:
        return recent[0]
    if pinned is not None:
        return pinned
    if filled:
        return filled[0]
    return matches[0] if matches else None


def _air_brief(report: models.AssemblyInspectionReport | None) -> dict | None:
    if report is None:
        return None
    checks = _json_map(report.checks)
    done = sum(1 for v in checks.values() if v)
    return {
        "id": report.id,
        "element_nr": report.element_nr,
        "filled": _air_filled(report),
        "checks_done": done,
        "checks_total": len(checks),
        "sign_maint": _air_signed(report, "maint"),
        "sign_insp": _air_signed(report, "insp"),
        "sign_proc": _air_signed(report, "proc"),
        "sign_maint_name": report.sign_maint_name,
        "sign_insp_name": report.sign_insp_name,
        "sign_proc_name": report.sign_proc_name,
    }


def _align_air(r: WfAssembleRequest, row: models.AssemblyInspectionReport) -> None:
    """Keep the checklist tied to the element this assemble request is building."""
    if r.element_nr:
        row.element_nr = r.element_nr
    if r.anode_nr:
        row.anode_nr = r.anode_nr
    if r.cathode_nr:
        row.cathode_nr = r.cathode_nr
    if r.membrane_nr:
        row.membrane_nr = r.membrane_nr
    if r.membrane_type and not (row.membrane_type or "").strip():
        row.membrane_type = r.membrane_type
    if row.assembly_date is None and r.assembly_date:
        row.assembly_date = r.assembly_date
    _pin_air(r, row)


def _ensure_air(db: Session, r: WfAssembleRequest) -> models.AssemblyInspectionReport:
    row = _air_for(db, r)
    if row is not None:
        _align_air(r, row)
        return row
    from ..assembly_inspection_def import empty_check_remarks, empty_checks

    row = models.AssemblyInspectionReport(
        assembly_date=r.assembly_date or date.today(),
        element_nr=r.element_nr,
        anode_nr=r.anode_nr,
        cathode_nr=r.cathode_nr,
        membrane_nr=r.membrane_nr,
        membrane_type=r.membrane_type,
        checks=empty_checks(),
        check_remarks=empty_check_remarks(),
        remarks=f"Workflow {r.code}",
    )
    db.add(row)
    db.flush()
    _pin_air(r, row)
    return row


def _migrate_assemble_status(db: Session, r: WfAssembleRequest) -> bool:
    """Old dual-accept step becomes: C-90 fills AIR, then inspection sign, then process sign."""
    if r.status != "await_inspection":
        return False
    report = _air_for(db, r)
    if not _air_filled(report):
        r.status = "await_air"
    elif not _air_signed(report, "insp"):
        r.status = "await_insp_sign"
    elif not _air_signed(report, "proc"):
        r.status = "await_proc_sign"
    else:
        r.status = "await_position"
    r.updated_at = _now()
    return True


def _assemble_actions(db: Session, r: WfAssembleRequest, user: models.User) -> list[str]:
    groups = _groups(db, user)
    acts: list[str] = []
    if r.status == "await_assembly" and "c90" in groups:
        acts.append("assemble")
    if r.status == "await_air" and "c90" in groups:
        acts.append("submit_air")
    if r.status == "await_insp_sign" and "inspection" in groups:
        acts += ["sign_insp", "reject_insp", "fail_test"]
    if r.status == "await_proc_sign" and "process" in groups:
        acts += ["sign_proc", "reject_proc", "fail_test"]
    if r.status == "await_position" and "c90" in groups:
        acts.append("position")
    if r.status == "await_disassembly" and "c90" in groups:
        acts.append("disassemble")
    managed = _can_manage(db, user, "assemble", r.status)
    early = r.status == "await_air" and r.created_by_id == user.id
    if _can_cancel(user, r.status, r.created_by_id, "await_assembly", also=managed or early):
        acts.append("cancel")
    if managed:
        acts.append("edit")
    if r.status not in CLOSED and (groups or r.created_by_id == user.id):
        acts += ["comment", "attach"]
    return acts


def _assemble_detail(db: Session, r: WfAssembleRequest, user: models.User) -> dict:
    if _migrate_assemble_status(db, r):
        db.commit()
        db.refresh(r)
    report = _air_for(db, r)
    if report is not None:
        _align_air(r, report)
        db.commit()
        db.refresh(r)
    data = _assemble_summary(db, r)
    el = db.get(models.Element, r.element_id) if r.element_id else None
    data.update(
        {
            "completed_at": _iso(r.completed_at),
            "decisions": _assemble_decisions(r),
            "air": _air_brief(report),
            "element": _element_brief(el) if el is not None else None,
            "files": _files(db, "assemble", r.id),
            "events": _events(db, "assemble", r.id),
            "actions": _assemble_actions(db, r, user),
        }
    )
    return data


def _pool_row(db: Session, kind: str, serial: str) -> dict | None:
    key = compact_nr(serial)
    if not key:
        return None
    pool = assembly_pool(db)
    for source in ("reusable", "purchased", "recoated"):
        for row in pool.get(source) or []:
            if row.get("kind") == kind and compact_nr(row.get("serial")) == key:
                return row
    return None


def _open_assemble_for(db: Session, anode: str | None, cathode: str | None, exclude_id: int | None = None) -> WfAssembleRequest | None:
    a, c = compact_nr(anode), compact_nr(cathode)
    for r in db.query(WfAssembleRequest).filter(WfAssembleRequest.status.notin_(CLOSED)).all():
        if exclude_id is not None and r.id == exclude_id:
            continue
        if a and compact_nr(r.anode_nr) == a:
            return r
        if c and compact_nr(r.cathode_nr) == c:
            return r
    return None


def _element_nr_taken(db: Session, element_nr: str, exclude_assemble_id: int | None = None) -> bool:
    key = compact_nr(element_nr)
    if not key:
        return False
    for (value,) in db.query(models.Element.element_nr).all():
        if compact_nr(value) == key:
            return True
    for r in db.query(WfAssembleRequest).filter(WfAssembleRequest.status.notin_(CLOSED)).all():
        if exclude_assemble_id is not None and r.id == exclude_assemble_id:
            continue
        if compact_nr(r.element_nr) == key:
            return True
    return False


def _try_shop(db: Session, element_nr: str | None, stage: str, user: models.User, note: str | None = None) -> None:
    if not (element_nr or "").strip():
        return
    try:
        svc.set_shop_stage(db, element_nr, stage, note, _display(user))
    except ValueError:
        return


def _clear_shop(db: Session, element_nr: str | None, user: models.User, note: str | None = None) -> None:
    if not (element_nr or "").strip():
        return
    try:
        svc.set_shop_stage(db, element_nr, "clear", note, _display(user))
    except ValueError:
        return


class AssembleCreateIn(BaseModel):
    anode_nr: str
    cathode_nr: str
    membrane_nr: str | None = None
    membrane_type: str | None = None
    element_nr: str | None = None
    note: str | None = None


@router.get("/assemble")
def list_assemble_requests(
    status: str | None = None,
    open_only: bool = False,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_view(db, user, INSPECTION_VIEW_KEYS)
    q = db.query(WfAssembleRequest).order_by(WfAssembleRequest.created_at.desc())
    if status:
        q = q.filter(WfAssembleRequest.status == status)
    if open_only:
        q = q.filter(WfAssembleRequest.status.notin_(CLOSED))
    conf = sla_config(db)
    rows = q.limit(500).all()
    dirty = False
    for r in rows:
        dirty = _migrate_assemble_status(db, r) or dirty
    if dirty:
        db.commit()
    return [_assemble_summary(db, r, conf) for r in rows]


@router.get("/assemble/{request_id}")
def get_assemble_request(request_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user, INSPECTION_VIEW_KEYS)
    return _assemble_detail(db, _load_assemble(db, request_id), user)


@router.post("/assemble")
def create_assemble_request(body: AssembleCreateIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """C-90 starts a new-element assemble from assembly-stock anode and cathode."""
    if not _can_request_assemble(db, user):
        raise HTTPException(403, "Only C-90 can start assembling a new element")
    anode = (body.anode_nr or "").strip()
    cathode = (body.cathode_nr or "").strip()
    membrane = (body.membrane_nr or "").strip()
    if not anode or not cathode:
        raise HTTPException(400, "Choose the anode and the cathode from assembly stock")
    if not membrane:
        raise HTTPException(400, "Choose the membrane number")
    membrane_type = (body.membrane_type or "").strip()
    if not membrane_type:
        raise HTTPException(400, "Choose the membrane type")
    a_row = _pool_row(db, "anode", anode)
    c_row = _pool_row(db, "cathode", cathode)
    if a_row is None:
        raise HTTPException(400, f"Anode {anode} is not free in assembly stock")
    if c_row is None:
        raise HTTPException(400, f"Cathode {cathode} is not free in assembly stock")
    clash = _open_assemble_for(db, a_row["serial"], c_row["serial"])
    if clash:
        raise HTTPException(409, f"Assemble request {clash.code} already holds these pieces")
    from .elements import _next_element_nr

    element_nr = (body.element_nr or "").strip() or _next_element_nr(db)
    if _element_nr_taken(db, element_nr):
        raise HTTPException(409, f"Element {element_nr} is already in Assembly Data")
    seq = _next_seq(db, WfAssembleRequest.seq)
    r = WfAssembleRequest(
        code=_code("AS", date.today(), seq),
        seq=seq,
        status="await_assembly",
        element_nr=element_nr,
        anode_nr=a_row["serial"],
        cathode_nr=c_row["serial"],
        membrane_nr=membrane[:50],
        membrane_type=membrane_type[:100],
        anode_source=a_row.get("source"),
        cathode_source=c_row.get("source"),
        created_by_id=user.id,
        created_by_name=_display(user),
        created_at=_now(),
        updated_at=_now(),
        last_note=(body.note or "").strip() or None,
    )
    db.add(r)
    db.flush()
    from .membrane_stock import consume as consume_membrane

    consume_membrane(db, r.membrane_type, r.membrane_nr, r.element_nr, r.code, _display(user))
    remember(db, "assemble", r.id, {"element": None, "shop": None})
    _event(db, "assemble", r, "created", user, None, body.note, {"anode": r.anode_nr, "cathode": r.cathode_nr, "element_nr": r.element_nr})
    _notify(db, "assemble", r, user)
    db.commit()
    svc.clear_cache()
    return _assemble_detail(db, r, user)


class AssembleStampIn(NoteIn):
    assembly_date: str | None = None


@router.post("/assemble/{request_id}/assemble")
def assemble_stamp(request_id: int, body: AssembleStampIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """C-90 writes the assembly date and the new Assembly Data row, then fills the Assembly Inspection Report."""
    r = _load_assemble(db, request_id)
    _require_stage(db, user, "assemble", r.status, ("await_assembly",))
    day = _edit_date(body.assembly_date) if (body.assembly_date or "").strip() else date.today()
    from .elements import _next_element_nr, _sync_saved_element

    element_nr = (r.element_nr or "").strip() or _next_element_nr(db)
    if r.element_id is None and _element_nr_taken(db, element_nr, exclude_assemble_id=r.id):
        raise HTTPException(409, f"Element {element_nr} is already in Assembly Data")
    el = db.get(models.Element, r.element_id) if r.element_id else None
    if el is None:
        el = models.Element(
            element_nr=element_nr,
            anode_nr=r.anode_nr,
            cathode_nr=r.cathode_nr,
            membrane_nr=r.membrane_nr,
            membrane_type=r.membrane_type,
            assembly_date=day,
            remarks=(body.note or "").strip() or f"Assembled by {r.code}",
        )
        db.add(el)
        db.flush()
    else:
        el.anode_nr = r.anode_nr
        el.cathode_nr = r.cathode_nr
        el.membrane_nr = r.membrane_nr
        el.membrane_type = r.membrane_type
        el.assembly_date = day
    _sync_saved_element(db, el)
    r.element_id = el.id
    r.element_nr = el.element_nr
    r.anode_nr = el.anode_nr or r.anode_nr
    r.cathode_nr = el.cathode_nr or r.cathode_nr
    r.membrane_nr = el.membrane_nr
    r.assembly_date = day
    _try_shop(db, el.element_nr, "awaiting_qc", user, body.note)
    from .work_orders import ensure_work_order_process

    ensure_work_order_process(db, el.element_nr, "generation", user, day=day, note=body.note)
    air = _ensure_air(db, r)
    _pin_air(r, air)
    _move(db, "assemble", r, "await_air", "assemble", user, body.note, {"element_id": el.id, "assembly_date": _iso(day), "air_id": air.id})
    db.commit()
    svc.clear_cache()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/submit_air")
def assemble_submit_air(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """C-90 finished the Assembly Inspection Report; inspection must sign it next."""
    r = _load_assemble(db, request_id)
    _require_stage(db, user, "assemble", r.status, ("await_air",))
    report = _ensure_air(db, r)
    if not _air_filled(report):
        raise HTTPException(400, "Fill and save the Assembly Inspection Report first")
    _pin_air(r, report)
    _move(db, "assemble", r, "await_insp_sign", "submit_air", user, body.note, {"air_id": report.id})
    db.commit()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/sign_insp")
def assemble_sign_insp(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_assemble(db, request_id)
    _require_stage(db, user, "assemble", r.status, ("await_insp_sign",))
    report = _air_for(db, r)
    if not _air_signed(report, "insp"):
        raise HTTPException(400, "Inspection must sign the Assembly Inspection Report first")
    _move(db, "assemble", r, "await_proc_sign", "sign_insp", user, body.note, {"air_id": report.id if report else None})
    db.commit()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/reject_insp")
def assemble_reject_insp(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_assemble(db, request_id)
    _require_stage(db, user, "assemble", r.status, ("await_insp_sign",))
    if not (body.note or "").strip():
        raise HTTPException(400, "Write why the Assembly Inspection Report is not accepted")
    _clear_air_sign(_air_for(db, r), "insp", "proc")
    _move(db, "assemble", r, "await_air", "reject_insp", user, body.note, notify_creator=True)
    db.commit()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/sign_proc")
def assemble_sign_proc(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_assemble(db, request_id)
    _require_stage(db, user, "assemble", r.status, ("await_proc_sign",))
    report = _air_for(db, r)
    if not _air_signed(report, "proc"):
        raise HTTPException(400, "Process must sign the Assembly Inspection Report first")
    _try_shop(db, r.element_nr, "ready", user, body.note)
    _move(db, "assemble", r, "await_position", "sign_proc", user, body.note, {"air_id": report.id if report else None})
    db.commit()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/reject_proc")
def assemble_reject_proc(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_assemble(db, request_id)
    _require_stage(db, user, "assemble", r.status, ("await_proc_sign",))
    if not (body.note or "").strip():
        raise HTTPException(400, "Write why the Assembly Inspection Report is not accepted")
    _clear_air_sign(_air_for(db, r), "insp", "proc")
    _move(db, "assemble", r, "await_insp_sign", "reject_proc", user, body.note, notify_creator=True)
    db.commit()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/fail_test")
def assemble_fail_test(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """The test was negative and inspection/process refuses the element: C-90 must take it apart."""
    r = _load_assemble(db, request_id)
    _require_stage(db, user, "assemble", r.status, ("await_insp_sign", "await_proc_sign"))
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(400, "Write the result of the failed test")
    side = "inspection" if r.status == "await_insp_sign" else "process"
    decisions = dict(r.decisions or {})
    decisions[side] = {"ok": False, "result": "test_failed", "note": note}
    r.decisions = decisions
    _clear_air_sign(_air_for(db, r), "insp", "proc")
    _try_shop(db, r.element_nr, "awaiting_disassembly", user, f"{r.code}: {note}")
    _move(db, "assemble", r, "await_disassembly", "fail_test", user, note, {"by": side}, notify_creator=True)
    db.commit()
    svc.clear_cache()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/disassemble")
def assemble_disassemble(request_id: int, body: AssembleStampIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """C-90 took the failed element apart: Assembly Data is closed and both electrodes go to the Segregation table."""
    r = _load_assemble(db, request_id)
    _require_stage(db, user, "assemble", r.status, ("await_disassembly",))
    day = _edit_date(body.assembly_date) if (body.assembly_date or "").strip() else date.today()
    el = db.get(models.Element, r.element_id) if r.element_id else None
    reason = next(
        (d.get("note") for d in (r.decisions or {}).values() if isinstance(d, dict) and d.get("result") == "test_failed" and d.get("note")),
        None,
    ) or "Failed assembly test"
    if el is not None:
        from .elements import _sync_saved_element

        el.disassembly_date = day
        if el.decommissioning_date is None:
            el.decommissioning_date = day
        el.decommission_reason = f"{r.code}: {reason}"[:500]
        _sync_saved_element(db, el)
        _clear_shop(db, el.element_nr, user, f"{r.code} disassembled")
        from .work_orders import ensure_work_order_for_disassembly

        ensure_work_order_for_disassembly(db, el.element_nr or "", user, disassemble_date=day)
    marker = f"WF {r.code}"
    made: list[str] = []
    for kind, serial, pair in (("anode", r.anode_nr, r.cathode_nr), ("cathode", r.cathode_nr, r.anode_nr)):
        if not (serial or "").strip():
            continue
        fields = enrich_segregation_fields(db, serial_nr=serial, electrode_kind=kind)
        row = models.ElectrodeSegregation(
            serial_nr=serial,
            electrode_kind=kind,
            company=fields.get("company"),
            service_life=fields.get("service_life"),
            install_date=r.assembly_date,
            decommission_date=day,
            disassemble_date=day,
            pair_serial_nr=pair,
            problems=f"{reason} ({r.code})"[:1000],
            remarks=f"{marker} · {r.element_nr or ''}".strip(" ·"),
        )
        db.add(row)
        made.append(serial)
    note = (body.note or "").strip() or None
    _move(db, "assemble", r, "completed", "disassemble", user, note, {"date": _iso(day), "segregation": made})
    db.commit()
    svc.clear_cache()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/decide")
def assemble_decide_removed(request_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _load_assemble(db, request_id)
    _require_view(db, user, INSPECTION_VIEW_KEYS)
    raise HTTPException(
        409,
        "Inspection and process no longer accept this request. Sign or reject the Assembly Inspection Report instead.",
    )


class AssemblePositionIn(NoteIn):
    electrolyzer: str
    position: str


@router.post("/assemble/{request_id}/position")
def assemble_position(request_id: int, body: AssemblePositionIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_assemble(db, request_id)
    _require_stage(db, user, "assemble", r.status, ("await_position",))
    from .elements import _normalize_position, _reject_same_installation, _sync_saved_element
    from ..assembly_integrity import occupant_of_cell

    electrolyzer = format_electrolyzer_name((body.electrolyzer or "").strip())
    if not electrolyzer or electrolyzer not in {format_electrolyzer_name(n) for n in all_electrolyzers()}:
        raise HTTPException(400, f"'{body.electrolyzer}' is not an electrolyzer of this plant")
    position = _normalize_position(body.position)
    el = db.get(models.Element, r.element_id) if r.element_id else None
    if el is None:
        raise HTTPException(409, "The Assembly Data row was not written yet")
    busy = occupant_of_cell(db, electrolyzer, position, exclude_id=el.id)
    if busy is not None:
        raise HTTPException(409, f"Cell {electrolyzer}-{position} is occupied by element {busy.element_nr}")
    el.electrolyzer = electrolyzer
    el.position = position
    if el.commissioning_date is None:
        el.commissioning_date = date.today()
    if (body.note or "").strip():
        extra = (body.note or "").strip()
        el.remarks = f"{el.remarks}\n{extra}".strip() if el.remarks else extra
    _reject_same_installation(db, el)
    _sync_saved_element(db, el)
    r.electrolyzer = electrolyzer
    r.position = position
    air = _air_for(db, r)
    if air is not None:
        air.electrolyzer = electrolyzer
        air.position = position
    _clear_shop(db, el.element_nr, user, f"{electrolyzer}-{position}")
    from .work_orders import ensure_work_order_process

    ensure_work_order_process(
        db, el.element_nr, "install", user, day=date.today(), cell=f"{electrolyzer}-{position}", note=body.note
    )
    _move(db, "assemble", r, "completed", "position", user, body.note, {"electrolyzer": electrolyzer, "position": position})
    db.commit()
    svc.clear_cache()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/comment")
def assemble_comment(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_assemble(db, request_id)
    if "comment" not in _assemble_actions(db, r, user):
        raise HTTPException(403, "Only the requester and the workflow groups can write on this request")
    if not (body.note or "").strip():
        raise HTTPException(400, "Write a note")
    _event(db, "assemble", r, "comment", user, r.status, body.note)
    extra = {r.created_by_id} if r.created_by_id else set()
    _notify(db, "assemble", r, user, extra)
    db.commit()
    return _assemble_detail(db, r, user)


@router.post("/assemble/{request_id}/cancel")
def assemble_cancel(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_assemble(db, request_id)
    if "cancel" not in _assemble_actions(db, r, user):
        raise HTTPException(409, "Only C-90 or an admin can cancel this assemble request")
    _admin_cancel_note(user, body.note, required=True)
    rollback_assemble(db, r)
    _move(db, "assemble", r, "cancelled", "cancel", user, body.note, notify_creator=True)
    db.commit()
    return _assemble_detail(db, r, user)


# ------------------------------------------------------------------ files (all flows)


def _record(db: Session, flow: str, record_id: int):
    if flow == "coating":
        return _load_batch(db, record_id)
    if flow == "purchase":
        return _load_purchase(db, record_id)
    if flow == "cell":
        return _load_cell(db, record_id)
    if flow == "inspection":
        return _load_insp(db, record_id)
    if flow == "assemble":
        return _load_assemble(db, record_id)
    raise HTTPException(404, "Unknown workflow")


def _detail_for(db: Session, flow: str, record: Any, user: models.User) -> dict:
    if flow == "coating":
        return _coating_detail(db, record, user)
    if flow == "purchase":
        return _purchase_detail(db, record, user)
    if flow == "cell":
        return _cell_detail(db, record, user)
    if flow == "inspection":
        return _insp_detail(db, record, user)
    if flow == "assemble":
        return _assemble_detail(db, record, user)
    raise HTTPException(404, "Unknown workflow")


class RequestEditIn(BaseModel):
    remarks: str | None = None
    reason: str | None = None
    problem: str | None = None
    indent_no: str | None = None
    approval_ref: str | None = None
    expected_date: str | None = None


def _clip(value: str | None, limit: int) -> str | None:
    text = (value or "").strip()
    return text[:limit] or None


def _edit_date(value: str | None) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        raise HTTPException(400, "Date must be yyyy-mm-dd") from None


@router.patch("/{flow}/{record_id}")
def edit_request(
    flow: str,
    record_id: int,
    body: RequestEditIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Admin or the section supervisor of the current step may correct an open request."""
    rec = _record(db, flow, record_id)
    if not _can_manage(db, user, flow, rec.status):
        raise HTTPException(403, "Only an admin or the section supervisor can edit this request")
    data = body.model_dump(exclude_unset=True)
    changed: dict[str, Any] = {}
    if flow == "coating":
        if "remarks" in data:
            rec.remarks = _clip(data["remarks"], 4000)
            changed["remarks"] = rec.remarks
        if "indent_no" in data:
            rec.indent_no = _clip(data["indent_no"], 60)
            changed["indent_no"] = rec.indent_no
        if "expected_date" in data:
            rec.expected_return_date = _edit_date(data["expected_date"])
            changed["expected_date"] = _iso(rec.expected_return_date)
    elif flow == "purchase":
        if "remarks" in data:
            rec.remarks = _clip(data["remarks"], 4000)
            changed["remarks"] = rec.remarks
        if "indent_no" in data:
            rec.indent_no = _clip(data["indent_no"], 60)
            changed["indent_no"] = rec.indent_no
        if "approval_ref" in data:
            rec.approval_ref = _clip(data["approval_ref"], 120)
            changed["approval_ref"] = rec.approval_ref
        if "expected_date" in data:
            rec.expected_delivery_date = _edit_date(data["expected_date"])
            changed["expected_date"] = _iso(rec.expected_delivery_date)
    elif flow == "cell":
        if "reason" in data:
            reason = _clip(data["reason"], 200)
            if reason:
                rec.reason = reason
                _write_plant_reason(db, rec.element_nr, rec.element_id, reason)
                changed["reason"] = rec.reason
        if "problem" in data:
            rec.problem = _clip(data["problem"], 4000)
            changed["problem"] = rec.problem
        if "expected_date" in data:
            rec.planned_date = _edit_date(data["expected_date"])
            changed["expected_date"] = _iso(rec.planned_date)
    elif flow == "inspection":
        if "reason" in data:
            rec.reason = _clip(data["reason"], 200)
            _write_plant_reason(db, rec.element_nr, rec.element_id, rec.reason)
            changed["reason"] = rec.reason
    elif flow == "assemble":
        if "remarks" in data:
            rec.last_note = _clip(data["remarks"], 4000)
            changed["remarks"] = rec.last_note
        if "reason" in data:
            rec.last_note = _clip(data["reason"], 4000) or rec.last_note
            changed["note"] = rec.last_note
    else:
        raise HTTPException(404, "Unknown workflow")
    if not changed:
        raise HTTPException(400, "Nothing to change")
    rec.updated_at = _now()
    _event(db, flow, rec, "edit", user, rec.status, None, changed)
    db.commit()
    return _detail_for(db, flow, rec, user)


@router.post("/{flow}/{record_id}/files")
def attach_files(
    flow: str,
    record_id: int,
    note: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    rec = _record(db, flow, record_id)
    if rec.status in CLOSED:
        raise HTTPException(409, "The record is closed")
    if not _groups(db, user) and not (flow in ("cell", "inspection", "assemble") and rec.created_by_id == user.id):
        raise HTTPException(403, "Only workflow groups can attach files")
    names = []
    for up in files:
        if (up.filename or "").strip():
            row, _ = _save_upload(db, flow, rec.id, up, "attachment", user)
            names.append(row.original_name)
    if not names:
        raise HTTPException(400, "Choose a file")
    _event(db, flow, rec, "attach", user, rec.status, note, {"files": names})
    db.commit()
    return {"files": _files(db, flow, rec.id)}


@router.get("/files/{file_id}")
def download_file(file_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    f = db.get(WfFile, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    _require_view(db, user, CELL_VIEW_KEYS if f.flow == "cell" else INSPECTION_VIEW_KEYS if f.flow == "inspection" else VIEW_KEYS)
    root = (data_root() / "workflow" / f.flow / str(f.record_id)).resolve()
    path = (root / f.stored_name).resolve()
    if path.parent != root or not path.exists():
        raise HTTPException(404, "File missing on the server")
    return FileResponse(path, media_type=f.content_type, filename=f.original_name)


# ------------------------------------------------------------------ process log (every workflow, searchable by its code)


def _search_blob(*parts: object) -> str:
    return " ".join(str(part).strip() for part in parts if part is not None and str(part).strip()).lower()


def _process_index(db: Session) -> list[dict]:
    """One row per created process code: coating pallet, purchase, cell, inspection, assemble, work order."""
    companies = {c.id: c.name for c in db.query(models.WhCompany).all()}
    rows: list[dict] = []
    batches = {b.id: b for b in db.query(WfCoatingBatch).all()}
    serials: dict[int, list[str]] = {}
    for item in db.query(WfCoatingItem).all():
        serials.setdefault(item.package_id, []).append(item.serial)
    for pkg in db.query(WfCoatingPackage).order_by(WfCoatingPackage.id.desc()).all():
        batch = batches.get(pkg.batch_id)
        if batch is None:
            continue
        pieces = serials.get(pkg.id) or []
        rows.append(
            {
                "flow": "coating",
                "id": batch.id,
                "code": pkg.code,
                "status": batch.status,
                "element_nr": None,
                "summary": ", ".join(pieces[:12]),
                "actor": batch.created_by_name,
                "created_at": _iso(batch.created_at),
                "updated_at": _iso(batch.updated_at),
                "search": _search_blob(pkg.code, batch.indent_no, batch.status, batch.last_note, companies.get(batch.company_id), *pieces),
            }
        )
    buy_serials: dict[int, list[str]] = {}
    for item in db.query(WfPurchaseItem).all():
        buy_serials.setdefault(item.purchase_id, []).append(item.serial)
    for row in db.query(WfPurchase).all():
        pieces = buy_serials.get(row.id) or []
        rows.append(
            {
                "flow": "purchase",
                "id": row.id,
                "code": row.code,
                "status": row.status,
                "element_nr": None,
                "summary": ", ".join(pieces[:12]) or f"{row.anode_count} A + {row.cathode_count} K",
                "actor": row.created_by_name,
                "created_at": _iso(row.created_at),
                "updated_at": _iso(row.updated_at),
                "search": _search_blob(row.code, row.indent_no, row.approval_ref, row.status, row.last_note, companies.get(row.supplier_id), *pieces),
            }
        )
    for row in db.query(WfCellRequest).all():
        rows.append(
            {
                "flow": "cell",
                "id": row.id,
                "code": row.code,
                "status": row.status,
                "element_nr": row.element_nr,
                "summary": row.reason,
                "actor": row.created_by_name,
                "created_at": _iso(row.created_at),
                "updated_at": _iso(row.updated_at),
                "search": _search_blob(row.code, row.element_nr, row.reason, row.problem, row.status, row.electrolyzer, row.position, row.last_note),
            }
        )
    for row in db.query(WfInspectionRequest).all():
        rows.append(
            {
                "flow": "inspection",
                "id": row.id,
                "code": row.code,
                "status": row.status,
                "element_nr": row.element_nr,
                "summary": " / ".join(bit for bit in (row.anode_nr, row.cathode_nr) if bit),
                "actor": row.created_by_name,
                "created_at": _iso(row.created_at),
                "updated_at": _iso(row.updated_at),
                "search": _search_blob(row.code, row.element_nr, row.anode_nr, row.cathode_nr, row.reason, row.status, row.last_note),
            }
        )
    for row in db.query(WfAssembleRequest).all():
        rows.append(
            {
                "flow": "assemble",
                "id": row.id,
                "code": row.code,
                "status": row.status,
                "element_nr": row.element_nr,
                "summary": " / ".join(bit for bit in (row.anode_nr, row.cathode_nr, row.membrane_nr) if bit),
                "actor": row.created_by_name,
                "created_at": _iso(row.created_at),
                "updated_at": _iso(row.updated_at),
                "search": _search_blob(row.code, row.element_nr, row.anode_nr, row.cathode_nr, row.membrane_nr, row.status, row.last_note),
            }
        )
    for row in db.query(WfWorkOrder).all():
        rows.append(
            {
                "flow": "workorder",
                "id": row.id,
                "code": row.code,
                "status": row.status,
                "element_nr": row.element_nr,
                "summary": " / ".join(bit for bit in (row.anode_nr, row.cathode_nr, row.membrane_nr) if bit),
                "actor": row.created_by_name,
                "created_at": _iso(row.created_at),
                "updated_at": _iso(row.updated_at),
                "search": _search_blob(row.code, row.element_nr, row.anode_nr, row.cathode_nr, row.membrane_nr, row.status, row.remarks, row.last_note),
            }
        )
    return rows


def _process_work(db: Session, flow: str, record_id: int) -> list[dict]:
    """The concrete work recorded on this process, besides the step log."""
    if flow == "workorder":
        return [
            {
                "stage": row.stage,
                "person_code": row.person_code,
                "person_name": row.person_name,
                "skill": row.skill,
                "work_hours": row.work_hours,
                "work_qty": row.work_qty,
                "description": row.description,
            }
            for row in db.query(WfWorkOrderLabor)
            .filter(WfWorkOrderLabor.work_order_id == record_id)
            .order_by(WfWorkOrderLabor.stage, WfWorkOrderLabor.line_no)
            .all()
        ]
    if flow == "coating":
        out = []
        for item in (
            db.query(WfCoatingItem)
            .filter(WfCoatingItem.batch_id == record_id)
            .order_by(WfCoatingItem.package_id, WfCoatingItem.line_no)
            .all()
        ):
            out.append(
                {
                    "kind": item.element_kind,
                    "serial": item.serial,
                    "problem": item.problem,
                    "final_report": item.final_report,
                    "remark": item.remark,
                }
            )
        return out
    if flow == "purchase":
        return [
            {"kind": item.element_kind, "serial": item.serial, "coating": item.coating, "manufacturer": item.manufacturer}
            for item in db.query(WfPurchaseItem).filter(WfPurchaseItem.purchase_id == record_id).all()
        ]
    return []


@router.get("/process-log")
def process_log(
    q: str | None = None,
    flow: str | None = None,
    limit: int = Query(400, ge=1, le=2000),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_view(db, user, INSPECTION_VIEW_KEYS)
    needle = (q or "").strip().lower()
    want = (flow or "").strip() or None
    rows = _process_index(db)
    if want:
        rows = [row for row in rows if row["flow"] == want]
    if needle:
        rows = [row for row in rows if needle in row["search"]]
    rows.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    out = []
    for row in rows[:limit]:
        item = dict(row)
        item.pop("search", None)
        out.append(item)
    return out


@router.get("/process-log/{flow}/{record_id}")
def process_log_detail(
    flow: str,
    record_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_view(db, user, INSPECTION_VIEW_KEYS)
    if flow not in ("coating", "purchase", "cell", "inspection", "assemble", "workorder"):
        raise HTTPException(404, "Unknown process")
    match = next((row for row in _process_index(db) if row["flow"] == flow and row["id"] == record_id), None)
    if match is None:
        raise HTTPException(404, "Process not found")
    header = dict(match)
    header.pop("search", None)
    if flow == "coating":
        header["codes"] = [pkg.code for pkg in db.query(WfCoatingPackage).filter_by(batch_id=record_id).order_by(WfCoatingPackage.pallet_no).all()]
    return {
        **header,
        "events": _events(db, flow, record_id),
        "work": _process_work(db, flow, record_id),
    }


# ------------------------------------------------------------------ history / reports


@router.get("/history")
def history(
    serial: str | None = None,
    code: str | None = None,
    company_id: int | None = None,
    flow: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Every send / return / purchase per element, searchable by element number, CO/PO code, company and period."""
    _require_view(db, user)
    rows: list[dict] = []
    s_key = compact_nr(serial) if serial else ""
    c_key = (code or "").strip().upper()
    companies = {c.id: c.name for c in db.query(models.WhCompany).all()}

    def in_period(day: date | None) -> bool:
        if day is None:
            return not (date_from or date_to)
        return (not date_from or day >= date_from) and (not date_to or day <= date_to)

    if flow in (None, "", "coating"):
        q = (
            db.query(WfCoatingItem, WfCoatingPackage, WfCoatingBatch)
            .join(WfCoatingPackage, WfCoatingPackage.id == WfCoatingItem.package_id)
            .join(WfCoatingBatch, WfCoatingBatch.id == WfCoatingItem.batch_id)
        )
        if s_key:
            q = q.filter(func.upper(func.replace(WfCoatingItem.serial, " ", "")).like(f"%{s_key}%"))
        if c_key:
            q = q.filter(or_(func.upper(WfCoatingPackage.code).like(f"%{c_key}%"), func.upper(WfCoatingBatch.indent_no).like(f"%{c_key}%")))
        if company_id:
            q = q.filter(WfCoatingBatch.company_id == company_id)
        for it, pkg, b in q.order_by(WfCoatingBatch.created_at.desc(), WfCoatingPackage.seq, WfCoatingItem.line_no).limit(5000).all():
            if not in_period(b.dispatch_date or b.created_at.date()):
                continue
            rows.append(
                {
                    "flow": "coating",
                    "record_id": b.id,
                    "code": pkg.code,
                    "element_kind": it.element_kind,
                    "serial": it.serial,
                    "status": b.status,
                    "company_name": companies.get(b.company_id),
                    "indent_no": b.indent_no,
                    "requested_at": _iso(b.created_at.date()),
                    "sent_date": _iso(b.dispatch_date),
                    "expected_date": _iso(b.expected_return_date),
                    "actual_date": _iso(b.return_date),
                    "delay_days": b.delay_days,
                    "problem": it.problem,
                    "final_report": it.final_report,
                    "remark": it.remark,
                }
            )
    if flow in (None, "", "purchase"):
        q2 = db.query(WfPurchase)
        if c_key:
            q2 = q2.filter(or_(func.upper(WfPurchase.code).like(f"%{c_key}%"), func.upper(WfPurchase.indent_no).like(f"%{c_key}%")))
        if company_id:
            q2 = q2.filter(WfPurchase.supplier_id == company_id)
        for p in q2.order_by(WfPurchase.created_at.desc()).limit(2000).all():
            if not in_period(p.request_date or p.created_at.date()):
                continue
            items = db.query(WfPurchaseItem).filter_by(purchase_id=p.id).all()
            if s_key:
                items = [i for i in items if s_key in compact_nr(i.serial)]
                if not items:
                    continue
            base = {
                "flow": "purchase",
                "record_id": p.id,
                "code": p.code,
                "status": p.status,
                "company_name": companies.get(p.supplier_id),
                "indent_no": p.indent_no,
                "requested_at": _iso(p.created_at.date()),
                "sent_date": _iso(p.request_date),
                "expected_date": _iso(p.expected_delivery_date),
                "actual_date": _iso(p.delivery_date),
                "delay_days": p.delay_days,
                "problem": None,
                "final_report": None,
                "remark": None,
            }
            if items:
                for i in items:
                    rows.append({**base, "element_kind": i.element_kind, "serial": i.serial})
            else:
                rows.append({**base, "element_kind": None, "serial": f"{p.anode_count} A + {p.cathode_count} K"})
    if flow in (None, "", "assemble"):
        q3 = db.query(WfAssembleRequest)
        if c_key:
            q3 = q3.filter(or_(func.upper(WfAssembleRequest.code).like(f"%{c_key}%"), func.upper(func.coalesce(WfAssembleRequest.element_nr, "")).like(f"%{c_key}%")))
        for r in q3.order_by(WfAssembleRequest.created_at.desc()).limit(2000).all():
            if not in_period(r.assembly_date or r.created_at.date()):
                continue
            serials = [r.anode_nr, r.cathode_nr, r.element_nr]
            if s_key and not any(s_key in compact_nr(s) for s in serials if s):
                continue
            base = {
                "flow": "assemble",
                "record_id": r.id,
                "code": r.code,
                "status": r.status,
                "company_name": None,
                "indent_no": None,
                "requested_at": _iso(r.created_at.date()),
                "sent_date": _iso(r.assembly_date),
                "expected_date": None,
                "actual_date": _iso(r.completed_at.date() if r.completed_at else None),
                "delay_days": None,
                "problem": None,
                "final_report": None,
                "remark": r.last_note,
            }
            rows.append({**base, "element_kind": "anode", "serial": r.anode_nr or ""})
            rows.append({**base, "element_kind": "cathode", "serial": r.cathode_nr or ""})
    coating_rows = [r for r in rows if r["flow"] == "coating"]
    return {
        "rows": rows[:5000],
        "totals": {
            "coating_pieces": len(coating_rows),
            "coating_codes": len({r["code"] for r in coating_rows}),
            "coating_requests": len({r["record_id"] for r in coating_rows}),
            "purchases": len({r["record_id"] for r in rows if r["flow"] == "purchase"}),
            "purchased_pieces": sum(1 for r in rows if r["flow"] == "purchase" and r["element_kind"]),
        },
    }


def _company_stats(db: Session, company_id: int, date_from: date | None, date_to: date | None) -> dict:
    def ok(day: date | None) -> bool:
        return day is not None and (not date_from or day >= date_from) and (not date_to or day <= date_to)

    batches = [b for b in db.query(WfCoatingBatch).filter(WfCoatingBatch.company_id == company_id, WfCoatingBatch.dispatch_date.isnot(None)).all() if ok(b.dispatch_date)]
    purchases = [p for p in db.query(WfPurchase).filter(WfPurchase.supplier_id == company_id, WfPurchase.status != "cancelled").all() if ok(p.request_date or p.created_at.date())]
    returned = [b.delay_days for b in batches if b.return_date is not None and b.delay_days is not None]
    delivered = [p.delay_days for p in purchases if p.delivery_date is not None and p.delay_days is not None]
    late_parties: dict[str, int] = {}
    for rec in [*batches, *purchases]:
        if rec.delay_days and rec.delay_days > 0 and rec.delay_party:
            late_parties[rec.delay_party] = late_parties.get(rec.delay_party, 0) + 1
    all_delays = returned + delivered
    return {
        "coating_requests": len(batches),
        "coating_pieces": sum(b.anode_count + b.cathode_count for b in batches),
        "coating_anodes": sum(b.anode_count for b in batches),
        "coating_cathodes": sum(b.cathode_count for b in batches),
        "at_company": sum(b.anode_count + b.cathode_count for b in batches if b.status == "await_return" and b.return_date is None),
        "reworks": sum(b.rework_count or 0 for b in batches),
        "purchases": len(purchases),
        "purchased_anodes": sum(p.anode_count for p in purchases),
        "purchased_cathodes": sum(p.cathode_count for p in purchases),
        "deliveries": len(all_delays),
        "on_time": sum(1 for d in all_delays if d <= 0),
        "late": sum(1 for d in all_delays if d > 0),
        "late_company": late_parties.get("company", 0),
        "late_by_party": late_parties,
        "avg_delay": round(sum(max(d, 0) for d in all_delays) / len(all_delays), 1) if all_delays else None,
        "max_delay": max(all_delays) if all_delays else None,
    }


@router.get("/reports/companies")
def company_report(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_view(db, user)
    out = []
    for co in db.query(models.WhCompany).order_by(models.WhCompany.name).all():
        stats = _company_stats(db, co.id, date_from, date_to)
        out.append({"company_id": co.id, "company_name": co.name, "is_coating": co.is_coating, "is_supplier": co.is_supplier, **stats})
    return out


@router.get("/reports/companies/{company_id}")
def company_report_one(company_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user)
    if not db.get(models.WhCompany, company_id):
        raise HTTPException(404, "Company not found")
    return _company_stats(db, company_id, None, None)


def _pool_day(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return svc._as_date(value)


def _side_line(remarks: str | None, label: str) -> str:
    prefix = f"{label}:"
    for line in str(remarks or "").splitlines():
        if line.startswith(prefix):
            return line.split(":", 1)[1].strip()
    return ""


def _line_reusable(text: str) -> bool:
    text = text.strip()
    return text.startswith("قابل استفاده") and not text.startswith("غیر")


def _pool_item(**kwargs: Any) -> dict:
    day = kwargs.get("date")
    kwargs["date"] = day.isoformat() if hasattr(day, "isoformat") else None
    return kwargs


@router.get("/assembly-pool")
def assembly_pool(db: Session = Depends(get_db)):
    """Pieces the cell shop may pick when assembling a new element.

    Three stocks, each still free (not sitting on an open assembly):
    reusable — inspection and process both called it reusable
    purchased — registered on a purchase and never mounted
    recoated — back from a coating company and not assembled since that return
    """
    anode_index = load_compact_index(db, models.Anode, "anode_nr")
    cathode_index = load_compact_index(db, models.Cathode, "cathode_nr")
    indexes = {"anode": anode_index, "cathode": cathode_index}
    busy: set[tuple[str, str]] = set()
    history: dict[tuple[str, str], list[date]] = {}
    for el in db.query(
        models.Element.anode_nr,
        models.Element.cathode_nr,
        models.Element.assembly_date,
        models.Element.disassembly_date,
    ).all():
        assembled = _pool_day(el.assembly_date)
        for kind, raw in (("anode", el.anode_nr), ("cathode", el.cathode_nr)):
            key = compact_nr(raw)
            if not key:
                continue
            if el.disassembly_date is None:
                busy.add((kind, key))
            if assembled:
                history.setdefault((kind, key), []).append(assembled)
    for r in db.query(WfAssembleRequest).filter(WfAssembleRequest.status.notin_(CLOSED)).all():
        for kind, raw in (("anode", r.anode_nr), ("cathode", r.cathode_nr)):
            key = compact_nr(raw)
            if key:
                busy.add((kind, key))

    def spelled(kind: str, raw: str) -> str:
        return indexes[kind].get(compact_nr(raw), raw)

    def used_since(kind: str, key: str, day: date | None) -> bool:
        if day is None:
            return False
        return any(when >= day for when in history.get((kind, key), []))

    reusable: list[dict] = []
    seen_reusable: set[tuple[str, str]] = set()
    rows = (
        db.query(models.ElectrodeSegregation)
        .order_by(models.ElectrodeSegregation.id.desc())
        .all()
    )
    for row in rows:
        kind = (row.electrode_kind or "").lower()
        if kind not in ("anode", "cathode"):
            continue
        key = compact_nr(row.serial_nr)
        if not key or (kind, key) in seen_reusable:
            continue
        seen_reusable.add((kind, key))
        decision_ok = _line_reusable(str(row.decision or ""))
        sides_ok = _line_reusable(_side_line(row.remarks, "Inspection")) and _line_reusable(_side_line(row.remarks, "Process"))
        if not (decision_ok or sides_ok):
            continue
        if (kind, key) in busy or used_since(kind, key, _pool_day(row.inspection_date)):
            continue
        reusable.append(
            _pool_item(
                source="reusable",
                kind=kind,
                serial=spelled(kind, row.serial_nr),
                company=row.company,
                quality=row.coating_quality,
                detail=row.segregation,
                ref=row.inspection_form_serial,
                date=_pool_day(row.inspection_date),
                pair_serial=row.pair_serial_nr,
                in_catalog=key in indexes[kind],
            )
        )

    recoated: list[dict] = []
    recoated_keys: set[tuple[str, str]] = set()
    latest: dict[tuple[str, str], Any] = {}
    for kind, model, field in (
        ("anode", models.AnodeRecoating, "anode_nr"),
        ("cathode", models.CathodeRecoating, "cathode_nr"),
    ):
        for row in db.query(model).filter(getattr(model, "return_date").isnot(None)).all():
            key = compact_nr(getattr(row, field))
            if not key:
                continue
            prev = latest.get((kind, key))
            if prev is None or (row.return_date or datetime.min) > (prev.return_date or datetime.min):
                latest[(kind, key)] = row
    for (kind, key), row in latest.items():
        back = _pool_day(row.return_date)
        if (kind, key) in busy or used_since(kind, key, back):
            continue
        recoated_keys.add((kind, key))
        serial = spelled(kind, getattr(row, "anode_nr" if kind == "anode" else "cathode_nr"))
        recoated.append(
            _pool_item(
                source="recoated",
                kind=kind,
                serial=serial,
                company=row.manufacturer,
                quality=None,
                detail=getattr(row, "coating_nr", None),
                ref=getattr(row, "coating_nr", None) or row.remarks,
                date=back,
                pair_serial=None,
                in_catalog=key in indexes[kind],
            )
        )

    purchased: list[dict] = []
    seen_buy: set[tuple[str, str]] = set()
    purchase_by_id = {p.id: p for p in db.query(WfPurchase).all()}
    companies = {c.id: c.name for c in db.query(models.WhCompany).all()}
    for item in db.query(WfPurchaseItem).order_by(WfPurchaseItem.id.desc()).all():
        kind = (item.element_kind or "").lower()
        key = compact_nr(item.serial)
        if kind not in ("anode", "cathode") or not key or (kind, key) in seen_buy:
            continue
        seen_buy.add((kind, key))
        if (kind, key) in busy or (kind, key) in history or (kind, key) in recoated_keys:
            continue
        parent = purchase_by_id.get(item.purchase_id)
        purchased.append(
            _pool_item(
                source="purchased",
                kind=kind,
                serial=spelled(kind, item.serial),
                company=item.manufacturer or (companies.get(parent.supplier_id) if parent else None),
                quality=item.coating,
                detail=parent.code if parent else None,
                ref=parent.code if parent else None,
                date=_pool_day(item.registered_at) or (parent.delivery_date if parent else None),
                pair_serial=None,
                in_catalog=key in indexes[kind],
            )
        )
    for purchase in db.query(models.WhPurchase).all():
        kind = (purchase.element_kind or "").lower()
        if kind not in ("anode", "cathode"):
            continue
        for item in db.query(models.WhPurchaseItem).filter_by(purchase_id=purchase.id).all():
            key = compact_nr(item.serial)
            if not key or (kind, key) in seen_buy:
                continue
            seen_buy.add((kind, key))
            if (kind, key) in busy or (kind, key) in history or (kind, key) in recoated_keys:
                continue
            purchased.append(
                _pool_item(
                    source="purchased",
                    kind=kind,
                    serial=spelled(kind, item.serial),
                    company=companies.get(purchase.supplier_id),
                    quality=None,
                    detail=purchase.purchase_no,
                    ref=purchase.purchase_no,
                    date=purchase.purchase_date,
                    pair_serial=None,
                    in_catalog=key in indexes[kind],
                )
            )

    def newest(items: list[dict]) -> list[dict]:
        return sorted(items, key=lambda row: row.get("date") or "", reverse=True)

    return {"reusable": newest(reusable), "purchased": newest(purchased), "recoated": newest(recoated)}
