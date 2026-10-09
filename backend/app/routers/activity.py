"""Work-activity reports: who did what, per day / week / month.

Everything is derived from the audit trail (``audit_logs``), which already records
every create / update / delete together with the signed-in user. Rows written by
imports, syncs and repairs are kept apart (``bulk``) so they do not inflate a
person's daily numbers.

Access: form key ``activity`` (admins always; other roles via Users → role permissions).
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..export_utils import export_xlsx
from ..plant_import import gregorian_to_jalali, jalali_to_gregorian

router = APIRouter(prefix="/activity", tags=["activity"])

# Plant time is Iran Standard Time (UTC+03:30, no DST); audit rows are stored in UTC.
TZ_OFFSET = timedelta(minutes=210)
MAX_DAYS = 400
BULK_PATH_MARKERS = ("/import", "import-", "/sync", "ingest", "/integrity/repair", "/restore", "/seed", "/arialims")

# (metric key, group) in display order.
METRICS: list[tuple[str, str]] = [
    ("el_new", "cell_shop"),
    ("el_assembled", "cell_shop"),
    ("el_disassembled", "cell_shop"),
    ("el_commissioned", "cell_shop"),
    ("el_decommissioned", "cell_shop"),
    ("el_edited", "cell_shop"),
    ("el_deleted", "cell_shop"),
    ("components", "cell_shop"),
    ("maintenance", "cell_shop"),
    ("wh_dispatch", "warehouse"),
    ("wh_receiving", "warehouse"),
    ("wh_purchase", "warehouse"),
    ("wh_punch", "warehouse"),
    ("wh_decommission", "warehouse"),
    ("wh_other", "warehouse"),
    ("lab_samples", "lab"),
    ("lab_edited", "lab"),
    ("insp_reports", "inspection"),
    ("insp_assembly", "inspection"),
    ("insp_edited", "inspection"),
    ("op_voltage", "operation"),
    ("op_shutdown", "operation"),
    ("op_ce", "operation"),
    ("op_remarks", "operation"),
    ("other", "other"),
    ("logins", "other"),
]
METRIC_KEYS = [m for m, _ in METRICS]
ELEMENT_METRICS = {"el_new", "el_assembled", "el_disassembled", "el_commissioned", "el_decommissioned", "el_edited", "el_deleted"}

COMPONENT_TABLES = {"anodes", "cathodes", "membranes", "cell_components"}
MAINTENANCE_TABLES = {
    "maintenance_reports",
    "maintenance_report_files",
    "anode_maintenance",
    "cathode_maintenance",
    "membrane_maintenance",
    "anode_recoating",
    "cathode_recoating",
    "anode_coating_checks",
    "cathode_coating_checks",
    "electrode_segregations",
}
WH_METRIC = {
    "wh_coating_dispatches": "wh_dispatch",
    "wh_coating_receivings": "wh_receiving",
    "wh_purchases": "wh_purchase",
    "wh_punches": "wh_punch",
    "wh_decommissions": "wh_decommission",
    "wh_companies": "wh_other",
}
# Side-effect tables that mirror the rows above; counting them would double the numbers.
WH_DERIVED = {
    "wh_element_states",
    "wh_lifecycle_events",
    "wh_coating_dispatch_items",
    "wh_coating_receiving_items",
    "wh_purchase_items",
}
OPERATION_TABLES = {
    "voltage_readings": "op_voltage",
    "voltage_un_element_inputs": "op_voltage",
    "voltage_un_group_inputs": "op_voltage",
    "electrolyzer_normalizations": "op_voltage",
    "shutdowns": "op_shutdown",
    "current_efficiency_entries": "op_ce",
    "remarks": "op_remarks",
    "performance_tests": "op_remarks",
}
ELEMENT_TABLES = ("elements", "inspection_reports", "assembly_inspection_reports", "inspection_halfshell_grids")


@dataclass
class Event:
    at: datetime  # plant-local time
    username: str
    metric: str
    resource: str
    resource_id: str | None
    bulk: bool
    element_nr: str | None = None
    electrolyzer: str | None = None
    position: str | None = None
    audit_id: int = 0
    action: str = ""

    @property
    def day(self) -> date:
        return self.at.date()


def _filled(value: Any) -> bool:
    return value not in (None, "", [], {})


def _newly_set(changes: dict | None, field_name: str) -> bool:
    ch = (changes or {}).get(field_name)
    return isinstance(ch, dict) and _filled(ch.get("new")) and not _filled(ch.get("old"))


def _classify(resource: str, action: str, changes: dict | None) -> list[str]:
    """Metric keys one audit row counts towards."""
    if action == "login":
        return ["logins"]
    if action not in ("create", "update", "delete"):
        return []
    if resource == "elements":
        if action == "delete":
            return ["el_deleted"]
        out: list[str] = []
        if action == "create":
            out.append("el_new")
        if _newly_set(changes, "assembly_date"):
            out.append("el_assembled")
        if _newly_set(changes, "disassembly_date"):
            out.append("el_disassembled")
        if _newly_set(changes, "commissioning_date"):
            out.append("el_commissioned")
        if _newly_set(changes, "decommissioning_date"):
            out.append("el_decommissioned")
        if not out:
            out.append("el_edited")
        return out
    if resource in COMPONENT_TABLES:
        return ["components"]
    if resource in MAINTENANCE_TABLES:
        return ["maintenance"]
    if resource in WH_DERIVED:
        return []
    if resource in WH_METRIC:
        return [WH_METRIC[resource]]
    if resource == "analysis_samples":
        return ["lab_samples" if action == "create" else "lab_edited"]
    if resource == "inspection_reports":
        return ["insp_reports" if action == "create" else "insp_edited"]
    if resource == "assembly_inspection_reports":
        return ["insp_assembly" if action == "create" else "insp_edited"]
    if resource == "inspection_halfshell_grids":
        return ["insp_edited"]
    if resource in OPERATION_TABLES:
        return [OPERATION_TABLES[resource]]
    if resource in ("audit_logs", "auth", "alert_events"):
        return []
    return ["other"]


def _is_bulk(path: str | None) -> bool:
    p = (path or "").lower()
    return any(m in p for m in BULK_PATH_MARKERS)


def _parse_day(value: str | None, label: str) -> date:
    try:
        return date.fromisoformat((value or "")[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{label} must be YYYY-MM-DD") from exc


def _range(date_from: str | None, date_to: str | None) -> tuple[date, date]:
    today = (datetime.utcnow() + TZ_OFFSET).date()
    end = _parse_day(date_to, "date_to") if date_to else today
    start = _parse_day(date_from, "date_from") if date_from else end - timedelta(days=6)
    if start > end:
        start, end = end, start
    if (end - start).days > MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"The range is limited to {MAX_DAYS} days")
    return start, end


def _utc_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    lo = datetime.combine(start, datetime.min.time()) - TZ_OFFSET
    hi = datetime.combine(end + timedelta(days=1), datetime.min.time()) - TZ_OFFSET
    return lo, hi


def _period(d: date, granularity: str, calendar: str) -> tuple[str, date, date]:
    if granularity == "week":
        start_wd = 5 if calendar == "jalali" else 0  # Saturday-first for Jalali, Monday-first otherwise
        s = d - timedelta(days=(d.weekday() - start_wd) % 7)
        return s.isoformat(), s, s + timedelta(days=6)
    if granularity == "month":
        if calendar == "jalali":
            jy, jm, _ = gregorian_to_jalali(d.year, d.month, d.day)
            s = jalali_to_gregorian(jy, jm, 1)
            ny, nm = (jy + 1, 1) if jm == 12 else (jy, jm + 1)
            e = jalali_to_gregorian(ny, nm, 1) - timedelta(days=1)
            return f"{jy}-{jm:02d}", s, e
        s = d.replace(day=1)
        e = (s.replace(year=s.year + 1, month=1) if s.month == 12 else s.replace(month=s.month + 1)) - timedelta(days=1)
        return f"{s.year}-{s.month:02d}", s, e
    return d.isoformat(), d, d


def _json_text(column, key: str):
    return column[key].as_string()


def resolve_users(directory: dict[str, dict[str, Any]], username: str | None, role_id: int | None) -> set[str] | None:
    """Lower-case usernames matching the user / role filter (None = no filter)."""
    if not username and role_id is None:
        return None
    wanted = {
        key
        for key, info in directory.items()
        if (not username or key == username.strip().lower()) and (role_id is None or info["role_id"] == role_id)
    }
    if username and role_id is None:
        wanted.add(username.strip().lower())  # also accounts that were deleted later
    return wanted


def load_events(db: Session, start: date, end: date, users: set[str] | None = None) -> list[Event]:
    """Audit rows of the range → classified, plant-local events."""
    if users is not None and not users:
        return []
    lo, hi = _utc_bounds(start, end)
    A = models.AuditLog
    base_filter = [A.created_at >= lo, A.created_at < hi, A.success.is_(True), A.action.in_(("create", "update", "delete", "login"))]
    if users is not None:
        base_filter.append(func.lower(A.username).in_(sorted(users)))
    events: list[Event] = []

    def add(row: Any, element_nr=None, electrolyzer=None, position=None) -> None:
        changes = getattr(row, "changes", None)
        for metric in _classify(row.resource or "", row.action, changes if isinstance(changes, dict) else None):
            if not row.username and metric == "other":
                continue  # start-up seeding / scheduled jobs: configuration noise, not anyone's work
            events.append(
                Event(
                    at=row.created_at + TZ_OFFSET,
                    username=row.username or "",
                    metric=metric,
                    resource=row.resource or "",
                    resource_id=row.resource_id,
                    bulk=_is_bulk(row.path) and row.action != "login",
                    element_nr=element_nr,
                    electrolyzer=electrolyzer,
                    position=position,
                    audit_id=row.id,
                    action=row.action,
                )
            )

    # Assembly Data: the change set tells assembled / disassembled / commissioned ...
    el_nr = func.coalesce(_json_text(A.after_data, "element_nr"), _json_text(A.before_data, "element_nr"))
    el_el = func.coalesce(_json_text(A.after_data, "electrolyzer"), _json_text(A.before_data, "electrolyzer"))
    el_pos = func.coalesce(_json_text(A.after_data, "position"), _json_text(A.before_data, "position"))
    for row in (
        db.query(A.id, A.created_at, A.username, A.action, A.resource, A.resource_id, A.path, A.changes, el_nr.label("el_nr"), el_el.label("el_el"), el_pos.label("el_pos"))
        .filter(*base_filter, A.resource == "elements")
        .all()
    ):
        add(row, row.el_nr, row.el_el, row.el_pos)

    # Inspection forms: only the element number is needed (their JSON carries signature images).
    for row in (
        db.query(A.id, A.created_at, A.username, A.action, A.resource, A.resource_id, A.path, el_nr.label("el_nr"), el_el.label("el_el"), el_pos.label("el_pos"))
        .filter(*base_filter, A.resource.in_(("inspection_reports", "assembly_inspection_reports")))
        .all()
    ):
        add(row, row.el_nr, row.el_el, row.el_pos)

    for row in (
        db.query(A.id, A.created_at, A.username, A.action, A.resource, A.resource_id, A.path)
        .filter(*base_filter, A.resource.notin_(("elements", "inspection_reports", "assembly_inspection_reports")))
        .all()
    ):
        add(row)
    return events


def _user_directory(db: Session) -> dict[str, dict[str, Any]]:
    roles = {r.id: r.name for r in db.query(models.AppRole).all()}
    out: dict[str, dict[str, Any]] = {}
    for u in db.query(models.User).all():
        out[u.username.lower()] = {
            "username": u.username,
            "full_name": u.full_name,
            "department": roles.get(u.role_id) if u.role_id else None,
            "role_id": u.role_id,
            "is_active": u.is_active,
        }
    return out


def _person(directory: dict[str, dict[str, Any]], username: str) -> dict[str, Any]:
    if not username:
        return {"username": "(system)", "full_name": "Automatic / background jobs", "department": None, "role_id": None}
    info = directory.get(username.lower())
    return info or {"username": username, "full_name": None, "department": None, "role_id": None}


@router.get("/meta")
def activity_meta(db: Session = Depends(get_db)):
    roles = db.query(models.AppRole).order_by(models.AppRole.name).all()
    users = db.query(models.User).filter(models.User.is_active.is_(True)).order_by(models.User.username).all()
    return {
        "metrics": [{"key": k, "group": g} for k, g in METRICS],
        "departments": [{"id": r.id, "name": r.name} for r in roles],
        "users": [{"username": u.username, "full_name": u.full_name, "role_id": u.role_id} for u in users],
        "tz_offset_minutes": int(TZ_OFFSET.total_seconds() // 60),
    }


def _empty_counts() -> dict[str, int]:
    return {k: 0 for k in METRIC_KEYS}


def _build_summary(db: Session, start: date, end: date, granularity: str, calendar: str, username: str | None, role_id: int | None):
    directory = _user_directory(db)
    events = load_events(db, start, end, resolve_users(directory, username, role_id))

    cells: dict[tuple[str, str], dict[str, Any]] = {}
    totals: dict[str, dict[str, Any]] = {}

    def slot(table: dict, key, make):
        if key not in table:
            table[key] = make()
        return table[key]

    def new_cell():
        return {"counts": _empty_counts(), "bulk": 0, "elements": set(), "days": set(), "first_at": None, "last_at": None}

    for e in events:
        pkey, ps, pe = _period(e.day, granularity, calendar)
        person = _person(directory, e.username)["username"]
        for cell in (slot(cells, (pkey, person), new_cell), slot(totals, person, new_cell)):
            if e.bulk:
                cell["bulk"] += 1
                continue
            cell["counts"][e.metric] += 1
            cell["days"].add(e.day)
            if e.element_nr and e.metric in ELEMENT_METRICS | {"insp_reports", "insp_assembly"}:
                cell["elements"].add(e.element_nr)
            if cell["first_at"] is None or e.at < cell["first_at"]:
                cell["first_at"] = e.at
            if cell["last_at"] is None or e.at > cell["last_at"]:
                cell["last_at"] = e.at
        cells[(pkey, person)]["_period"] = (ps, pe)

    def render(cell: dict, who: str) -> dict[str, Any]:
        info = _person(directory, "" if who == "(system)" else who)
        return {
            "username": info["username"],
            "full_name": info.get("full_name"),
            "department": info.get("department"),
            "counts": cell["counts"],
            "total": sum(v for k, v in cell["counts"].items() if k != "logins"),
            "bulk": cell["bulk"],
            "distinct_elements": len(cell["elements"]),
            "active_days": len(cell["days"]),
            "first_at": cell["first_at"].isoformat() if cell["first_at"] else None,
            "last_at": cell["last_at"].isoformat() if cell["last_at"] else None,
        }

    rows = []
    period_totals: dict[str, dict[str, Any]] = {}
    for (pkey, who), cell in sorted(cells.items(), key=lambda kv: (kv[0][0], kv[0][1].lower())):
        ps, pe = cell["_period"]
        row = render(cell, who)
        row.update({"period": pkey, "period_start": ps.isoformat(), "period_end": pe.isoformat()})
        rows.append(row)
        pt = period_totals.setdefault(
            pkey,
            {"period": pkey, "period_start": ps.isoformat(), "period_end": pe.isoformat(), "counts": _empty_counts(), "users": 0, "bulk": 0},
        )
        pt["users"] += 1
        pt["bulk"] += cell["bulk"]
        for k, v in cell["counts"].items():
            pt["counts"][k] += v

    user_totals = sorted((render(c, who) for who, c in totals.items()), key=lambda r: (-r["total"], r["username"].lower()))
    seen = {r["username"].lower() for r in user_totals}
    idle = [
        {"username": d["username"], "full_name": d["full_name"], "department": d["department"]}
        for d in directory.values()
        if d["is_active"]
        and d["username"].lower() not in seen
        and (role_id is None or d["role_id"] == role_id)
        and (not username or d["username"].lower() == username.strip().lower())
    ]
    return rows, user_totals, sorted(period_totals.values(), key=lambda p: p["period"]), idle


@router.get("/summary")
def activity_summary(
    date_from: str | None = None,
    date_to: str | None = None,
    granularity: str = Query(default="day", pattern="^(day|week|month)$"),
    calendar: str = Query(default="gregorian", pattern="^(gregorian|jalali)$"),
    username: str | None = None,
    role_id: int | None = None,
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    rows, user_totals, period_totals, idle = _build_summary(db, start, end, granularity, calendar, username, role_id)
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "granularity": granularity,
        "calendar": calendar,
        "metrics": [{"key": k, "group": g} for k, g in METRICS],
        "rows": rows,
        "user_totals": user_totals,
        "period_totals": period_totals,
        "inactive_users": idle,
    }


@router.get("/summary/export.xlsx", include_in_schema=False)
def activity_summary_export(
    date_from: str | None = None,
    date_to: str | None = None,
    granularity: str = Query(default="day", pattern="^(day|week|month)$"),
    calendar: str = Query(default="gregorian", pattern="^(gregorian|jalali)$"),
    username: str | None = None,
    role_id: int | None = None,
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    rows, _, _, _ = _build_summary(db, start, end, granularity, calendar, username, role_id)
    fields = ["period", "period_start", "period_end", "username", "full_name", "department", *METRIC_KEYS, "distinct_elements", "active_days", "bulk", "first_at", "last_at"]
    flat = []
    for r in rows:
        item = {k: r.get(k) for k in fields if k not in METRIC_KEYS}
        item.update(r["counts"])
        flat.append(item)
    return export_xlsx(flat, fields, "activity")
