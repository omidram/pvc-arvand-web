"""
Application-wide audit logging.

- SQLAlchemy flush hooks capture create / update / delete on every ORM table
  (with before/after field diffs).
- HTTP middleware records mutating API calls (who, path, status, IP, body).
- Explicit helpers cover auth events (login success/failure, password change).

Only administrators may read logs via /api/logs.
"""
from __future__ import annotations

import json
from contextvars import ContextVar
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import event, inspect as sa_inspect
from sqlalchemy.orm import Session, object_mapper

from .database import SessionLocal
from . import models

# ---------------------------------------------------------------------------
# Request-scoped actor context (set by middleware)
# ---------------------------------------------------------------------------

_audit_ctx: ContextVar[dict[str, Any]] = ContextVar(
    "audit_ctx",
    default={
        "user_id": None,
        "username": None,
        "user_role": None,
        "ip_address": None,
        "user_agent": None,
        "method": None,
        "path": None,
    },
)

SENSITIVE_KEYS = {
    "password",
    "password_hash",
    "current_password",
    "new_password",
    "access_token",
    "token",
    "secret",
    "jwt",
    "authorization",
}

SKIP_TABLES = {"audit_logs"}

MAX_JSON_CHARS = 40_000


def set_audit_context(**kwargs: Any) -> None:
    current = dict(_audit_ctx.get())
    current.update(kwargs)
    _audit_ctx.set(current)


def get_audit_context() -> dict[str, Any]:
    return dict(_audit_ctx.get())


def clear_audit_context() -> None:
    _audit_ctx.set(
        {
            "user_id": None,
            "username": None,
            "user_role": None,
            "ip_address": None,
            "user_agent": None,
            "method": None,
            "path": None,
        }
    )


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, bytes):
        return f"<bytes:{len(value)}>"
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    return str(value)


def redact(data: Any) -> Any:
    if isinstance(data, dict):
        out = {}
        for key, value in data.items():
            lk = str(key).lower()
            if lk in SENSITIVE_KEYS or any(s in lk for s in ("password", "secret", "token")):
                out[key] = "***"
            else:
                out[key] = redact(value)
        return out
    if isinstance(data, list):
        return [redact(v) for v in data]
    return _json_safe(data)


def _truncate(data: Any) -> Any:
    try:
        raw = json.dumps(data, ensure_ascii=False, default=str)
    except Exception:
        return {"_error": "unserializable"}
    if len(raw) <= MAX_JSON_CHARS:
        return data
    return {"_truncated": True, "_chars": len(raw), "preview": raw[:MAX_JSON_CHARS]}


def serialize_orm(obj: Any) -> dict[str, Any] | None:
    if obj is None:
        return None
    try:
        mapper = object_mapper(obj)
    except Exception:
        return None
    data: dict[str, Any] = {}
    for col in mapper.columns:
        data[col.key] = getattr(obj, col.key, None)
    return redact(data)


def pk_str(obj: Any) -> str | None:
    try:
        insp = sa_inspect(obj)
        identity = insp.identity
        if not identity:
            data = serialize_orm(obj) or {}
            for key in ("id", "nr", "anode_nr", "cathode_nr", "membrane_nr", "username"):
                if data.get(key) is not None:
                    return str(data[key])
            return None
        if len(identity) == 1:
            return str(identity[0])
        return "|".join(str(x) for x in identity)
    except Exception:
        return None


