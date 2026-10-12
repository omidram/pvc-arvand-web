"""Tickets: every signed-in user can message other users or whole roles, attach files, send forms and get notified."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_user
from ..database import get_db
from ..paths import data_root
from ..ticket_models import (
    Ticket,
    TicketAttachment,
    TicketMessage,
    TicketNotification,
    TicketParticipant,
)

router = APIRouter(prefix="/tickets", tags=["tickets"], dependencies=[Depends(get_current_user)])

CATEGORIES = ("general", "request", "issue", "form", "info")
PRIORITIES = ("low", "normal", "high", "urgent")
STATUSES = ("open", "in_progress", "answered", "closed")
FORM_TYPES = ("element_request", "maintenance_request", "material_request", "incident_report", "general_form")

MAX_BYTES = 25 * 1024 * 1024
MAX_FILES = 10
MAX_FORM_FIELDS = 40
BLOCKED_EXT = {
    ".exe", ".bat", ".cmd", ".com", ".msi", ".dll", ".scr", ".ps1", ".vbs", ".vbe", ".js", ".jse", ".wsf",
    ".sh", ".jar", ".html", ".htm", ".svg", ".hta", ".lnk", ".reg",
}
INLINE_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


# ------------------------------------------------------------------ helpers


def _now() -> datetime:
    return datetime.now()


def _role_label(db: Session, user: models.User) -> str:
    if user.role_id:
        role = db.query(models.AppRole).filter(models.AppRole.id == user.role_id).first()
        if role:
            return role.name
    return {"admin": "Administrator", "visitor": "Visitor"}.get(user.role, "User")


def _display(user: models.User) -> str:
    return (user.full_name or "").strip() or user.username


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value else None


def _is_participant(db: Session, ticket_id: int, user_id: int) -> bool:
    return (
        db.query(TicketParticipant.id)
        .filter(TicketParticipant.ticket_id == ticket_id, TicketParticipant.user_id == user_id)
        .first()
        is not None
    )


def _load_ticket(db: Session, ticket_id: int, user: models.User, *, allow_admin: bool = True) -> Ticket:
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if _is_participant(db, ticket_id, user.id):
        return ticket
    if allow_admin and user.role == "admin":
        return ticket
    raise HTTPException(status_code=403, detail="You are not part of this ticket")


def _parse_json_list(raw: str | None) -> list[Any]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid recipient list")
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail="Invalid recipient list")
    return value


def _clean_form(form_type: str | None, raw: str | None) -> tuple[str | None, dict[str, str] | None]:
    if not form_type:
        return None, None
    if form_type not in FORM_TYPES:
        raise HTTPException(status_code=400, detail="Unknown form type")
    try:
        data = json.loads(raw or "{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid form data")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid form data")
    cleaned: dict[str, str] = {}
    for key, value in list(data.items())[:MAX_FORM_FIELDS]:
        text = "" if value is None else str(value).strip()
        if text:
            cleaned[str(key)[:60]] = text[:2000]
    if not cleaned:
        return None, None
    return form_type, cleaned


def _recipient_ids(db: Session, sender: models.User, user_ids: list[Any], role_keys: list[Any], to_all: bool) -> dict[int, str]:
    """user id -> how they were reached (user | role name | everyone)."""
    found: dict[int, str] = {}
    active = db.query(models.User).filter(models.User.is_active.is_(True))
    if to_all:
        for u in active.all():
            if u.id != sender.id:
                found[u.id] = "everyone"
    for raw in user_ids:
        try:
            uid = int(raw)
        except (TypeError, ValueError):
            continue
        u = active.filter(models.User.id == uid).first()
        if u is not None and u.id != sender.id:
            found.setdefault(u.id, "user")
    for key in role_keys:
        text = str(key)
        if text == "s:admin":
            for u in active.filter(models.User.role == "admin").all():
                if u.id != sender.id:
                    found.setdefault(u.id, "Administrator")
        elif text.startswith("r:"):
            try:
                rid = int(text[2:])
            except ValueError:
                continue
            role = db.query(models.AppRole).filter(models.AppRole.id == rid).first()
            if role is None:
                continue
            for u in active.filter(models.User.role_id == rid).all():
                if u.id != sender.id:
                    found.setdefault(u.id, role.name)
    return found


def _folder(ticket_id: int) -> Path:
    path = data_root() / "tickets" / str(ticket_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _stored_path(ticket_id: int, stored_name: str) -> Path:
    root = (data_root() / "tickets" / str(ticket_id)).resolve()
    path = (root / stored_name).resolve()
    if path.parent != root:
        raise HTTPException(status_code=400, detail="Invalid file")
    return path


def _safe_name(name: str | None) -> str:
    cleaned = Path((name or "file").replace("\\", "/")).name.strip().replace("\x00", "")
    return (cleaned or "file")[:200]


def _save_files(db: Session, ticket: Ticket, message: TicketMessage, uploads: list[UploadFile] | None, user: models.User) -> None:
    incoming = [u for u in (uploads or []) if u is not None and (u.filename or "").strip()]
    if len(incoming) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"At most {MAX_FILES} files per message")
    folder = _folder(ticket.id)
    for item in incoming:
        original = _safe_name(item.filename)
        ext = Path(original).suffix.lower()
        if ext in BLOCKED_EXT:
            raise HTTPException(status_code=400, detail=f"Files of type {ext} are not allowed")
        content = item.file.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise HTTPException(status_code=400, detail=f"{original} is larger than {MAX_BYTES // (1024 * 1024)} MB")
        stored = f"{uuid.uuid4().hex}{ext[:12]}"
        (folder / stored).write_bytes(content)
        db.add(
            TicketAttachment(
                ticket_id=ticket.id,
                message_id=message.id,
                original_name=original,
                stored_name=stored,
                content_type=INLINE_TYPES.get(ext) or "application/octet-stream",
                size_bytes=len(content),
                uploaded_by_id=user.id,
                uploaded_at=_now(),
            )
        )


def _notify(
    db: Session,
    ticket: Ticket,
    message: TicketMessage | None,
    sender: models.User,
    sender_role: str,
    user_ids: list[int] | set[int],
    kind: str,
    preview: str | None,
) -> None:
    for uid in user_ids:
        if uid == sender.id:
            continue
        db.add(
            TicketNotification(
                user_id=uid,
                ticket_id=ticket.id,
                message_id=message.id if message else None,
                kind=kind,
                from_id=sender.id,
                from_name=_display(sender),
                from_role=sender_role,
                subject=ticket.subject,
                preview=(preview or "")[:300] or None,
                created_at=_now(),
            )
        )


def _preview(body: str | None, form_type: str | None, files: int) -> str:
    text = " ".join((body or "").split())
    if not text and form_type:
        text = f"[{form_type}]"
    if files:
        text = (text + f" 📎{files}").strip()
    return text[:300]


def _message_out(db: Session, m: TicketMessage, files: list[TicketAttachment]) -> dict[str, Any]:
    return {
        "id": m.id,
        "kind": m.kind,
        "sender_id": m.sender_id,
        "sender_name": m.sender_name,
        "sender_role": m.sender_role,
        "body": m.body,
        "form_type": m.form_type,
        "form_data": m.form_data,
        "created_at": _iso(m.created_at),
        "files": [
            {"id": f.id, "name": f.original_name, "size": f.size_bytes, "content_type": f.content_type}
            for f in files
        ],
    }


def _people(db: Session, ticket_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(TicketParticipant, models.User)
        .join(models.User, models.User.id == TicketParticipant.user_id)
        .filter(TicketParticipant.ticket_id == ticket_id)
        .order_by(TicketParticipant.id.asc())
        .all()
    )
    return [
        {"id": u.id, "name": _display(u), "username": u.username, "role": _role_label(db, u), "via": p.added_via}
        for p, u in rows
    ]


def _summary(db: Session, t: Ticket, user: models.User, unread_by_ticket: dict[int, int]) -> dict[str, Any]:
    last = (
        db.query(TicketMessage)
        .filter(TicketMessage.ticket_id == t.id, TicketMessage.kind == "message")
        .order_by(TicketMessage.id.desc())
        .first()
    )
    people = _people(db, t.id)
    count = db.query(func.count(TicketMessage.id)).filter(TicketMessage.ticket_id == t.id, TicketMessage.kind == "message").scalar() or 0
    return {
        "id": t.id,
        "subject": t.subject,
        "category": t.category,
        "priority": t.priority,
        "status": t.status,
        "created_by_id": t.created_by_id,
        "created_by_name": t.created_by_name,
        "created_by_role": t.created_by_role,
        "created_at": _iso(t.created_at),
        "last_message_at": _iso(t.last_message_at),
        "to_all": bool(t.to_all),
        "unread": unread_by_ticket.get(t.id, 0),
        "messages": count,
        "participants": len(people),
        "people": [p["name"] for p in people[:4]],
        "last_sender": last.sender_name if last else None,
        "last_role": last.sender_role if last else None,
        "last_preview": _preview(last.body, last.form_type, 0) if last else None,
        "mine": t.created_by_id == user.id,
    }


def _unread_map(db: Session, user: models.User) -> dict[int, int]:
    rows = (
        db.query(TicketNotification.ticket_id, func.count(TicketNotification.id))
        .filter(TicketNotification.user_id == user.id, TicketNotification.read_at.is_(None))
        .group_by(TicketNotification.ticket_id)
        .all()
    )
    return {tid: n for tid, n in rows}


def _mark_read(db: Session, user: models.User, ticket_id: int | None = None, ids: list[int] | None = None) -> int:
    query = db.query(TicketNotification).filter(TicketNotification.user_id == user.id, TicketNotification.read_at.is_(None))
    if ticket_id is not None:
        query = query.filter(TicketNotification.ticket_id == ticket_id)
    if ids is not None:
        query = query.filter(TicketNotification.id.in_(ids or [-1]))
    rows = query.all()
    now = _now()
    for row in rows:
        row.read_at = now
    return len(rows)


# ------------------------------------------------------------------ directory + notifications


@router.get("/directory")
def directory(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Everybody a message can go to: users (with their role) and role groups."""
    users = db.query(models.User).filter(models.User.is_active.is_(True)).order_by(models.User.username.asc()).all()
    roles = {r.id: r.name for r in db.query(models.AppRole).all()}
    out_users = [
        {
            "id": u.id,
            "username": u.username,
            "name": _display(u),
            "role": roles.get(u.role_id) if u.role_id else {"admin": "Administrator", "visitor": "Visitor"}.get(u.role, "User"),
        }
        for u in users
        if u.id != user.id
    ]
    groups: list[dict[str, Any]] = []
    admins = sum(1 for u in users if u.role == "admin" and u.id != user.id)
    if admins:
        groups.append({"key": "s:admin", "name": "Administrator", "users": admins})
    for rid, name in sorted(roles.items(), key=lambda kv: kv[1].lower()):
        n = sum(1 for u in users if u.role_id == rid and u.id != user.id)
        if n:
            groups.append({"key": f"r:{rid}", "name": name, "users": n})
    return {"users": out_users, "roles": groups, "everyone": len(out_users)}


