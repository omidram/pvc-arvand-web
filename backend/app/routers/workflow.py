"""Recoating, new-purchase and cell-removal workflows with per-group cartables and notifications.

Groups are permission keys: wf_c90 (requesting unit), wf_procurement, wf_warehouse, wf_inspection,
wf_operation (switches cells off), wf_cellshop (receives them). "edit" on a key means the user belongs to
that group and may act on its stages; admins may act everywhere.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
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
from ..plant_topology import format_electrolyzer_name
from ..warehouse import compact_nr, ensure_indexed, load_compact_index
from ..warehouse_lifecycle import _stamp, log_event, upsert_state
from ..workflow_excel import build_workbook, parse_report
from ..workflow_models import (
    WfCellRequest,
    WfCoatingBatch,
    WfCoatingItem,
    WfCoatingPackage,
    WfEvent,
    WfFile,
    WfNotification,
    WfPurchase,
    WfPurchaseItem,
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
}
VIEW_KEYS = ("storage", "anodes", "cathodes", "wf_c90", "wf_procurement", "wf_warehouse", "wf_inspection")
CELL_VIEW_KEYS = ("elements", "wf_operation", "wf_cellshop")

COATING_STAGES: dict[str, list[str]] = {
    "await_company": ["procurement"],
    "await_indent": ["warehouse"],
    "await_dispatch": ["procurement"],
    "at_coater": ["warehouse", "procurement"],
    "await_report": ["procurement"],
    "await_inspection": ["inspection"],
    "await_approval": ["c90"],
}
PURCHASE_STAGES: dict[str, list[str]] = {
    "await_indent": ["warehouse"],
    "await_order": ["procurement"],
    "ordered": ["procurement", "warehouse"],
    "await_registration": ["c90"],
}
CELL_STAGES: dict[str, list[str]] = {
    "await_shutdown": ["operation"],
    "await_shop": ["cellshop"],
    "in_shop": ["cellshop"],
}
STAGES = {"coating": COATING_STAGES, "purchase": PURCHASE_STAGES, "cell": CELL_STAGES}
CELL_DECISIONS = ("keep", "disassemble", "relocated")
AUTO_REQUEST_DAYS = 30  # a decommission typed into Assembly Data opens a request only when it is this recent
CLOSED = ("completed", "cancelled")
DELAY_PARTIES = ("employer", "company", "transport", "other")
MAX_PALLET = 200


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
    return _can_view(db, user, VIEW_KEYS + CELL_VIEW_KEYS)


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
        return f"{'⚠ ' if record.urgent else ''}{record.element_nr}{cell}"
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


# ------------------------------------------------------------------ cartable / notifications


def _coating_summary(db: Session, b: WfCoatingBatch) -> dict:
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
        "created_by": b.created_by_name,
        "created_at": _iso(b.created_at),
        "updated_at": _iso(b.updated_at),
        "last_note": b.last_note,
    }


def _purchase_summary(db: Session, p: WfPurchase) -> dict:
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
        "created_by": p.created_by_name,
        "created_at": _iso(p.created_at),
        "updated_at": _iso(p.updated_at),
        "last_note": p.last_note,
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
        "delay_parties": list(DELAY_PARTIES),
    }


def _cartable(db: Session, user: models.User) -> list[dict]:
    groups = _groups(db, user)
    if not groups:
        return []
    out: list[dict] = []
    c_status = [s for s, g in COATING_STAGES.items() if groups & set(g)]
    p_status = [s for s, g in PURCHASE_STAGES.items() if groups & set(g)]
    if c_status:
        for b in db.query(WfCoatingBatch).filter(WfCoatingBatch.status.in_(c_status)).order_by(WfCoatingBatch.updated_at).all():
            out.append(_coating_summary(db, b))
    if p_status:
        for p in db.query(WfPurchase).filter(WfPurchase.status.in_(p_status)).order_by(WfPurchase.updated_at).all():
            out.append(_purchase_summary(db, p))
    r_status = [s for s, g in CELL_STAGES.items() if groups & set(g)]
    if r_status:
        for r in db.query(WfCellRequest).filter(WfCellRequest.status.in_(r_status)).order_by(WfCellRequest.updated_at).all():
            out.append(_cell_summary(db, r))
    out.sort(key=lambda r: r["updated_at"] or "")
    return out


@router.get("/cartable")
def cartable(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _cartable(db, user)


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Bell data: items waiting for my groups and unread notices (cheap enough to poll)."""
    if not _can_view_any(db, user):
        return {"cartable": 0, "unread": 0, "items": []}
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
    return {"cartable": len(_cartable(db, user)), "unread": total_unread, "items": [_notice(n) for n in unread]}


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
    allow_unknown: bool = False


