"""Detailed work-activity reports built on the audit trail and the plant tables.

Companion of ``activity.py`` (same ``/activity`` prefix, same ``activity`` form key):

* ``/events``            – every single action (what / who / when / which record / what changed)
* ``/user-detail``       – one person: day by day, hour by hour, per form, logins
* ``/cell-shop``         – Assembly Data movements per day with the element list
* ``/warehouse``         – dispatches, receivings, purchases, punches, decommissions
* ``/lab-compliance``    – expected vs entered samples, who entered what
* ``/inspections``       – inspection / assembly-check reports and their findings

All endpoints accept the same ``username`` / ``role_id`` filter (a role = a department).
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..assembly_inspection_def import ACTIVITY_SECTIONS
from ..database import get_db
from ..export_utils import export_xlsx
from .activity import (
    ELEMENT_METRICS,
    METRICS,
    TZ_OFFSET,
    Event,
    _json_text,
    clean_electrolyzer,
    _person,
    _range,
    _user_directory,
    load_events,
    resolve_users,
)

router = APIRouter(prefix="/activity", tags=["activity"])

METRIC_GROUP = dict(METRICS)
CHECK_LABELS = {item["key"]: item["label"] for section in ACTIVITY_SECTIONS for item in section["items"]}
TARGET_KEYS = (
    "element_nr",
    "electrolyzer",
    "position",
    "group_nr",
    "anode_nr",
    "cathode_nr",
    "membrane_nr",
    "membrane_type",
    "analysis_type",
    "scope",
    "serial",
    "element_kind",
    "send_no",
    "receive_no",
    "purchase_no",
    "name",
    "date",
    "time",
    "reading_date",
    "shutdown_time",
    "code",
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _chunks(seq: list, size: int = 400) -> Iterable[list]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def _creators(db: Session, resource: str, ids: Iterable[Any]) -> dict[str, tuple[str, datetime]]:
    """record id → (username, plant-local time) of the audit 'create' row."""
    A = models.AuditLog
    wanted = sorted({str(i) for i in ids if i is not None})
    out: dict[str, tuple[str, datetime]] = {}
    for chunk in _chunks(wanted):
        for r in (
            db.query(A.resource_id, A.username, A.created_at)
            .filter(A.resource == resource, A.action == "create", A.resource_id.in_(chunk))
            .order_by(A.id)
            .all()
        ):
            out.setdefault(r.resource_id, (r.username or "", r.created_at + TZ_OFFSET))
    return out


def _allowed(users: set[str] | None, who: str | None) -> bool:
    return users is None or bool(who and who.lower() in users)


def _short(value: Any, limit: int = 90) -> str:
    text = "" if value is None else str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _trim_changes(changes: Any, created: bool, limit: int = 18) -> list[dict[str, str]]:
    if not isinstance(changes, dict):
        return []
    out: list[dict[str, str]] = []
    for name, ch in changes.items():
        low = str(name).lower()
        if low == "id" or low.endswith("_image") or "password" in low:
            continue
        if not isinstance(ch, dict):
            continue
        old, new = ch.get("old"), ch.get("new")
        if created and new in (None, "", [], {}):
            continue
        out.append({"field": str(name), "old": _short(old), "new": _short(new)})
        if len(out) >= limit:
            break
    return out


def _event_details(db: Session, ids: list[int]) -> dict[int, dict[str, Any]]:
    A = models.AuditLog
    out: dict[int, dict[str, Any]] = {}
    for chunk in _chunks(sorted(set(ids)), 150):
        for r in db.query(A.id, A.action, A.changes, A.after_data, A.before_data, A.ip_address, A.path, A.summary).filter(A.id.in_(chunk)).all():
            source = r.after_data if isinstance(r.after_data, dict) else (r.before_data if isinstance(r.before_data, dict) else {})
            target = {k: _short(source.get(k), 60) for k in TARGET_KEYS if source.get(k) not in (None, "")}
            out[r.id] = {
                "changes": _trim_changes(r.changes, r.action == "create"),
                "target": dict(list(target.items())[:8]),
                "ip": r.ip_address,
                "path": r.path,
                "summary": r.summary,
            }
    return out


def _filtered_events(
    db: Session,
    start: date,
    end: date,
    username: str | None,
    role_id: int | None,
    group: str | None = None,
    metric: str | None = None,
    resource: str | None = None,
    q: str | None = None,
    include_bulk: bool = False,
) -> tuple[list[Event], dict[str, dict[str, Any]]]:
    directory = _user_directory(db)
    events = load_events(db, start, end, resolve_users(directory, username, role_id))
    needle = (q or "").strip().lower()
    out = []
    for e in events:
        if e.bulk and not include_bulk:
            continue
        if metric and e.metric != metric:
            continue
        if group and METRIC_GROUP.get(e.metric) != group:
            continue
        if resource and e.resource != resource:
            continue
        if needle and needle not in " ".join(str(x or "") for x in (e.element_nr, e.resource, e.resource_id, e.username, e.electrolyzer)).lower():
            continue
        out.append(e)
    out.sort(key=lambda e: (e.at, e.audit_id), reverse=True)
    return out, directory


def _event_row(e: Event, directory: dict[str, dict[str, Any]], detail: dict[str, Any] | None) -> dict[str, Any]:
    person = _person(directory, e.username)
    return {
        "id": e.audit_id,
        "at": e.at.isoformat(),
        "username": person["username"],
        "full_name": person.get("full_name"),
        "department": person.get("department"),
        "group": METRIC_GROUP.get(e.metric),
        "metric": e.metric,
        "action": e.action,
        "resource": e.resource,
        "resource_id": e.resource_id,
        "element_nr": e.element_nr,
        "electrolyzer": e.electrolyzer,
        "position": e.position,
        "bulk": e.bulk,
        "target": (detail or {}).get("target", {}),
        "changes": (detail or {}).get("changes", []),
        "ip": (detail or {}).get("ip"),
        "path": (detail or {}).get("path"),
    }


# ---------------------------------------------------------------------------
# Event log (the finest level)
# ---------------------------------------------------------------------------

@router.get("/events")
def activity_events(
    date_from: str | None = None,
    date_to: str | None = None,
    username: str | None = None,
    role_id: int | None = None,
    group: str | None = None,
    metric: str | None = None,
    resource: str | None = None,
    q: str | None = None,
    include_bulk: bool = False,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    events, directory = _filtered_events(db, start, end, username, role_id, group, metric, resource, q, include_bulk)
    page = events[skip : skip + limit]
    details = _event_details(db, [e.audit_id for e in page])
    resources = Counter(e.resource for e in events)
    metrics = Counter(e.metric for e in events)
    return {
        "total": len(events),
        "items": [_event_row(e, directory, details.get(e.audit_id)) for e in page],
        "resources": [{"resource": k, "count": c} for k, c in resources.most_common()],
        "metrics": [{"metric": k, "count": c} for k, c in metrics.most_common()],
    }


@router.get("/events/export.xlsx", include_in_schema=False)
def activity_events_export(
    date_from: str | None = None,
    date_to: str | None = None,
    username: str | None = None,
    role_id: int | None = None,
    group: str | None = None,
    metric: str | None = None,
    resource: str | None = None,
    q: str | None = None,
    include_bulk: bool = False,
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    events, directory = _filtered_events(db, start, end, username, role_id, group, metric, resource, q, include_bulk)
    events = events[:10000]
    details = _event_details(db, [e.audit_id for e in events])
    fields = ["time", "username", "full_name", "department", "group", "metric", "action", "resource", "resource_id", "element_nr", "electrolyzer", "position", "record", "changes", "bulk", "ip"]
    rows = []
    for e in events:
        row = _event_row(e, directory, details.get(e.audit_id))
        rows.append(
            {
                "time": row["at"].replace("T", " "),
                "username": row["username"],
                "full_name": row["full_name"],
                "department": row["department"],
                "group": row["group"],
                "metric": row["metric"],
                "action": row["action"],
                "resource": row["resource"],
                "resource_id": row["resource_id"],
                "element_nr": row["element_nr"],
                "electrolyzer": row["electrolyzer"],
                "position": row["position"],
                "record": "; ".join(f"{k}={v}" for k, v in row["target"].items()),
                "changes": "; ".join(f"{c['field']}: {c['old'] or '∅'} → {c['new'] or '∅'}" for c in row["changes"]),
                "bulk": "yes" if row["bulk"] else "",
                "ip": row["ip"],
            }
        )
    return export_xlsx(rows, fields, "activity-events")


# ---------------------------------------------------------------------------
# One person
# ---------------------------------------------------------------------------

@router.get("/user-detail")
def user_detail(
    username: str,
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    directory = _user_directory(db)
    person = _person(directory, "" if username == "(system)" else username)
    key = "" if username == "(system)" else username.strip().lower()
    events = load_events(db, start, end, {key}) if key else [e for e in load_events(db, start, end, None) if not e.username]

    days: dict[date, dict[str, Any]] = {}
    hours = [0] * 24
    by_resource: Counter = Counter()
    by_metric: Counter = Counter()
    bulk_total = 0
    for e in events:
        d = days.setdefault(e.day, {"date": e.day.isoformat(), "first": None, "last": None, "counts": Counter(), "resources": Counter(), "total": 0, "bulk": 0})
        if e.bulk:
            d["bulk"] += 1
            bulk_total += 1
            continue
        d["counts"][e.metric] += 1
        d["resources"][e.resource] += 1
        if e.metric != "logins":
            d["total"] += 1
            hours[e.at.hour] += 1
            by_resource[e.resource] += 1
        by_metric[e.metric] += 1
        if d["first"] is None or e.at < d["first"]:
            d["first"] = e.at
        if d["last"] is None or e.at > d["last"]:
            d["last"] = e.at

    A = models.AuditLog
    lo = datetime.combine(start, datetime.min.time()) - TZ_OFFSET
    hi = datetime.combine(end + timedelta(days=1), datetime.min.time()) - TZ_OFFSET
    logins = []
    if key:
        for r in (
            db.query(A.created_at, A.action, A.success, A.ip_address, A.user_agent)
            .filter(func.lower(A.username) == key, A.action.in_(("login", "login_failed")), A.created_at >= lo, A.created_at < hi)
            .order_by(A.id.desc())
            .limit(200)
            .all()
        ):
            logins.append({"at": (r.created_at + TZ_OFFSET).isoformat(), "success": bool(r.success) and r.action == "login", "ip": r.ip_address, "agent": _short(r.user_agent, 70)})

    out_days = []
    for day in sorted(days, reverse=True):
        d = days[day]
        span = int((d["last"] - d["first"]).total_seconds() // 60) if d["first"] and d["last"] else 0
        out_days.append(
            {
                "date": d["date"],
                "first_at": d["first"].isoformat() if d["first"] else None,
                "last_at": d["last"].isoformat() if d["last"] else None,
                "span_minutes": span,
                "total": d["total"],
                "bulk": d["bulk"],
                "counts": {k: v for k, v in d["counts"].items() if v},
                "resources": dict(d["resources"].most_common()),
            }
        )
    return {
        "person": person,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "total": sum(by_metric[m] for m in by_metric if m != "logins"),
        "bulk": bulk_total,
        "active_days": sum(1 for d in out_days if d["total"]),
        "by_metric": dict(by_metric.most_common()),
        "by_resource": [{"resource": k, "count": c} for k, c in by_resource.most_common()],
        "hours": hours,
        "days": out_days,
        "logins": logins,
    }


# ---------------------------------------------------------------------------
# Cell shop (Assembly Data) – element movements
# ---------------------------------------------------------------------------

@router.get("/cell-shop")
def cell_shop_daily(
    date_from: str | None = None,
    date_to: str | None = None,
    username: str | None = None,
    role_id: int | None = None,
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    directory = _user_directory(db)
    all_events = load_events(db, start, end, resolve_users(directory, username, role_id))
    events = [e for e in all_events if e.metric in ELEMENT_METRICS and not e.bulk]
    metrics = sorted(ELEMENT_METRICS)

    days: dict[date, dict[str, Any]] = {}
    totals: Counter = Counter()
    by_user: dict[str, Counter] = defaultdict(Counter)
    by_el: dict[str, Counter] = defaultdict(Counter)
    distinct: set[str] = set()
    for e in sorted(events, key=lambda x: x.at):
        who = _person(directory, e.username)["username"]
        d = days.setdefault(e.day, {"date": e.day.isoformat(), "counts": Counter(), "users": defaultdict(Counter), "electrolyzers": defaultdict(Counter), "elements": {}})
        d["counts"][e.metric] += 1
        d["users"][who][e.metric] += 1
        totals[e.metric] += 1
        by_user[who][e.metric] += 1
        if e.electrolyzer:
            d["electrolyzers"][e.electrolyzer][e.metric] += 1
            by_el[e.electrolyzer][e.metric] += 1
        if e.element_nr:
            distinct.add(e.element_nr)
            item = d["elements"].setdefault(
                e.element_nr,
                {"element_nr": e.element_nr, "electrolyzer": e.electrolyzer, "position": e.position, "actions": [], "users": set(), "events": []},
            )
            if e.metric not in item["actions"]:
                item["actions"].append(e.metric)
            item["users"].add(who)
            item["events"].append({"at": e.at.isoformat(), "username": who, "metric": e.metric, "id": e.audit_id})

    def pack(counter: Counter) -> dict[str, int]:
        return {k: counter.get(k, 0) for k in metrics}

    out = []
    for day in sorted(days, reverse=True):
        d = days[day]
        out.append(
            {
                "date": d["date"],
                "counts": pack(d["counts"]),
                "distinct_elements": len(d["elements"]),
                "users": [
                    {"username": who, "counts": pack(c), "total": sum(c.values())}
                    for who, c in sorted(d["users"].items(), key=lambda kv: -sum(kv[1].values()))
                ],
                "electrolyzers": [
                    {"electrolyzer": el, "counts": pack(c), "total": sum(c.values())}
                    for el, c in sorted(d["electrolyzers"].items())
                ],
                "elements": [
                    {**el, "users": sorted(el["users"])}
                    for el in sorted(d["elements"].values(), key=lambda x: (x["electrolyzer"] or "", x["position"] or "", x["element_nr"]))
                ],
            }
        )
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "metrics": metrics,
        "totals": {"counts": pack(totals), "distinct_elements": len(distinct)},
        "by_user": [{"username": u, "counts": pack(c), "total": sum(c.values())} for u, c in sorted(by_user.items(), key=lambda kv: -sum(kv[1].values()))],
        "by_electrolyzer": [{"electrolyzer": el, "counts": pack(c), "total": sum(c.values())} for el, c in sorted(by_el.items())],
        "days": out,
    }


# ---------------------------------------------------------------------------
# Warehouse / procurement
# ---------------------------------------------------------------------------

@router.get("/warehouse")
def warehouse_activity(
    date_from: str | None = None,
    date_to: str | None = None,
    username: str | None = None,
    role_id: int | None = None,
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    directory = _user_directory(db)
    users = resolve_users(directory, username, role_id)
    companies = {c.id: c.name for c in db.query(models.WhCompany).all()}
    rows: list[dict[str, Any]] = []

    def kinds(counter: Counter) -> str:
        return ", ".join(f"{n} {k}" for k, n in sorted(counter.items()))

    # Coating dispatches
    D = models.WhCoatingDispatch
    dispatches = db.query(D).filter(D.dispatch_date >= start, D.dispatch_date <= end).all()
    items_by: dict[int, Counter] = defaultdict(Counter)
    if dispatches:
        for chunk in _chunks([d.id for d in dispatches]):
            for it in db.query(models.WhCoatingDispatchItem).filter(models.WhCoatingDispatchItem.dispatch_id.in_(chunk)).all():
                items_by[it.dispatch_id][it.element_kind] += 1
    made = _creators(db, "wh_coating_dispatches", [d.id for d in dispatches])
    for d in dispatches:
        who = made.get(str(d.id), ("", None))[0]
        if _allowed(users, who):
            rows.append({"date": d.dispatch_date.isoformat(), "kind": "dispatch", "number": d.send_no, "company": companies.get(d.company_id), "items": sum(items_by[d.id].values()), "detail": kinds(items_by[d.id]), "status": d.status, "users": [who] if who else [], "remarks": _short(d.remarks, 120)})

    # Receivings from the coater
    R = models.WhCoatingReceiving
    receivings = db.query(R).filter(R.receive_date >= start, R.receive_date <= end).all()
    qc_by: dict[int, Counter] = defaultdict(Counter)
    disp_no = {d.id: d.send_no for d in db.query(D).filter(D.id.in_([r.dispatch_id for r in receivings if r.dispatch_id])).all()} if receivings else {}
    if receivings:
        for chunk in _chunks([r.id for r in receivings]):
            for it in db.query(models.WhCoatingReceivingItem).filter(models.WhCoatingReceivingItem.receiving_id.in_(chunk)).all():
                qc_by[it.receiving_id][(it.qc_result or "—")] += 1
    made = _creators(db, "wh_coating_receivings", [r.id for r in receivings])
    for r in receivings:
        who = made.get(str(r.id), ("", None))[0]
        if _allowed(users, who):
            rows.append({"date": r.receive_date.isoformat(), "kind": "receiving", "number": r.receive_no, "company": None, "items": sum(qc_by[r.id].values()), "detail": f"QC: {kinds(qc_by[r.id])}" + (f" · from {disp_no.get(r.dispatch_id)}" if r.dispatch_id in disp_no else ""), "status": None, "users": [who] if who else [], "remarks": _short(r.remarks, 120)})

    # Purchases
    P = models.WhPurchase
    purchases = db.query(P).filter(P.purchase_date >= start, P.purchase_date <= end).all()
    count_by: Counter = Counter()
    if purchases:
        for chunk in _chunks([p.id for p in purchases]):
            for pid, n in db.query(models.WhPurchaseItem.purchase_id, func.count()).filter(models.WhPurchaseItem.purchase_id.in_(chunk)).group_by(models.WhPurchaseItem.purchase_id).all():
                count_by[pid] = n
    made = _creators(db, "wh_purchases", [p.id for p in purchases])
    for p in purchases:
        who = made.get(str(p.id), ("", None))[0]
        if _allowed(users, who):
            rows.append({"date": p.purchase_date.isoformat(), "kind": "purchase", "number": p.purchase_no, "company": companies.get(p.supplier_id), "items": count_by[p.id], "detail": p.element_kind, "status": None, "users": [who] if who else [], "remarks": _short(p.remarks, 120)})

    # Punches (one row per day / send number / kind)
    U = models.WhPunch
    punches = db.query(U).filter(U.punch_date >= start, U.punch_date <= end).all()
    made = _creators(db, "wh_punches", [p.id for p in punches])
    grouped: dict[tuple, dict[str, Any]] = {}
    for p in punches:
        g = grouped.setdefault((p.punch_date, p.send_no or "", p.element_kind), {"items": 0, "users": set(), "company": companies.get(p.company_id)})
        g["items"] += 1
        who = made.get(str(p.id), ("", None))[0]
        if who:
            g["users"].add(who)
    for (day, send_no, kind), g in grouped.items():
        if users is None or any(_allowed(users, w) for w in g["users"]):
            rows.append({"date": day.isoformat(), "kind": "punch", "number": send_no or None, "company": g["company"], "items": g["items"], "detail": kind, "status": None, "users": sorted(g["users"]), "remarks": ""})

    # Decommissions (one row per day / reason / kind)
    X = models.WhDecommission
    decs = db.query(X).filter(X.decommission_date >= start, X.decommission_date <= end).all()
    made = _creators(db, "wh_decommissions", [x.id for x in decs])
    grouped = {}
    for x in decs:
        g = grouped.setdefault((x.decommission_date, x.reason, x.element_kind), {"items": 0, "users": set()})
        g["items"] += 1
        who = made.get(str(x.id), ("", None))[0]
        if who:
            g["users"].add(who)
    for (day, reason, kind), g in grouped.items():
        if users is None or any(_allowed(users, w) for w in g["users"]):
            rows.append({"date": day.isoformat(), "kind": "decommission", "number": None, "company": None, "items": g["items"], "detail": f"{kind} · {reason}", "status": None, "users": sorted(g["users"]), "remarks": ""})

    rows.sort(key=lambda r: (r["date"], r["kind"], r["number"] or ""), reverse=True)
    summary: dict[str, dict[str, int]] = defaultdict(lambda: {"documents": 0, "items": 0})
    by_user: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        summary[r["kind"]]["documents"] += 1
        summary[r["kind"]]["items"] += r["items"]
        for w in r["users"] or ["(unknown)"]:
            by_user[w][r["kind"]] += 1
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "summary": [{"kind": k, **v} for k, v in sorted(summary.items())],
        "by_user": [{"username": u, "counts": dict(c), "total": sum(c.values())} for u, c in sorted(by_user.items(), key=lambda kv: -sum(kv[1].values()))],
        "rows": rows,
    }


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
    username: str | None = None,
    role_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Daily check: every enabled AriaLIMS sampling point (else every habitual sample) must have a sample."""
    start, end = _range(date_from, date_to)
    if (end - start).days > 62:
        raise HTTPException(status_code=400, detail="The laboratory check is limited to 62 days")
    directory = _user_directory(db)
    users = resolve_users(directory, username, role_id)
    today = (datetime.utcnow() + TZ_OFFSET).date()

    expected: dict[tuple, str] = {}
    source = "sampling_points"
    for p in db.query(models.AriaLimsSamplingPoint).filter(models.AriaLimsSamplingPoint.enabled.is_(True)).all():
        key = _combo_key(p.analysis_type, p.scope, p.electrolyzer, p.group_nr, p.sub_plant)
        expected.setdefault(key, p.name or _combo_label(key))

    S = models.AnalysisSample
    lo = datetime.combine(start, datetime.min.time())
    hi = datetime.combine(end + timedelta(days=1), datetime.min.time())
    samples = db.query(S).filter(S.date >= lo, S.date < hi).all()
    made = _creators(db, "analysis_samples", [s.id for s in samples])
    # Older audit rows have no record id: match them on type / place / date instead.
    A = models.AuditLog
    fallback: dict[tuple[date, tuple], tuple[str, datetime]] = {}
    if len(made) < len(samples):
        for r in (
            db.query(
                A.username,
                A.created_at,
                _json_text(A.after_data, "analysis_type").label("l_t"),
                _json_text(A.after_data, "scope").label("l_s"),
                _json_text(A.after_data, "electrolyzer").label("l_e"),
                _json_text(A.after_data, "group_nr").label("l_g"),
                _json_text(A.after_data, "sub_plant").label("l_p"),
                _json_text(A.after_data, "date").label("l_d"),
            )
            .filter(
                A.resource == "analysis_samples",
                A.action == "create",
                _json_text(A.after_data, "date") >= start.isoformat(),
                _json_text(A.after_data, "date") < (end + timedelta(days=1)).isoformat(),
            )
            .order_by(A.id)
            .all()
        ):
            try:
                day = date.fromisoformat((r.l_d or "")[:10])
            except ValueError:
                continue
            fallback.setdefault((day, _combo_key(r.l_t, r.l_s, r.l_e, r.l_g, r.l_p)), (r.username or "", r.created_at + TZ_OFFSET))
    actual: dict[date, set[tuple]] = defaultdict(set)
    entries: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for s in samples:
        if not s.date:
            continue
        key = _combo_key(s.analysis_type, s.scope, s.electrolyzer, s.group_nr, s.sub_plant)
        day = s.date.date()
        actual[day].add(key)
        who, entered_at = made.get(str(s.id)) or fallback.get((day, key), ("", None))
        filled = sum(1 for v in (s.parameters or {}).values() if v not in (None, ""))
        entries[day].append(
            {
                "label": expected.get(key) or _combo_label(key),
                "analysis_type": s.analysis_type,
                "sample_time": s.time or s.date.strftime("%H:%M"),
                "username": who or "(AriaLIMS / automatic)",
                "entered_at": entered_at.isoformat() if entered_at else None,
                "parameters": filled,
                "expected": key in expected,
            }
        )

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

    days = []
    by_type_missing: Counter = Counter()
    by_type_expected: Counter = Counter()
    by_user: Counter = Counter()
    exp_total = ent_total = 0
    d = end
    while d >= start:
        got = actual.get(d, set())
        done = [k for k in expected if k in got]
        missing = [k for k in expected if k not in got]
        is_open = d >= today
        items = [e for e in entries.get(d, []) if _allowed(users, e["username"])]
        user_counts = Counter(e["username"] for e in items)
        for who, n in user_counts.items():
            by_user[who] += n
        types: dict[str, dict[str, int]] = defaultdict(lambda: {"expected": 0, "entered": 0})
        for k in expected:
            types[k[0]]["expected"] += 1
            if k in got:
                types[k[0]]["entered"] += 1
        if not is_open:
            exp_total += len(expected)
            ent_total += len(done)
            for k in missing:
                by_type_missing[k[0]] += 1
            for k in expected:
                by_type_expected[k[0]] += 1
        days.append(
            {
                "date": d.isoformat(),
                "open": is_open,
                "expected": len(expected),
                "entered": len(done),
                "missing": len(missing),
                "missing_items": sorted(expected[k] for k in missing),
                "types": [{"analysis_type": t, **v, "missing": v["expected"] - v["entered"]} for t, v in sorted(types.items())],
                "entries": sorted(items, key=lambda e: (e["label"], e["sample_time"])),
                "users": [{"username": u, "count": c} for u, c in user_counts.most_common()],
            }
        )
        d -= timedelta(days=1)

    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "source": source,
        "filtered": users is not None,
        "expected_per_day": len(expected),
        "summary": {
            "expected": exp_total,
            "entered": ent_total,
            "missing": exp_total - ent_total,
            "completeness_pct": round(100.0 * ent_total / exp_total, 1) if exp_total else None,
        },
        "missing_by_type": [
            {"analysis_type": t, "expected": by_type_expected[t], "missing": by_type_missing[t]}
            for t in sorted(by_type_expected, key=lambda x: -by_type_missing[x])
        ],
        "entered_by_user": [{"username": u, "count": c} for u, c in by_user.most_common()],
        "days": days,
    }