@router.get("/unread")
def unread(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    by_ticket = _unread_map(db, user)
    return {"notifications": sum(by_ticket.values()), "tickets": len(by_ticket)}


@router.get("/notifications")
def notifications(
    only_unread: bool = False,
    limit: int = Query(30, ge=1, le=200),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    query = db.query(TicketNotification).filter(TicketNotification.user_id == user.id)
    if only_unread:
        query = query.filter(TicketNotification.read_at.is_(None))
    rows = query.order_by(TicketNotification.id.desc()).limit(limit).all()
    unread_total = (
        db.query(func.count(TicketNotification.id))
        .filter(TicketNotification.user_id == user.id, TicketNotification.read_at.is_(None))
        .scalar()
        or 0
    )
    return {
        "unread": unread_total,
        "items": [
            {
                "id": n.id,
                "ticket_id": n.ticket_id,
                "kind": n.kind,
                "from_name": n.from_name,
                "from_role": n.from_role,
                "subject": n.subject,
                "preview": n.preview,
                "created_at": _iso(n.created_at),
                "read": n.read_at is not None,
            }
            for n in rows
        ],
    }


class ReadBody(BaseModel):
    ids: list[int] | None = None
    ticket_id: int | None = None
    all: bool = False


@router.post("/notifications/read")
def notifications_read(body: ReadBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if body.all:
        n = _mark_read(db, user)
    elif body.ticket_id is not None:
        n = _mark_read(db, user, ticket_id=body.ticket_id)
    else:
        n = _mark_read(db, user, ids=body.ids or [])
    db.commit()
    return {"marked": n}


# ------------------------------------------------------------------ tickets


@router.get("")
def list_tickets(
    box: str = Query("inbox", pattern="^(inbox|sent|unread|open|closed|all|everything)$"),
    q: str | None = None,
    limit: int = Query(300, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    unread_map = _unread_map(db, user)
    query = db.query(Ticket)
    if box == "everything":
        if user.role != "admin":
            raise HTTPException(status_code=403, detail="Administrator access required")
    else:
        query = query.join(TicketParticipant, TicketParticipant.ticket_id == Ticket.id).filter(TicketParticipant.user_id == user.id)
        if box == "inbox":
            query = query.filter(
                Ticket.status != "closed",
                or_(Ticket.created_by_id != user.id, Ticket.created_by_id.is_(None), Ticket.id.in_(list(unread_map) or [-1])),
            )
        elif box == "sent":
            query = query.filter(Ticket.created_by_id == user.id)
        elif box == "unread":
            query = query.filter(Ticket.id.in_(list(unread_map) or [-1]))
        elif box == "open":
            query = query.filter(Ticket.status != "closed")
        elif box == "closed":
            query = query.filter(Ticket.status == "closed")
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(Ticket.subject.ilike(like), Ticket.created_by_name.ilike(like), Ticket.id.in_(
            db.query(TicketMessage.ticket_id).filter(TicketMessage.body.ilike(like))
        )))
    rows = query.order_by(Ticket.last_message_at.desc(), Ticket.id.desc()).limit(limit).all()
    return [_summary(db, t, user, unread_map) for t in rows]


@router.post("", status_code=201)
def create_ticket(
    subject: str = Form(...),
    body: str = Form(""),
    category: str = Form("general"),
    priority: str = Form("normal"),
    recipient_users: str | None = Form(None),
    recipient_roles: str | None = Form(None),
    to_all: bool = Form(False),
    form_type: str | None = Form(None),
    form_data: str | None = Form(None),
    files: list[UploadFile] | None = File(default=None),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    subject = (subject or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="Subject is required")
    if category not in CATEGORIES:
        category = "general"
    if priority not in PRIORITIES:
        priority = "normal"
    recipients = _recipient_ids(db, user, _parse_json_list(recipient_users), _parse_json_list(recipient_roles), to_all)
    if not recipients:
        raise HTTPException(status_code=400, detail="Choose at least one recipient")
    ftype, fdata = _clean_form(form_type, form_data)
    body = (body or "").strip()
    has_files = any(u is not None and (u.filename or "").strip() for u in (files or []))
    if not body and not fdata and not has_files:
        raise HTTPException(status_code=400, detail="Write a message, fill a form or attach a file")

    role = _role_label(db, user)
    now = _now()
    ticket = Ticket(
        subject=subject[:200],
        category="form" if fdata and category == "general" else category,
        priority=priority,
        status="open",
        created_by_id=user.id,
        created_by_name=_display(user),
        created_by_role=role,
        created_at=now,
        last_message_at=now,
        to_all=bool(to_all),
    )
    db.add(ticket)
    db.flush()
    db.add(TicketParticipant(ticket_id=ticket.id, user_id=user.id, added_via="creator", added_at=now))
    for uid, via in recipients.items():
        db.add(TicketParticipant(ticket_id=ticket.id, user_id=uid, added_via=via, added_at=now))
    message = TicketMessage(
        ticket_id=ticket.id,
        sender_id=user.id,
        sender_name=_display(user),
        sender_role=role,
        kind="message",
        body=body or None,
        form_type=ftype,
        form_data=fdata,
        created_at=now,
    )
    db.add(message)
    db.flush()
    _save_files(db, ticket, message, files, user)
    n_files = sum(1 for u in (files or []) if u is not None and (u.filename or "").strip())
    _notify(db, ticket, message, user, role, set(recipients), "new_ticket", _preview(body, ftype, n_files))
    db.commit()
    return {"id": ticket.id, "recipients": len(recipients)}


@router.get("/{ticket_id}")
def get_ticket(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ticket = _load_ticket(db, ticket_id, user)
    messages = db.query(TicketMessage).filter(TicketMessage.ticket_id == ticket.id).order_by(TicketMessage.id.asc()).all()
    files: dict[int, list[TicketAttachment]] = {}
    for f in db.query(TicketAttachment).filter(TicketAttachment.ticket_id == ticket.id).order_by(TicketAttachment.id.asc()).all():
        files.setdefault(f.message_id, []).append(f)
    if _mark_read(db, user, ticket_id=ticket.id):
        db.commit()
    summary = _summary(db, ticket, user, {})
    summary["unread"] = 0
    return {
        **summary,
        "closed_at": _iso(ticket.closed_at),
        "people_detail": _people(db, ticket.id),
        "thread": [_message_out(db, m, files.get(m.id, [])) for m in messages],
        "is_participant": _is_participant(db, ticket.id, user.id),
    }


@router.post("/{ticket_id}/messages", status_code=201)
def add_message(
    ticket_id: int,
    body: str = Form(""),
    form_type: str | None = Form(None),
    form_data: str | None = Form(None),
    files: list[UploadFile] | None = File(default=None),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    ticket = _load_ticket(db, ticket_id, user, allow_admin=False)
    ftype, fdata = _clean_form(form_type, form_data)
    body = (body or "").strip()
    n_files = sum(1 for u in (files or []) if u is not None and (u.filename or "").strip())
    if not body and not fdata and not n_files:
        raise HTTPException(status_code=400, detail="Write a message, fill a form or attach a file")
    role = _role_label(db, user)
    now = _now()
    message = TicketMessage(
        ticket_id=ticket.id,
        sender_id=user.id,
        sender_name=_display(user),
        sender_role=role,
        kind="message",
        body=body or None,
        form_type=ftype,
        form_data=fdata,
        created_at=now,
    )
    db.add(message)
    db.flush()
    _save_files(db, ticket, message, files, user)
    ticket.last_message_at = now
    if ticket.status == "closed":
        ticket.status = "open"
        ticket.closed_at = None
    elif user.id == ticket.created_by_id:
        ticket.status = "open" if ticket.status == "answered" else ticket.status
    elif ticket.status in ("open", "in_progress"):
        ticket.status = "answered"
    others = {p.user_id for p in db.query(TicketParticipant).filter(TicketParticipant.ticket_id == ticket.id).all()}
    _notify(db, ticket, message, user, role, others, "message", _preview(body, ftype, n_files))
    db.commit()
    return {"id": message.id, "status": ticket.status}


class StatusBody(BaseModel):
    status: str | None = None
    priority: str | None = None


@router.patch("/{ticket_id}")
def update_ticket(ticket_id: int, payload: StatusBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ticket = _load_ticket(db, ticket_id, user)
    role = _role_label(db, user)
    notes: list[str] = []
    if payload.status is not None:
        if payload.status not in STATUSES:
            raise HTTPException(status_code=400, detail="Unknown status")
        if payload.status != ticket.status:
            ticket.status = payload.status
            ticket.closed_at = _now() if payload.status == "closed" else None
            notes.append(f"status:{payload.status}")
    if payload.priority is not None:
        if payload.priority not in PRIORITIES:
            raise HTTPException(status_code=400, detail="Unknown priority")
        if payload.priority != ticket.priority:
            ticket.priority = payload.priority
            notes.append(f"priority:{payload.priority}")
    if notes:
        now = _now()
        system = TicketMessage(
            ticket_id=ticket.id,
            sender_id=user.id,
            sender_name=_display(user),
            sender_role=role,
            kind="system",
            body=" ".join(notes),
            created_at=now,
        )
        db.add(system)
        db.flush()
        ticket.last_message_at = now
        others = {p.user_id for p in db.query(TicketParticipant).filter(TicketParticipant.ticket_id == ticket.id).all()}
        _notify(db, ticket, system, user, role, others, "status", " ".join(notes))
        db.commit()
    return {"id": ticket.id, "status": ticket.status, "priority": ticket.priority}


class AddPeopleBody(BaseModel):
    users: list[int] = []
    roles: list[str] = []
    everyone: bool = False


@router.post("/{ticket_id}/participants")
def add_participants(ticket_id: int, payload: AddPeopleBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ticket = _load_ticket(db, ticket_id, user, allow_admin=False)
    found = _recipient_ids(db, user, list(payload.users), list(payload.roles), payload.everyone)
    existing = {p.user_id for p in db.query(TicketParticipant).filter(TicketParticipant.ticket_id == ticket.id).all()}
    added: list[int] = []
    now = _now()
    for uid, via in found.items():
        if uid in existing:
            continue
        db.add(TicketParticipant(ticket_id=ticket.id, user_id=uid, added_via=via, added_at=now))
        added.append(uid)
    if added:
        role = _role_label(db, user)
        names = [_display(u) for u in db.query(models.User).filter(models.User.id.in_(added)).all()]
        system = TicketMessage(
            ticket_id=ticket.id,
            sender_id=user.id,
            sender_name=_display(user),
            sender_role=role,
            kind="system",
            body="added:" + ", ".join(names)[:500],
            created_at=now,
        )
        db.add(system)
        db.flush()
        ticket.last_message_at = now
        _notify(db, ticket, system, user, role, added, "added", ticket.subject)
        db.commit()
    return {"added": len(added)}


@router.get("/{ticket_id}/files/{file_id}")
def download_file(ticket_id: int, file_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ticket = _load_ticket(db, ticket_id, user)
    item = db.query(TicketAttachment).filter(TicketAttachment.id == file_id, TicketAttachment.ticket_id == ticket.id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="File not found")
    path = _stored_path(ticket.id, item.stored_name)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File is no longer on the server")
    inline = Path(item.original_name).suffix.lower() in INLINE_TYPES
    return FileResponse(
        path,
        media_type=item.content_type,
        filename=item.original_name,
        content_disposition_type="inline" if inline else "attachment",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.delete("/{ticket_id}", status_code=204)
def delete_ticket(ticket_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    for f in db.query(TicketAttachment).filter(TicketAttachment.ticket_id == ticket_id).all():
        try:
            _stored_path(ticket_id, f.stored_name).unlink(missing_ok=True)
        except (OSError, HTTPException):
            pass
    for model in (TicketAttachment, TicketNotification, TicketMessage, TicketParticipant):
        db.query(model).filter(model.ticket_id == ticket_id).delete()
    db.delete(ticket)
    db.commit()
    return None