def _next_seq(db: Session, column) -> int:
    return int(db.query(func.max(column)).scalar() or 0) + 1


def _code(prefix: str, day: date, seq: int) -> str:
    return f"{prefix}-{day:%Y%m%d}-{seq:04d}"


def _clean_lines(lines: list[CoatingLineIn], kind: str, index: dict[str, str], unknown: list[str], allow_unknown: bool) -> list[dict]:
    out = []
    for line in lines:
        raw = (line.serial or "").strip()
        if not raw:
            continue
        key = compact_nr(raw)
        serial = index.get(key)
        if serial is None:
            if not allow_unknown:
                unknown.append(raw)
            serial = raw[:50]
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


@router.post("/coating")
def create_coating(body: CoatingCreateIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_group(db, user, "c90")
    unknown: list[str] = []
    anodes = _clean_lines(body.anodes, "anode", load_compact_index(db, models.Anode, "anode_nr"), unknown, body.allow_unknown)
    cathodes = _clean_lines(body.cathodes, "cathode", load_compact_index(db, models.Cathode, "cathode_nr"), unknown, body.allow_unknown)
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

    today = date.today()
    batch = WfCoatingBatch(
        status="await_company",
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
    _event(db, "coating", batch, "created", user, None, body.remarks, {"codes": codes})
    _notify(db, "coating", batch, user)
    db.commit()
    return _coating_detail(db, batch, user)


def coating_from_board(db: Session, kind: str, serial: str, user: models.User, note: str | None) -> dict:
    """Live board "Send to recoating": the piece joins the open request that still waits for a
    coating company (procurement has not picked one yet), otherwise a new request is opened."""
    model, field = (models.Anode, "anode_nr") if kind == "anode" else (models.Cathode, "cathode_nr")
    ensure_indexed(db, model, field, serial, None)
    stored = load_compact_index(db, model, field).get(compact_nr(serial)) or serial.strip()[:50]
    problem = segregation_problems(db, {(kind, compact_nr(stored))}).get((kind, compact_nr(stored))) or note
    today = date.today()
    b = (
        db.query(WfCoatingBatch)
        .filter(WfCoatingBatch.status == "await_company")
        .order_by(WfCoatingBatch.created_at.desc())
        .first()
    )
    created = b is None
    if created:
        b = WfCoatingBatch(
            status="await_company",
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
    upsert_state(db, kind, stored, lifecycle_status="ready_dispatch")
    log_event(db, kind, stored, "coating_request", today, f"Recoating request {pkg.code} (Live board)", ref_kind="wf_coating", ref_id=b.id, details={"code": pkg.code})
    _event(db, "coating", b, "created" if created else "board_add", user, None if created else b.status, note, {"codes": [pkg.code], "serial": stored, "kind": kind})
    _notify(db, "coating", b, user, {b.created_by_id} if b.created_by_id else None)
    db.commit()
    return {"wf_id": b.id, "wf_code": pkg.code, "wf_status": b.status, "added": not created}


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
    if b.status == "at_coater" and mine:
        acts.append("receive")
    if b.status == "await_report" and mine:
        acts += ["report", "submit", "rework"]
    if b.status == "await_inspection" and mine:
        acts += ["inspect_ok", "inspect_reject"]
    if b.status == "await_approval" and mine:
        acts += ["approve", "reject"]
    if b.status in ("await_company", "await_indent", "await_dispatch") and ("c90" in groups or user.role == "admin"):
        acts.append("cancel")
    if b.status not in CLOSED and groups:
        acts.append("attach")
    return acts


def _coating_detail(db: Session, b: WfCoatingBatch, user: models.User) -> dict:
    data = _coating_summary(db, b)
    packages = db.query(WfCoatingPackage).filter_by(batch_id=b.id).order_by(WfCoatingPackage.seq).all()
    items = db.query(WfCoatingItem).filter_by(batch_id=b.id).order_by(WfCoatingItem.package_id, WfCoatingItem.line_no).all()
    _fill_problems(db, items)
    files = _files(db, "coating", b.id)
    data.update(
        {
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
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_view(db, user)
    q = db.query(WfCoatingBatch).order_by(WfCoatingBatch.created_at.desc())
    if status:
        q = q.filter(WfCoatingBatch.status == status)
    if open_only:
        q = q.filter(WfCoatingBatch.status.notin_(CLOSED))
    return [_coating_summary(db, b) for b in q.limit(500).all()]


@router.get("/coating/{batch_id}")
def get_coating(batch_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _require_view(db, user)
    return _coating_detail(db, _load_batch(db, batch_id), user)


class CompanyPickIn(NoteIn):
    company_id: int


@router.post("/coating/{batch_id}/company")
def coating_company(batch_id: int, body: CompanyPickIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_company",))
    co = _company(db, body.company_id)
    if not co or not co.is_coating:
        raise HTTPException(400, "Choose a coating company")
    b.company_id = co.id
    _move(db, "coating", b, "await_indent", "company", user, body.note, {"company": co.name})
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
    _move(db, "coating", b, "await_dispatch", "indent", user, body.note, {"indent_no": indent})
    db.commit()
    return _coating_detail(db, b, user)


class DispatchIn(NoteIn):
    dispatch_date: date
    expected_return_date: date


def _do_dispatch(db: Session, b: WfCoatingBatch, body: DispatchIn, user: models.User, action: str) -> None:
    if body.expected_return_date < body.dispatch_date:
        raise HTTPException(400, "Expected return date is before the send date")
    co = _company(db, b.company_id)
    b.dispatch_date = body.dispatch_date
    b.expected_return_date = body.expected_return_date
    b.return_date = None
    b.delay_days = None
    b.delay_party = None
    b.delay_reason = None
    codes = {p.id: p.code for p in db.query(WfCoatingPackage).filter_by(batch_id=b.id)}
    for it in _batch_items(db, b):
        upsert_state(db, it.element_kind, it.serial, lifecycle_status="at_coater", company_id=b.company_id)
        label = "Rework sent" if action == "rework" else "Sent for recoating"
        log_event(
            db, it.element_kind, it.serial, "dispatch", body.dispatch_date,
            f"{label} {codes.get(it.package_id, '')} → {co.name if co else ''}",
            ref_kind="wf_coating", ref_id=b.id, details={"code": codes.get(it.package_id), "indent_no": b.indent_no},
        )
    _move(
        db, "coating", b, "at_coater", action, user, body.note,
        {"dispatch_date": body.dispatch_date.isoformat(), "expected_return_date": body.expected_return_date.isoformat()},
    )


@router.post("/coating/{batch_id}/dispatch")
def coating_dispatch(batch_id: int, body: DispatchIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_dispatch",))
    _do_dispatch(db, b, body, user, "dispatch")
    db.commit()
    return _coating_detail(db, b, user)


class ReceiveIn(NoteIn):
    actual_date: date
    delay_party: str | None = None
    delay_reason: str | None = None


@router.post("/coating/{batch_id}/receive")
def coating_receive(batch_id: int, body: ReceiveIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("at_coater",))
    if b.dispatch_date and body.actual_date < b.dispatch_date:
        raise HTTPException(400, "Return date is before the send date")
    days = _delay(b.expected_return_date, body.actual_date)
    _check_delay(days, body.delay_party, body.delay_reason)
    b.return_date = body.actual_date
    b.delay_days = days
    late = days is not None and days > 0
    b.delay_party = body.delay_party if late else None
    b.delay_reason = ((body.delay_reason or "").strip() or None) if late else None
    codes = {p.id: p.code for p in db.query(WfCoatingPackage).filter_by(batch_id=b.id)}
    for it in _batch_items(db, b):
        upsert_state(db, it.element_kind, it.serial, lifecycle_status="pending_receive", company_id=b.company_id)
        log_event(
            db, it.element_kind, it.serial, "receive", body.actual_date,
            f"Returned from coating {codes.get(it.package_id, '')}",
            ref_kind="wf_coating", ref_id=b.id, details={"code": codes.get(it.package_id), "delay_days": days},
        )
    _move(
        db, "coating", b, "await_report", "receive", user, body.note,
        {"return_date": body.actual_date.isoformat(), "delay_days": days, "delay_party": b.delay_party, "delay_reason": b.delay_reason},
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
    _require_stage(db, user, "coating", b.status, ("await_report",))
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
    _require_stage(db, user, "coating", b.status, ("await_report",))
    if not db.query(WfFile).filter_by(flow="coating", record_id=b.id, kind="report").first():
        raise HTTPException(400, "Upload the final report (Excel) from the coating company first")
    b.rejected = False
    _move(db, "coating", b, "await_inspection", "submit", user, body.note, notify_creator=True)
    db.commit()
    return _coating_detail(db, b, user)


@router.post("/coating/{batch_id}/inspect_ok")
def coating_inspect_ok(batch_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Inspection checked the returned pieces and the company report; C-90 gives the final approval next."""
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_inspection",))
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
    _move(db, "coating", b, "await_report", "inspect_reject", user, body.note)
    db.commit()
    return _coating_detail(db, b, user)


@router.post("/coating/{batch_id}/rework")
def coating_rework(batch_id: int, body: DispatchIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    _require_stage(db, user, "coating", b.status, ("await_report",))
    b.rework_count = (b.rework_count or 0) + 1
    b.rejected = False
    _do_dispatch(db, b, body, user, "rework")
    db.commit()
    return _coating_detail(db, b, user)


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
        if it.element_kind == "anode":
            n = db.query(func.count(models.AnodeRecoating.id)).filter(models.AnodeRecoating.anode_nr == it.serial).scalar() or 0
            db.add(
                models.AnodeRecoating(
                    anode_nr=it.serial,
                    coating_nr=code,
                    dispatch_date=_stamp(b.dispatch_date) if b.dispatch_date else None,
                    return_date=_stamp(b.return_date) if b.return_date else None,
                    manufacturer=co.name[:100] if co else None,
                    recoating_number=str(n + 1),
                    remarks=remark,
                )
            )
        else:
            db.add(
                models.CathodeRecoating(
                    cathode_nr=it.serial,
                    dispatch_date=_stamp(b.dispatch_date) if b.dispatch_date else None,
                    return_date=_stamp(b.return_date) if b.return_date else None,
                    manufacturer=co.name[:100] if co else None,
                    remarks=remark,
                )
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
    _move(db, "coating", b, "await_report", "reject", user, body.note)
    db.commit()
    return _coating_detail(db, b, user)


@router.post("/coating/{batch_id}/cancel")
def coating_cancel(batch_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    b = _load_batch(db, batch_id)
    if b.status not in ("await_company", "await_indent", "await_dispatch"):
        raise HTTPException(409, "Only requests that were not sent yet can be cancelled")
    if user.role != "admin":
        _require_group(db, user, "c90")
    day = date.today()
    for it in _batch_items(db, b):
        upsert_state(db, it.element_kind, it.serial, lifecycle_status="in_plant", company_id=None)
        log_event(db, it.element_kind, it.serial, "coating_cancelled", day, "Recoating request cancelled", ref_kind="wf_coating", ref_id=b.id)
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
    if mine:
        acts.append({"await_indent": "indent", "await_order": "order", "ordered": "deliver", "await_registration": "register"}[p.status])
    if p.status in ("await_indent", "await_order") and ("procurement" in groups or user.role == "admin"):
        acts.append("cancel")
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
    _require_group(db, user, "procurement")
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


@router.post("/purchase/{purchase_id}/order")
def purchase_order(purchase_id: int, body: OrderIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    p = _load_purchase(db, purchase_id)
    _require_stage(db, user, "purchase", p.status, ("await_order",))
    if body.expected_delivery_date < body.request_date:
        raise HTTPException(400, "Expected delivery date is before the request date")
    p.request_date = body.request_date
    p.expected_delivery_date = body.expected_delivery_date
    _move(
        db, "purchase", p, "ordered", "order", user, body.note,
        {"request_date": body.request_date.isoformat(), "expected_delivery_date": body.expected_delivery_date.isoformat()},
    )
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


class RegisterItemIn(BaseModel):
    element_kind: str = Field(pattern="^(anode|cathode)$")
    serial: str
    coating: str | None = None
    manufacturer: str | None = None


class RegisterIn(NoteIn):
    items: list[RegisterItemIn]


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
    for it, serial in clean:
        manufacturer = (it.manufacturer or "").strip()[:100] or (sup.name[:100] if sup else None)
        coating = (it.coating or "").strip()[:50] or None
        master_cls = models.Anode if it.element_kind == "anode" else models.Cathode
        key_field = "anode_nr" if it.element_kind == "anode" else "cathode_nr"
        db.add(
            master_cls(
                **{key_field: serial},
                manufacturer=manufacturer,
                coating=coating,
                received_date=_stamp(delivered),
                batch=p.code,
            )
        )
        db.flush()
        db.add(WfPurchaseItem(purchase_id=p.id, element_kind=it.element_kind, serial=serial, coating=coating, manufacturer=manufacturer, registered_at=_now()))
        upsert_state(db, it.element_kind, serial, lifecycle_status="in_plant", company_id=None)
        log_event(db, it.element_kind, serial, "purchase", delivered, f"Purchase {p.code} from {sup.name if sup else ''}", ref_kind="wf_purchase", ref_id=p.id, details={"code": p.code, "indent_no": p.indent_no})
        log_event(db, it.element_kind, serial, "plant_entry", delivered, "Entered plant inventory", ref_kind="wf_purchase", ref_id=p.id)
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
    if p.status not in ("await_indent", "await_order"):
        raise HTTPException(409, "Only purchases that were not ordered yet can be cancelled")
    if user.role != "admin":
        _require_group(db, user, "procurement")
    _move(db, "purchase", p, "cancelled", "cancel", user, body.note, notify_creator=True)
    db.commit()
    return _purchase_detail(db, p, user)


# ------------------------------------------------------------------ cell removal (operation -> cell shop)


def _can_request_cell(db: Session, user: models.User) -> bool:
    if user.role == "admin" or "operation" in _groups(db, user):
        return True
    return user_permission_map(db, user).get("elements") == "edit"


def _cell_summary(db: Session, r: WfCellRequest) -> dict:
    return {
        "flow": "cell",
        "id": r.id,
        "title": _title("cell", r, db),
        "code": r.code,
        "codes": [r.code],
        "status": r.status,
        "groups": CELL_STAGES.get(r.status, []),
        "element_nr": r.element_nr,
        "element_id": r.element_id,
        "electrolyzer": r.electrolyzer,
        "position": r.position,
        "reason": r.reason,
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
    }


def _cell_actions(db: Session, r: WfCellRequest, user: models.User) -> list[str]:
    groups = _groups(db, user)
    acts: list[str] = []
    if r.status == "await_shutdown" and "operation" in groups:
        acts.append("shutdown")
    if r.status == "await_shop" and "cellshop" in groups:
        acts.append("receive")
    if r.status in ("await_shop", "in_shop") and "cellshop" in groups:
        acts.append("decide")
    if r.status == "await_shutdown" and (user.role == "admin" or "operation" in groups or r.created_by_id == user.id):
        acts.append("cancel")
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
    return [r for r in rows if compact_nr(r.element_nr) == key] if key else []


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
        el.dol_days = svc.installation_dol(el.assembly_date, el.commissioning_date, el.disassembly_date, el.decommissioning_date)
        db.add(
            models.ElementShopEvent(
                element_nr=str(el.element_nr)[:50], from_stage="in_service" if el.commissioning_date else "installed",
                to_stage="decommissioned", note=f"{r.code}: {reason or r.reason}"[:500], user=_display(actor), created_at=_now(),
            )
        )
    if not (el.decommission_reason or "").strip():
        el.decommission_reason = (reason or r.reason)[:200]
    r.decommission_date = day
    return day


class CellCreateIn(BaseModel):
    element_nr: str = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=200)
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
        reason=reason[:200],
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


class CellShutdownIn(NoteIn):
    date: date_type
    reason: str | None = None


@router.post("/cell/{request_id}/shutdown")
def cell_shutdown(request_id: int, body: CellShutdownIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_cell(db, request_id)
    _require_stage(db, user, "cell", r.status, ("await_shutdown",))
    reason = (body.reason or "").strip() or None
    if reason:
        r.reason = reason[:200]
    day = _write_decommission(db, r, body.date, reason, user)
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
    _cell_move(db, r, "completed", "decide", user, note, data, also=("operation",))
    db.commit()
    svc.clear_cache()
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
    extra = _members(db, ["operation", "cellshop"])
    if r.created_by_id:
        extra.add(r.created_by_id)
    _notify(db, "cell", r, user, extra)
    db.commit()
    return _cell_detail(db, r, user)


@router.post("/cell/{request_id}/cancel")
def cell_cancel(request_id: int, body: NoteIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    r = _load_cell(db, request_id)
    if "cancel" not in _cell_actions(db, r, user):
        raise HTTPException(409, "Only a request whose cell is still running can be cancelled (by the requester or operation)")
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
        reason=((el.decommission_reason or "").strip() or "Assembly Data")[:200],
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


# ------------------------------------------------------------------ files (all flows)


def _record(db: Session, flow: str, record_id: int):
    if flow == "coating":
        return _load_batch(db, record_id)
    if flow == "purchase":
        return _load_purchase(db, record_id)
    if flow == "cell":
        return _load_cell(db, record_id)
    raise HTTPException(404, "Unknown workflow")


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
    if not _groups(db, user) and not (flow == "cell" and rec.created_by_id == user.id):
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
    _require_view(db, user, CELL_VIEW_KEYS if f.flow == "cell" else VIEW_KEYS)
    root = (data_root() / "workflow" / f.flow / str(f.record_id)).resolve()
    path = (root / f.stored_name).resolve()
    if path.parent != root or not path.exists():
        raise HTTPException(404, "File missing on the server")
    return FileResponse(path, media_type=f.content_type, filename=f.original_name)


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
        "at_company": sum(b.anode_count + b.cathode_count for b in batches if b.status == "at_coater"),
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
