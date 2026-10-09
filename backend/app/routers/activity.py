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


def load_events(db: Session, start: date, end: date, username: str | None = None) -> list[Event]:
    """Audit rows of the range → classified, plant-local events."""
    lo, hi = _utc_bounds(start, end)
    A = models.AuditLog
    base_filter = [A.created_at >= lo, A.created_at < hi, A.success.is_(True), A.action.in_(("create", "update", "delete", "login"))]
    if username:
        base_filter.append(func.lower(A.username) == username.strip().lower())
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
                )
            )

    # Assembly Data: the change set tells assembled / disassembled / commissioned ...
    el_nr = func.coalesce(_json_text(A.after_data, "element_nr"), _json_text(A.before_data, "element_nr"))
    el_el = func.coalesce(_json_text(A.after_data, "electrolyzer"), _json_text(A.before_data, "electrolyzer"))
    el_pos = func.coalesce(_json_text(A.after_data, "position"), _json_text(A.before_data, "position"))
    for row in (
        db.query(A.created_at, A.username, A.action, A.resource, A.resource_id, A.path, A.changes, el_nr.label("el_nr"), el_el.label("el_el"), el_pos.label("el_pos"))
        .filter(*base_filter, A.resource == "elements")
        .all()
    ):
        add(row, row.el_nr, row.el_el, row.el_pos)

    # Inspection forms: only the element number is needed (their JSON carries signature images).
    for row in (
        db.query(A.created_at, A.username, A.action, A.resource, A.resource_id, A.path, el_nr.label("el_nr"), el_el.label("el_el"), el_pos.label("el_pos"))
        .filter(*base_filter, A.resource.in_(("inspection_reports", "assembly_inspection_reports")))
        .all()
    ):
        add(row, row.el_nr, row.el_el, row.el_pos)

    for row in (
        db.query(A.created_at, A.username, A.action, A.resource, A.resource_id, A.path)
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
    events = load_events(db, start, end, username)
    if role_id is not None:
        events = [e for e in events if _person(directory, e.username).get("role_id") == role_id]

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


# ---------------------------------------------------------------------------
# Cell shop (Assembly Data) – per-day element movements
# ---------------------------------------------------------------------------

@router.get("/cell-shop")
def cell_shop_daily(
    date_from: str | None = None,
    date_to: str | None = None,
    username: str | None = None,
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    directory = _user_directory(db)
    events = [e for e in load_events(db, start, end, username) if e.metric in ELEMENT_METRICS and not e.bulk]
    days: dict[date, dict[str, Any]] = {}
    for e in events:
        d = days.setdefault(e.day, {"date": e.day.isoformat(), "counts": Counter(), "users": defaultdict(Counter), "elements": {}})
        d["counts"][e.metric] += 1
        who = _person(directory, e.username)["username"]
        d["users"][who][e.metric] += 1
        if e.element_nr:
            item = d["elements"].setdefault(
                e.element_nr,
                {"element_nr": e.element_nr, "electrolyzer": e.electrolyzer, "position": e.position, "actions": [], "users": set()},
            )
            if e.metric not in item["actions"]:
                item["actions"].append(e.metric)
            item["users"].add(who)
    out = []
    for day in sorted(days, reverse=True):
        d = days[day]
        out.append(
            {
                "date": d["date"],
                "counts": {k: d["counts"].get(k, 0) for k in sorted(ELEMENT_METRICS)},
                "distinct_elements": len(d["elements"]),
                "users": [
                    {"username": who, "counts": {k: c.get(k, 0) for k in sorted(ELEMENT_METRICS)}, "total": sum(c.values())}
                    for who, c in sorted(d["users"].items(), key=lambda kv: -sum(kv[1].values()))
                ],
                "elements": [
                    {**el, "users": sorted(el["users"])}
                    for el in sorted(d["elements"].values(), key=lambda x: (x["electrolyzer"] or "", x["position"] or "", x["element_nr"]))
                ],
            }
        )
    return {"date_from": start.isoformat(), "date_to": end.isoformat(), "metrics": sorted(ELEMENT_METRICS), "days": out}


# ---------------------------------------------------------------------------
# Laboratory – what should have been entered and was not
# ---------------------------------------------------------------------------

def _combo_key(analysis_type: str | None, scope: str | None, electrolyzer: str | None, group_nr: str | None, sub_plant: str | None):
    return (
        (analysis_type or "").strip().lower(),
        (scope or "").strip().lower(),
        (electrolyzer or "").strip().upper(),
        (group_nr or "").strip(),
        (sub_plant or "").strip(),
    )


def _combo_label(key: tuple[str, str, str, str, str]) -> str:
    atype, _scope, el, grp, sub = key
    where = el or (f"group {grp}" if grp else "") or (sub and f"sub-plant {sub}") or "plant"
    return f"{atype} · {where}"


@router.get("/lab-compliance")
def lab_compliance(
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
):
    """Daily check: every enabled AriaLIMS sampling point (else every habitual sample) must have a sample."""
    start, end = _range(date_from, date_to)
    if (end - start).days > 62:
        raise HTTPException(status_code=400, detail="The laboratory check is limited to 62 days")
    today = (datetime.utcnow() + TZ_OFFSET).date()

    expected: dict[tuple, str] = {}
    source = "sampling_points"
    for p in db.query(models.AriaLimsSamplingPoint).filter(models.AriaLimsSamplingPoint.enabled.is_(True)).all():
        key = _combo_key(p.analysis_type, p.scope, p.electrolyzer, p.group_nr, p.sub_plant)
        expected.setdefault(key, p.name or _combo_label(key))

    S = models.AnalysisSample
    lo = datetime.combine(start, datetime.min.time())
    hi = datetime.combine(end + timedelta(days=1), datetime.min.time())
    actual: dict[date, set[tuple]] = defaultdict(set)
    for r in db.query(S.analysis_type, S.scope, S.electrolyzer, S.group_nr, S.sub_plant, S.date).filter(S.date >= lo, S.date < hi).all():
        if r.date:
            actual[r.date.date()].add(_combo_key(r.analysis_type, r.scope, r.electrolyzer, r.group_nr, r.sub_plant))

    if not expected:
        source = "habitual"
        back_lo = lo - timedelta(days=30)
        seen_days: dict[tuple, set[date]] = defaultdict(set)
        for r in db.query(S.analysis_type, S.scope, S.electrolyzer, S.group_nr, S.sub_plant, S.date).filter(S.date >= back_lo, S.date < hi).all():
            if r.date:
                seen_days[_combo_key(r.analysis_type, r.scope, r.electrolyzer, r.group_nr, r.sub_plant)].add(r.date.date())
        for key, ds in seen_days.items():
            if len(ds) >= 3:
                expected[key] = _combo_label(key)

    # Who typed each sample (from the audit trail; samples pulled by AriaLIMS have no user).
    A = models.AuditLog
    entered_by: dict[tuple[date, tuple], str] = {}
    for r in (
        db.query(
            A.username,
            _json_text(A.after_data, "analysis_type").label("l_t"),
            _json_text(A.after_data, "scope").label("l_s"),
            _json_text(A.after_data, "electrolyzer").label("l_e"),
            _json_text(A.after_data, "group_nr").label("l_g"),
            _json_text(A.after_data, "sub_plant").label("l_p"),
            _json_text(A.after_data, "date").label("l_d"),
        )
        .filter(A.resource == "analysis_samples", A.action == "create", _json_text(A.after_data, "date") >= start.isoformat(), _json_text(A.after_data, "date") < (end + timedelta(days=1)).isoformat())
        .all()
    ):
        try:
            day = date.fromisoformat((r.l_d or "")[:10])
        except ValueError:
            continue
        entered_by.setdefault((day, _combo_key(r.l_t, r.l_s, r.l_e, r.l_g, r.l_p)), r.username or "(AriaLIMS / automatic)")

    days = []
    by_type: Counter = Counter()
    by_user: Counter = Counter()
    exp_total = ent_total = 0
    d = end
    while d >= start:
        got = actual.get(d, set())
        done = [k for k in expected if k in got]
        missing = [k for k in expected if k not in got]
        is_open = d >= today
        users: Counter = Counter()
        for k in done:
            who = entered_by.get((d, k))
            if who:
                users[who] += 1
                by_user[who] += 1
        if not is_open:
            exp_total += len(expected)
            ent_total += len(done)
            for k in missing:
                by_type[k[0]] += 1
        days.append(
            {
                "date": d.isoformat(),
                "open": is_open,
                "expected": len(expected),
                "entered": len(done),
                "missing": len(missing),
                "missing_items": sorted(expected[k] for k in missing),
                "users": [{"username": u, "count": c} for u, c in users.most_common()],
            }
        )
        d -= timedelta(days=1)

    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "source": source,
        "expected_per_day": len(expected),
        "summary": {
            "expected": exp_total,
            "entered": ent_total,
            "missing": exp_total - ent_total,
            "completeness_pct": round(100.0 * ent_total / exp_total, 1) if exp_total else None,
        },
        "missing_by_type": [{"analysis_type": t, "missing": c} for t, c in by_type.most_common()],
        "entered_by_user": [{"username": u, "count": c} for u, c in by_user.most_common()],
        "days": days,
    }


# ---------------------------------------------------------------------------
# Technical inspection – counts and findings
# ---------------------------------------------------------------------------

_NO_FINDING = {"", "-", "--", "no", "none", "nil", "n/a", "na", "ok", "0", "ندارد", "خیر", "نه", "نیست", "بدون", "سالم"}
_FINDING_FIELDS = [
    "blister_anode_area",
    "blister_periphery_top",
    "blister_periphery_bottom",
    "blister_periphery_side",
    "blister_corners",
    "folds",
    "pressure_marks",
    "visible_holes",
    "cracks",
    "deformation_pan",
    "deformation_electrode",
    "leakage_pan",
    "leakage_web",
    "leakage_corner",
    "leakage_outlet",
    "leakage_inlet",
]


def _has_finding(value: Any) -> bool:
    return str(value or "").strip().lower() not in _NO_FINDING


@router.get("/inspections")
def inspection_results(
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    R = models.InspectionReport
    reports = (
        db.query(R)
        .filter(R.inspection_date >= datetime.combine(start, datetime.min.time()), R.inspection_date < datetime.combine(end + timedelta(days=1), datetime.min.time()))
        .all()
    )
    per_day: dict[str, dict[str, Any]] = {}
    per_inspector: dict[str, dict[str, Any]] = {}
    reasons: Counter = Counter()
    finding_fields: Counter = Counter()
    for r in reports:
        day = r.inspection_date.date().isoformat() if r.inspection_date else "?"
        who = (r.inspector_name or r.sign_insp_name or "").strip() or "(unknown)"
        found = [f for f in _FINDING_FIELDS if _has_finding(getattr(r, f, None))]
        for f in found:
            finding_fields[f] += 1
        reasons[(r.inspection_reason or "").strip() or "(none)"] += 1
        for table, key in ((per_day, day), (per_inspector, who)):
            row = table.setdefault(key, {"key": key, "reports": 0, "with_findings": 0, "elements": set()})
            row["reports"] += 1
            row["with_findings"] += 1 if found else 0
            if r.element_nr:
                row["elements"].add(r.element_nr)

    A = models.AssemblyInspectionReport
    assembly = db.query(A).filter(A.assembly_date >= start, A.assembly_date <= end).all()
    asm_day: dict[str, dict[str, Any]] = {}
    asm_who: dict[str, dict[str, Any]] = {}
    failed_checks: Counter = Counter()
    for a in assembly:
        checks = a.checks or {}
        failed = [k for k, v in checks.items() if not v]
        status = "incomplete" if not checks else ("passed" if not failed else "failed")
        for k in failed:
            failed_checks[k] += 1
        day = a.assembly_date.isoformat() if a.assembly_date else "?"
        who = (a.sign_insp_name or "").strip() or "(unsigned)"
        for table, key in ((asm_day, day), (asm_who, who)):
            row = table.setdefault(key, {"key": key, "reports": 0, "passed": 0, "failed": 0, "incomplete": 0, "elements": set()})
            row["reports"] += 1
            row[status] += 1
            if a.element_nr:
                row["elements"].add(a.element_nr)

    def listing(table: dict, newest_first: bool):
        items = []
        for row in table.values():
            item = {**row, "elements": len(row["elements"])}
            items.append(item)
        return sorted(items, key=lambda x: x["key"], reverse=newest_first)

    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "note": "A report counts as 'with findings' when any defect field (blisters, folds, holes, cracks, deformation, leakage) holds text other than none/ok/0/-.",
        "inspection_reports": {
            "total": len(reports),
            "with_findings": sum(r["with_findings"] for r in per_day.values()),
            "by_day": listing(per_day, True),
            "by_inspector": listing(per_inspector, False),
            "by_reason": [{"reason": k, "count": c} for k, c in reasons.most_common()],
            "top_findings": [{"field": k, "count": c} for k, c in finding_fields.most_common(10)],
        },
        "assembly_reports": {
            "total": len(assembly),
            "passed": sum(r["passed"] for r in asm_day.values()),
            "failed": sum(r["failed"] for r in asm_day.values()),
            "incomplete": sum(r["incomplete"] for r in asm_day.values()),
            "by_day": listing(asm_day, True),
            "by_inspector": listing(asm_who, False),
            "top_failed_checks": [{"check": k, "count": c} for k, c in failed_checks.most_common(10)],
        },
    }


# ---------------------------------------------------------------------------
# Drill-down: the individual actions behind a number
# ---------------------------------------------------------------------------

@router.get("/events")
def activity_events(
    date_from: str | None = None,
    date_to: str | None = None,
    username: str | None = None,
    metric: str | None = None,
    group: str | None = None,
    include_bulk: bool = False,
    limit: int = Query(default=300, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    wanted = {k for k, g in METRICS if g == group} if group else None
    events = [
        e
        for e in load_events(db, start, end, username)
        if (include_bulk or not e.bulk) and (not metric or e.metric == metric) and (wanted is None or e.metric in wanted)
    ]
    events.sort(key=lambda e: e.at, reverse=True)
    return {
        "total": len(events),
        "items": [
            {
                "at": e.at.isoformat(),
                "username": e.username or "(system)",
                "metric": e.metric,
                "resource": e.resource,
                "resource_id": e.resource_id,
                "element_nr": e.element_nr,
                "electrolyzer": e.electrolyzer,
                "position": e.position,
                "bulk": e.bulk,
            }
            for e in events[:limit]
        ],
    }