# ---------------------------------------------------------------------------
# Technical inspection – counts, findings and the individual reports
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
    username: str | None = None,
    role_id: int | None = None,
    db: Session = Depends(get_db),
):
    start, end = _range(date_from, date_to)
    directory = _user_directory(db)
    users = resolve_users(directory, username, role_id)
    names: set[str] | None = None
    if users is not None:
        names = set(users)
        for key in users:
            full = (directory.get(key) or {}).get("full_name")
            if full:
                names.add(full.strip().lower())

    def match(entered_by: str | None, *signers: str | None) -> bool:
        if names is None:
            return True
        return any((s or "").strip().lower() in names for s in (entered_by, *signers))

    R = models.InspectionReport
    reports = (
        db.query(R)
        .filter(R.inspection_date >= datetime.combine(start, datetime.min.time()), R.inspection_date < datetime.combine(end + timedelta(days=1), datetime.min.time()))
        .order_by(R.inspection_date.desc(), R.id.desc())
        .all()
    )
    made_r = _creators(db, "inspection_reports", [r.id for r in reports])
    per_day: dict[str, dict[str, Any]] = {}
    per_inspector: dict[str, dict[str, Any]] = {}
    reasons: Counter = Counter()
    finding_fields: Counter = Counter()
    insp_list: list[dict[str, Any]] = []
    for r in reports:
        entered_by = made_r.get(str(r.id), ("", None))[0]
        if not match(entered_by, r.inspector_name, r.sign_insp_name, r.sign_maint_name, r.sign_proc_name):
            continue
        day = r.inspection_date.date().isoformat() if r.inspection_date else "?"
        who = (r.inspector_name or r.sign_insp_name or "").strip() or "(unknown)"
        found = [f for f in _FINDING_FIELDS if _has_finding(getattr(r, f, None))]
        for f in found:
            finding_fields[f] += 1
        reason = (r.inspection_reason or "").strip() or "(none)"
        reasons[reason] += 1
        for table, key in ((per_day, day), (per_inspector, who)):
            row = table.setdefault(key, {"key": key, "reports": 0, "with_findings": 0, "elements": set()})
            row["reports"] += 1
            row["with_findings"] += 1 if found else 0
            if r.element_nr:
                row["elements"].add(r.element_nr)
        if len(insp_list) < 1000:
            insp_list.append(
                {
                    "id": r.id,
                    "date": day,
                    "element_nr": r.element_nr,
                    "electrolyzer": clean_electrolyzer(r.electrolyzer),
                    "position": r.position,
                    "inspector": who,
                    "reason": reason,
                    "operation_days": r.operation_days,
                    "findings": [f"{f}: {_short(getattr(r, f), 40)}" for f in found],
                    "signed": [n for n in (r.sign_insp_name, r.sign_maint_name, r.sign_proc_name) if n],
                    "entered_by": entered_by or None,
                }
            )

    A = models.AssemblyInspectionReport
    assembly = db.query(A).filter(A.assembly_date >= start, A.assembly_date <= end).order_by(A.assembly_date.desc(), A.id.desc()).all()
    made_a = _creators(db, "assembly_inspection_reports", [a.id for a in assembly])
    asm_day: dict[str, dict[str, Any]] = {}
    asm_who: dict[str, dict[str, Any]] = {}
    failed_checks: Counter = Counter()
    asm_list: list[dict[str, Any]] = []
    for a in assembly:
        entered_by = made_a.get(str(a.id), ("", None))[0]
        if not match(entered_by, a.sign_insp_name, a.sign_maint_name, a.sign_proc_name):
            continue
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
        if len(asm_list) < 1000:
            asm_list.append(
                {
                    "id": a.id,
                    "date": day,
                    "element_nr": a.element_nr,
                    "electrolyzer": clean_electrolyzer(a.electrolyzer),
                    "position": a.position,
                    "status": status,
                    "checked": sum(1 for v in checks.values() if v),
                    "total_checks": len(checks),
                    "failed_checks": [CHECK_LABELS.get(k, k) for k in failed][:12],
                    "inspector": who,
                    "signed": [n for n in (a.sign_insp_name, a.sign_maint_name, a.sign_proc_name) if n],
                    "entered_by": entered_by or None,
                    "distance": a.electrode_distance,
                }
            )

    def listing(table: dict, newest_first: bool):
        items = [{**row, "elements": len(row["elements"])} for row in table.values()]
        return sorted(items, key=lambda x: x["key"], reverse=newest_first)

    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "note": "A report counts as 'with findings' when any defect field (blisters, folds, holes, cracks, deformation, leakage) holds text other than none/ok/0/-.",
        "inspection_reports": {
            "total": sum(r["reports"] for r in per_day.values()),
            "with_findings": sum(r["with_findings"] for r in per_day.values()),
            "by_day": listing(per_day, True),
            "by_inspector": listing(per_inspector, False),
            "by_reason": [{"reason": k, "count": c} for k, c in reasons.most_common()],
            "top_findings": [{"field": k, "count": c} for k, c in finding_fields.most_common(10)],
            "reports": insp_list,
        },
        "assembly_reports": {
            "total": sum(r["reports"] for r in asm_day.values()),
            "passed": sum(r["passed"] for r in asm_day.values()),
            "failed": sum(r["failed"] for r in asm_day.values()),
            "incomplete": sum(r["incomplete"] for r in asm_day.values()),
            "by_day": listing(asm_day, True),
            "by_inspector": listing(asm_who, False),
            "top_failed_checks": [{"check": CHECK_LABELS.get(k, k), "count": c} for k, c in failed_checks.most_common(10)],
            "reports": asm_list,
        },
    }