def write_audit(
    *,
    action: str,
    resource: str | None = None,
    resource_id: str | None = None,
    method: str | None = None,
    path: str | None = None,
    status_code: int | None = None,
    summary: str | None = None,
    before_data: Any = None,
    after_data: Any = None,
    changes: Any = None,
    request_body: Any = None,
    success: bool = True,
    user_id: int | None = None,
    username: str | None = None,
    user_role: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Persist one audit row in an isolated session (never nested in audited flush)."""
    ctx = get_audit_context()
    try:
        db = SessionLocal()
        db.info["skip_audit"] = True
        row = models.AuditLog(
            user_id=user_id if user_id is not None else ctx.get("user_id"),
            username=username if username is not None else ctx.get("username"),
            user_role=user_role if user_role is not None else ctx.get("user_role"),
            action=action,
            resource=resource,
            resource_id=str(resource_id) if resource_id is not None else None,
            method=method if method is not None else ctx.get("method"),
            path=path if path is not None else ctx.get("path"),
            status_code=status_code,
            ip_address=ip_address if ip_address is not None else ctx.get("ip_address"),
            user_agent=(user_agent if user_agent is not None else ctx.get("user_agent") or "")[:255] or None,
            summary=(summary or "")[:500] or None,
            before_data=_truncate(redact(before_data)) if before_data is not None else None,
            after_data=_truncate(redact(after_data)) if after_data is not None else None,
            changes=_truncate(redact(changes)) if changes is not None else None,
            request_body=_truncate(redact(request_body)) if request_body is not None else None,
            success=success,
        )
        db.add(row)
        db.commit()
    except Exception:
        # Audit must never break the main request.
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        try:
            db.close()
        except Exception:
            pass


def _diff(before: dict | None, after: dict | None) -> dict[str, dict[str, Any]] | None:
    if not before and not after:
        return None
    before = before or {}
    after = after or {}
    keys = set(before) | set(after)
    changes: dict[str, dict[str, Any]] = {}
    for key in keys:
        old = before.get(key)
        new = after.get(key)
        if old != new:
            changes[key] = {"old": old, "new": new}
    return changes or None


def _queue_event(session: Session, event: dict[str, Any]) -> None:
    bucket = session.info.setdefault("audit_events", [])
    bucket.append(event)


def _flush_queued_events(session: Session) -> None:
    events = session.info.pop("audit_events", [])
    if not events:
        return
    ctx = get_audit_context()
    for event_data in events:
        write_audit(
            action=event_data["action"],
            resource=event_data.get("resource"),
            resource_id=event_data.get("resource_id"),
            summary=event_data.get("summary"),
            before_data=event_data.get("before_data"),
            after_data=event_data.get("after_data"),
            changes=event_data.get("changes"),
            success=True,
            user_id=ctx.get("user_id"),
            username=ctx.get("username"),
            user_role=ctx.get("user_role"),
            method=ctx.get("method"),
            path=ctx.get("path"),
            ip_address=ctx.get("ip_address"),
            user_agent=ctx.get("user_agent"),
        )


def _table_name(obj: Any) -> str:
    try:
        return object_mapper(obj).local_table.name
    except Exception:
        return obj.__class__.__name__


@event.listens_for(Session, "before_flush")
def _audit_before_flush(session: Session, _flush_context, _instances) -> None:
    if session.info.get("skip_audit"):
        return

    for obj in list(session.new):
        table = _table_name(obj)
        if table in SKIP_TABLES:
            continue
        after = serialize_orm(obj)
        _queue_event(
            session,
            {
                "action": "create",
                "resource": table,
                "resource_id": pk_str(obj),
                "summary": f"Created {table}",
                "after_data": after,
                "changes": _diff(None, after),
            },
        )

    for obj in list(session.dirty):
        table = _table_name(obj)
        if table in SKIP_TABLES:
            continue
        if not session.is_modified(obj, include_collections=False):
            continue
        insp = sa_inspect(obj)
        before: dict[str, Any] = {}
        after: dict[str, Any] = {}
        for attr in insp.mapper.column_attrs:
            hist = insp.attrs[attr.key].history
            if hist.has_changes():
                old = hist.deleted[0] if hist.deleted else None
                new = hist.added[0] if hist.added else getattr(obj, attr.key, None)
                before[attr.key] = old
                after[attr.key] = new
        if not before and not after:
            continue
        full_after = serialize_orm(obj)
        _queue_event(
            session,
            {
                "action": "update",
                "resource": table,
                "resource_id": pk_str(obj),
                "summary": f"Updated {table}",
                "before_data": redact(before),
                "after_data": full_after,
                "changes": _diff(redact(before), redact(after)),
            },
        )

    for obj in list(session.deleted):
        table = _table_name(obj)
        if table in SKIP_TABLES:
            continue
        before = serialize_orm(obj)
        _queue_event(
            session,
            {
                "action": "delete",
                "resource": table,
                "resource_id": pk_str(obj),
                "summary": f"Deleted {table}",
                "before_data": before,
                "changes": _diff(before, None),
            },
        )


@event.listens_for(Session, "after_commit")
def _audit_after_commit(session: Session) -> None:
    if session.info.get("skip_audit"):
        return
    _flush_queued_events(session)


@event.listens_for(Session, "after_rollback")
def _audit_after_rollback(session: Session) -> None:
    session.info.pop("audit_events", None)


def log_auth_event(
    *,
    action: str,
    username: str | None,
    success: bool,
    summary: str,
    user_id: int | None = None,
    user_role: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    details: dict | None = None,
) -> None:
    write_audit(
        action=action,
        resource="auth",
        resource_id=username,
        summary=summary,
        after_data=details,
        success=success,
        user_id=user_id,
        username=username,
        user_role=user_role,
        ip_address=ip_address,
        user_agent=user_agent,
        method="POST",
        path="/api/auth/login" if action.startswith("login") else None,
    )


def parse_client_ip(request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client:
        return (request.client.host or "")[:64] or None
    return None
