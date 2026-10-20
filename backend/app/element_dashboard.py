"""Management numbers for the cell elements, anodes, cathodes and membranes.

Everything here is read from the tables the plant already keeps (Assembly Data, Anode/Cathode/Membrane Details,
Recoating, Coating Checks, Warehouse, Assembly Inspection). The only data the dashboard stores itself is the
cell-shop stage of an element (``ElementShopState``) and the end-of-life limits (``ElementDashboardSettings``).
"""
from __future__ import annotations

import functools
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import models
from .calculations import installation_dol
from .plant_topology import all_electrolyzers, format_electrolyzer_name, is_valid_electrolyzer_name, norm_pos
from .relations_sync import is_junk_serial
from .warehouse import BUCKETS, _as_date, _grouped, _iso, _life_key, build_board, compact_eq, compact_nr

CACHE_SECONDS = 30  # the heavy per-part computations are reused for a short time; "Refresh" clears them
_CACHE: dict[Any, tuple[float, Any]] = {}


def clear_cache() -> None:
    _CACHE.clear()
    from . import element_flow  # imported late: element_flow builds on this module

    element_flow.clear_cache()


def _freeze(value: Any) -> Any:
    if isinstance(value, dict):
        return tuple(sorted((k, _freeze(v)) for k, v in value.items()))
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(v) for v in value)
    return value


def _memo(fn):
    """Short-lived cache for functions of (db, ...). Callers must not modify what they get back."""

    @functools.wraps(fn)
    def wrapper(db: Session, *args, **kwargs):
        key = (fn.__name__, id(db.get_bind()), _freeze(args), _freeze(kwargs))
        hit = _CACHE.get(key)
        now = time.monotonic()
        if hit is not None and now - hit[0] < CACHE_SECONDS:
            return hit[1]
        value = fn(db, *args, **kwargs)
        _CACHE[key] = (now, value)
        return value

    return wrapper


LIST_LIMIT = 400  # rows of the longest "to do" lists sent to the browser (counts are always complete)
CELLS_PER_ELECTROLYZER = 168
PLANT_CAPACITY = len(all_electrolyzers()) * CELLS_PER_ELECTROLYZER

# Stages a person can set (the rest come from Assembly Data).
# A dismantled element is retired (rate off). It is not put back in the assembly queue.
MANUAL_STAGES = ("awaiting_disassembly", "awaiting_assembly", "assembling", "awaiting_qc", "ready")
STAGE_RANK = {"awaiting_assembly": 1, "assembling": 2, "awaiting_qc": 3, "ready": 4}
ALLOWED_BY_BASE = {
    # Operator, after the decommissioning date: healthy/balance is a position change (relocate),
    # broken goes to C90 (awaiting_disassembly). "ready" remains only so an older "kept" mark still loads.
    "decommissioned": {"awaiting_disassembly", "ready"},
    "disassembled": set(),
    "new": {"awaiting_assembly", "assembling", "awaiting_qc", "ready"},
}
ALL_STATES = (
    "in_service",
    "installed",
    "decommissioned",
    "awaiting_disassembly",
    "disassembled",
    "awaiting_assembly",
    "assembling",
    "awaiting_qc",
    "ready",
)

# Placeholders - the plant has not published a lifetime figure, so the manager sets them in the dashboard.
DEFAULT_SETTINGS = {
    "anode_life_days": 3650,
    "cathode_life_days": 4380,
    "membrane_life_days": 1825,
    "warn_percent": 85,
    "coating_thickness_min": None,
    "shop_queue_days": 90,
}

# One confirmation moves an element to the next step of the cell-shop cycle.
NEXT_STAGE = {
    # decommissioned is the operator's decision (relocate or send to C90) — not a single next step.
    # disassembled is the end of this element: it is rate off and does not return to assembly.
    "awaiting_disassembly": "disassembled",
    "new": "awaiting_assembly",
    "awaiting_assembly": "assembling",
    "assembling": "awaiting_qc",
    "awaiting_qc": "ready",
}


# ---------------------------------------------------------------- settings


def get_settings(db: Session) -> models.ElementDashboardSettings:
    row = db.query(models.ElementDashboardSettings).order_by(models.ElementDashboardSettings.id).first()
    if row is None:
        row = models.ElementDashboardSettings(**DEFAULT_SETTINGS)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def settings_dict(row: models.ElementDashboardSettings) -> dict[str, Any]:
    return {
        "anode_life_days": row.anode_life_days,
        "cathode_life_days": row.cathode_life_days,
        "membrane_life_days": row.membrane_life_days,
        "warn_percent": row.warn_percent if row.warn_percent is not None else 85,
        "coating_thickness_min": row.coating_thickness_min,
        "shop_queue_days": row.shop_queue_days if row.shop_queue_days is not None else DEFAULT_SETTINGS["shop_queue_days"],
    }


def life_status(days: int | None, limit: int | None, warn_percent: int) -> tuple[float | None, str, int | None]:
    """(percent of limit used, ok | warning | expired | unknown, days left)."""
    if days is None or not limit:
        return None, "unknown", None
    pct = round(days * 100.0 / limit, 1)
    if pct >= 100:
        return pct, "expired", limit - days
    if pct >= warn_percent:
        return pct, "warning", limit - days
    return pct, "ok", limit - days


def merged_dol(elements, since: date | None = None) -> int | None:
    """Days on line of one part over all the installations it has been in.

    A part that appears twice for the same period (duplicate rows) is counted once: overlapping
    installations are merged before the days are added. ``since`` ignores installations that started earlier.
    """
    today = date.today()
    spans: list[tuple[date, date]] = []
    for el in elements:
        start = _as_date(el.commissioning_date) or _as_date(el.assembly_date)
        if not start:
            continue
        end = _as_date(el.disassembly_date) or _as_date(el.decommissioning_date) or today
        if end < start or (since is not None and start < since):
            continue
        spans.append((start, end))
    if not spans:
        return None
    spans.sort()
    total = 0
    cur_start, cur_end = spans[0]
    for start, end in spans[1:]:
        if start <= cur_end:
            cur_end = max(cur_end, end)
        else:
            total += (cur_end - cur_start).days
            cur_start, cur_end = start, end
    return total + (cur_end - cur_start).days


# ---------------------------------------------------------------- element pipeline


def _valid_electrolyzer(value: Any) -> bool:
    return is_valid_electrolyzer_name(None if value is None else str(value))


def _base_state(el: models.Element) -> str:
    if el.disassembly_date:
        return "disassembled"
    if el.decommissioning_date:
        return "decommissioned"
    if el.commissioning_date:
        return "in_service"
    if el.assembly_date or _valid_electrolyzer(el.electrolyzer):
        return "installed"
    return "new"


def _event_date(el: models.Element) -> date | None:
    days = [
        _as_date(d)
        for d in (el.assembly_date, el.commissioning_date, el.decommissioning_date, el.disassembly_date)
    ]
    days = [d for d in days if d]
    return max(days) if days else None


def _report_signal(report: models.AssemblyInspectionReport) -> tuple[str, datetime]:
    """What an assembly checklist says about the element: started, workshop-signed, or inspector-signed."""
    stamp = report.updated_at or report.created_at or datetime.utcnow()
    # reports are stamped in UTC, shop stages in local time
    stamp = stamp.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
    if (report.sign_insp_name or "").strip():
        return "ready", stamp
    if (report.sign_maint_name or "").strip() or (report.sign_proc_name or "").strip():
        return "awaiting_qc", stamp
    return "assembling", stamp


@_memo
def build_pipeline(db: Session) -> list[dict[str, Any]]:
    """One row per element number with its current stage."""
    rows = db.query(models.Element).all()
    latest: dict[str, models.Element] = {}
    for el in rows:
        key = compact_nr(el.element_nr)
        if not key:
            continue
        if key not in latest or _life_key(el) >= _life_key(latest[key]):
            latest[key] = el

    manual = {compact_nr(s.element_nr): s for s in db.query(models.ElementShopState).all()}
    reports: dict[str, list[models.AssemblyInspectionReport]] = defaultdict(list)
    for rep in db.query(models.AssemblyInspectionReport).all():
        key = compact_nr(rep.element_nr)
        if key:
            reports[key].append(rep)
    shop_events: dict[str, list[models.ElementShopEvent]] = defaultdict(list)
    for ev in db.query(models.ElementShopEvent).all():
        key = compact_nr(ev.element_nr)
        if key:
            shop_events[key].append(ev)

    # shop-only elements (never installed yet)
    keys = set(latest) | set(manual)
    today = date.today()
    out: list[dict[str, Any]] = []
    for key in keys:
        el = latest.get(key)
        base = _base_state(el) if el is not None else "new"
        event = _event_date(el) if el is not None else None
        stage = base
        source = "derived"
        since = event
        note = updated_by = None
        candidates: list[tuple[datetime, str, str]] = []

        st = manual.get(key)
        if st is not None and st.stage in ALLOWED_BY_BASE.get(base, ()):
            stamp = st.updated_at or datetime.min
            if event is None or stamp.date() >= event:
                candidates.append((stamp, st.stage, "manual"))
        if base == "new":
            for rep in reports.get(key, []):
                rep_day = _as_date(rep.assembly_date) or (rep.created_at.date() if rep.created_at else None)
                if event is not None and rep_day is not None and rep_day < event:
                    continue
                rep_stage, stamp = _report_signal(rep)
                candidates.append((stamp, rep_stage, "inspection"))
        if candidates:
            # newest signal wins; a manual entry beats a report saved at the same moment
            candidates.sort(key=lambda c: (c[0], c[2] == "manual"))
            stamp, stage, source = candidates[-1]
            since = stamp.date()
            if source == "manual" and st is not None:
                note, updated_by = st.note, st.updated_by

        dol = None
        if el is not None and base in ("in_service", "installed", "decommissioned"):
            dol = installation_dol(el.assembly_date, el.commissioning_date, el.disassembly_date, el.decommissioning_date)
        display = (el.element_nr if el is not None else (st.element_nr if st else key)) or key
        stage_dates: dict[str, str] = {}
        if el is not None:
            if el.assembly_date:
                stage_dates["installed"] = _iso(el.assembly_date)
            if el.commissioning_date:
                stage_dates["in_service"] = _iso(el.commissioning_date)
            if el.decommissioning_date:
                stage_dates["decommissioned"] = _iso(el.decommissioning_date)
            if el.disassembly_date:
                taken_apart = _iso(el.disassembly_date)
                if taken_apart:
                    stage_dates["disassembled"] = taken_apart
                    if stage in ("awaiting_assembly", "assembling", "awaiting_qc", "ready"):
                        stage_dates.setdefault("awaiting_assembly", taken_apart)
        life_from = None
        if el is not None:
            if stage in ("installed", "in_service", "decommissioned"):
                life_from = _as_date(el.assembly_date)
            elif stage in ("awaiting_assembly", "assembling", "awaiting_qc", "ready"):
                life_from = _as_date(el.disassembly_date)
            elif stage == "awaiting_disassembly":
                life_from = _as_date(el.decommissioning_date)
        for rep in reports.get(key, []):
            rep_stage, stamp = _report_signal(rep)
            day = _as_date(rep.assembly_date) or stamp.date()
            if life_from and day and day < life_from:
                continue
            iso = _iso(day)
            if iso:
                stage_dates.setdefault(rep_stage, iso)
        for ev in sorted(shop_events.get(key, []), key=lambda e: (e.created_at or datetime.min, e.id or 0)):
            day = _as_date(ev.created_at)
            if life_from and day and day < life_from:
                continue
            iso = _iso(day)
            if iso and ev.to_stage in ALL_STATES:
                stage_dates[ev.to_stage] = iso
        stamp = _iso(since)
        if stamp:
            stage_dates.setdefault(stage, stamp)
        out.append(
            {
                "element_nr": str(display).strip(),
                "key": key,
                "row_id": el.id if el is not None else None,
                "state": stage,
                "base_state": base,
                "source": source,
                "electrolyzer": format_electrolyzer_name(el.electrolyzer) if el is not None and _valid_electrolyzer(el.electrolyzer) else None,
                "position": el.position if el is not None else None,
                "group_nr": el.group_nr if el is not None else None,
                "anode_nr": el.anode_nr if el is not None else None,
                "cathode_nr": el.cathode_nr if el is not None else None,
                "membrane_nr": el.membrane_nr if el is not None else None,
                "membrane_type": el.membrane_type if el is not None else None,
                "assembly_date": _iso(el.assembly_date) if el is not None else None,
                "commissioning_date": _iso(el.commissioning_date) if el is not None else None,
                "decommissioning_date": _iso(el.decommissioning_date) if el is not None else None,
                "disassembly_date": _iso(el.disassembly_date) if el is not None else None,
                "decommission_reason": el.decommission_reason if el is not None else None,
                "since": _iso(since),
                "days_in_state": (today - since).days if since else None,
                "dol": dol,
                "note": note,
                "updated_by": updated_by,
                "stage_dates": stage_dates,
            }
        )
    out.sort(key=lambda r: (r["state"], r["element_nr"]))
    return out


def pipeline_counts(items: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(item["state"] for item in items)
    out = {state: counts.get(state, 0) for state in ALL_STATES}
    out["total"] = len(items)
    return out


def set_shop_stage(
    db: Session,
    element_nr: str,
    stage: str,
    note: str | None,
    user: str | None,
    items: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Move one element to a stage (``clear`` removes the manual entry). Raises ValueError when not allowed.

    ``items`` is the pipeline keyed by compact element number; pass it when moving many elements at once.
    """
    key = compact_nr(element_nr)
    if not key:
        raise ValueError("Element number is required")
    if items is None:
        items = {i["key"]: i for i in build_pipeline(db)}
    item = items.get(key)
    base = item["base_state"] if item else "new"
    row = next((s for s in db.query(models.ElementShopState).all() if compact_nr(s.element_nr) == key), None)
    previous = item["state"] if item else None
    if stage == "clear":
        if row is not None:
            db.add(models.ElementShopEvent(element_nr=row.element_nr, from_stage=previous, to_stage="clear", note=note, user=user, created_at=datetime.now()))
            db.delete(row)
        return {"element_nr": element_nr, "stage": None}
    if stage not in MANUAL_STAGES:
        raise ValueError(f"Unknown stage '{stage}'")
    if stage not in ALLOWED_BY_BASE.get(base, set()):
        label = {"in_service": "in service", "installed": "installed and waiting for start-up"}.get(base, base)
        raise ValueError(f"Element {element_nr} is {label}; stage '{stage}' does not apply")
    shown = item["element_nr"] if item else element_nr.strip()
    if row is None:
        row = models.ElementShopState(element_nr=shown[:50], stage=stage)
        db.add(row)
    row.stage = stage
    row.note = note
    row.updated_by = user
    row.updated_at = datetime.now()  # local time, comparable with the plant dates
    db.add(models.ElementShopEvent(element_nr=shown[:50], from_stage=previous, to_stage=stage, note=note, user=user, created_at=datetime.now()))
    return {"element_nr": shown, "stage": stage}


DECOMMISSION_CHOICES = {"keep": "ready", "disassemble": "awaiting_disassembly"}


def decide_decommissioned(db: Session, element_nr: str, choice: str, note: str | None, user: str | None) -> dict[str, Any]:
    """Flowchart branch after the Decommission Date: healthy cell kept in the cell shop, or sent to disassembly.

    (Moving a healthy cell straight to a new position is ``relocate`` in the router; it writes Assembly Data.)
    """
    stage = DECOMMISSION_CHOICES.get(choice)
    if stage is None:
        raise ValueError(f"Unknown choice '{choice}'")
    key = compact_nr(element_nr)
    item = next((i for i in build_pipeline(db) if i["key"] == key), None)
    if item is None or item["base_state"] != "decommissioned":
        raise ValueError(f"Element {element_nr} is not waiting after being switched off")
    result = set_shop_stage(db, item["element_nr"], stage, note, user, {key: item})
    return {**result, "from": item["state"]}


def advance_stage(db: Session, element_nr: str, note: str | None, user: str | None, day: date | None = None) -> dict[str, Any]:
    """Move one element to the next step of the cycle. Dismantling is written to Assembly Data. Raises ValueError."""
    key = compact_nr(element_nr)
    if not key:
        raise ValueError("Element number is required")
    item = next((i for i in build_pipeline(db) if i["key"] == key), None)
    if item is None:
        raise ValueError(f"Element {element_nr} was not found")
    target = NEXT_STAGE.get(item["state"])
    if target is None:
        raise ValueError(f"Element {item['element_nr']} is '{item['state']}'; there is no next cell-shop step (installing is entered in Assembly Data)")
    if item["state"] == "awaiting_qc" and target == "ready":
        # New assemblies cannot leave QC until the confirmation / inspection form is signed.
        signed = (
            db.query(models.AssemblyInspectionReport)
            .filter(models.AssemblyInspectionReport.element_nr == item["element_nr"])
            .order_by(models.AssemblyInspectionReport.id.desc())
            .first()
        )
        if signed is None or not (getattr(signed, "sign_insp_name", None) or "").strip():
            raise ValueError(
                f"Element {item['element_nr']}: fill and sign the assembly confirmation form before it can be used (ready)."
            )
    if target != "disassembled":
        result = set_shop_stage(db, item["element_nr"], target, note, user, {key: item})
        return {**result, "from": item["state"]}

    day = day or date.today()
    rows = [el for el in db.query(models.Element).all() if compact_nr(el.element_nr) == key]
    if not rows:
        raise ValueError(f"Element {item['element_nr']} has no Assembly Data row")
    el = max(rows, key=_life_key)
    started = _as_date(el.decommissioning_date) or _as_date(el.commissioning_date) or _as_date(el.assembly_date)
    if started and day < started:
        raise ValueError(f"Dismantling date {day.isoformat()} is before the element was switched off ({started.isoformat()})")
    if el.decommissioning_date is None:
        el.decommissioning_date = day
    el.disassembly_date = day
    for row in db.query(models.ElementShopState).all():
        if compact_nr(row.element_nr) == key:
            db.delete(row)
    db.add(models.ElementShopEvent(element_nr=item["element_nr"][:50], from_stage=item["state"], to_stage="disassembled", note=note, user=user, created_at=datetime.now()))
    return {"element_nr": item["element_nr"], "stage": "disassembled", "from": item["state"]}


# ---------------------------------------------------------------- coating jobs


def _coating_jobs(db: Session, kind: str) -> list[dict[str, Any]]:
    """Every send-to-coater job for this kind, from Recoating plus Warehouse dispatches (no double counting)."""
    rec_model, field = (models.AnodeRecoating, "anode_nr") if kind == "anode" else (models.CathodeRecoating, "cathode_nr")
    jobs: list[dict[str, Any]] = []
    seen: set[tuple[str, date | None]] = set()
    for rec in db.query(rec_model).all():
        key = compact_nr(getattr(rec, field))
        if not key or not (rec.dispatch_date or rec.return_date):
            continue
        disp, ret = _as_date(rec.dispatch_date), _as_date(rec.return_date)
        seen.add((key, disp))
        jobs.append({"key": key, "serial": getattr(rec, field), "coater": (rec.manufacturer or "").strip() or None, "dispatch": disp, "return": ret, "source": "recoating", "send_no": rec.coating_nr if kind == "anode" else None})

    companies = {c.id: c.name for c in db.query(models.WhCompany).all()}
    dispatches = {d.id: d for d in db.query(models.WhCoatingDispatch).all() if d.status != "cancelled"}
    received: dict[int, date] = {}
    for item, receiving in (
        db.query(models.WhCoatingReceivingItem, models.WhCoatingReceiving)
        .join(models.WhCoatingReceiving, models.WhCoatingReceiving.id == models.WhCoatingReceivingItem.receiving_id)
        .all()
    ):
        if item.dispatch_item_id:
            received[item.dispatch_item_id] = receiving.receive_date
    for item in db.query(models.WhCoatingDispatchItem).filter_by(element_kind=kind).all():
        disp = dispatches.get(item.dispatch_id)
        key = compact_nr(item.serial)
        if disp is None or not key or (key, disp.dispatch_date) in seen:
            continue
        jobs.append({"key": key, "serial": item.serial, "coater": companies.get(disp.company_id), "dispatch": disp.dispatch_date, "return": received.get(item.id), "source": "warehouse", "send_no": disp.send_no})
    return jobs


# ---------------------------------------------------------------- electrodes (anode / cathode)


def _wh_states(db: Session, kind: str) -> dict[str, dict[str, Any]]:
    companies = {c.id: c.name for c in db.query(models.WhCompany).all()}
    dispatches = {d.id: d for d in db.query(models.WhCoatingDispatch).all()}
    out: dict[str, dict[str, Any]] = {}
    for st in db.query(models.WhElementState).filter_by(element_kind=kind).all():
        key = compact_nr(st.serial)
        if not key:
            continue
        disp = dispatches.get(st.open_dispatch_id) if st.open_dispatch_id else None
        out[key] = {
            "status": st.lifecycle_status,
            "company": companies.get(st.company_id),
            "send_no": disp.send_no if disp else None,
            "dispatch_date": disp.dispatch_date if disp else None,
            "coating_status": st.coating_status,
            "qc_result": st.qc_result,
        }
    return out


@_memo
def electrode_rows(db: Session, kind: str, settings: dict[str, Any] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Anodes or cathodes with DOL, coating age, life status and coating history."""
    cfg = settings or settings_dict(get_settings(db))
    limit = cfg["anode_life_days"] if kind == "anode" else cfg["cathode_life_days"]
    warn = cfg["warn_percent"]
    field = "anode_nr" if kind == "anode" else "cathode_nr"
    check_model = models.AnodeCoatingCheck if kind == "anode" else models.CathodeCoatingCheck

    board = build_board(db, kind, limit=10**9)
    elements = _grouped(db.query(models.Element).all(), field)
    checks = _grouped(db.query(check_model).all(), field)
    jobs_by_key: dict[str, list[dict]] = defaultdict(list)
    for job in _coating_jobs(db, kind):
        jobs_by_key[job["key"]].append(job)
    wh = _wh_states(db, kind)
    today = date.today()

    rows: list[dict[str, Any]] = []
    for item in board["items"]:
        key = item["key"]
        if is_junk_serial(key) and not item["manufacturer"]:
            continue  # "UA XXXXX" and similar placeholders typed into Assembly Data
        jobs = jobs_by_key.get(key, [])
        returns = [j["return"] for j in jobs if j["return"]]
        last_return = max(returns) if returns else None

        lives = elements.get(key, [])
        total_dol = merged_dol(lives)
        coating_dol = merged_dol(lives, since=last_return) if total_dol is not None else None
        if coating_dol is None and total_dol is not None:
            coating_dol = 0
        runs = item["runs"]
        has_dol = total_dol is not None
        life_dol = coating_dol
        pct, status, left = life_status(life_dol, limit, warn)

        key_checks = sorted(checks.get(key, []), key=lambda c: (_as_date(c.check_date) or date.min, c.id or 0))
        last_check = key_checks[-1] if key_checks else None
        residual = next((c.residual_thickness for c in reversed(key_checks) if c.residual_thickness is not None), None)
        open_jobs = [j for j in jobs if j["dispatch"] and not j["return"]]
        state = wh.get(key)
        at_coater = (item["bucket"] == "out_repair" and item["reason"] == "recoating") or (state is not None and state["status"] == "at_coater")
        dispatch = item["repair_dispatch"] if item["reason"] == "recoating" else None
        coater = None
        send_no = None
        if at_coater:
            current = max(open_jobs, key=lambda j: j["dispatch"]) if open_jobs else None
            if current:
                dispatch = dispatch or _iso(current["dispatch"])
                coater = current["coater"]
                send_no = current["send_no"]
            if state is not None:
                coater = coater or state["company"]
                send_no = send_no or state["send_no"]
                if not dispatch and state["dispatch_date"]:
                    dispatch = _iso(state["dispatch_date"])
        days_away = None
        if at_coater and dispatch:
            days_away = (today - date.fromisoformat(dispatch)).days

        rows.append(
            {
                "kind": kind,
                "serial": item["serial"],
                "key": key,
                "bucket": item["bucket"],
                "reason": item["reason"],
                "installed": item["bucket"] == "on_rack",
                "in_service": item["bucket"] == "on_rack" and item["commissioning_date"] is not None and item["disassembly_date"] is None,
                "element_nr": item["element_nr"] if item["bucket"] == "on_rack" else None,
                "last_element_nr": item["element_nr"],
                "electrolyzer": item["electrolyzer"] if item["bucket"] == "on_rack" else None,
                "last_electrolyzer": item.get("electrolyzer"),
                "position": item["position"] if item["bucket"] == "on_rack" else None,
                "commissioning_date": item["commissioning_date"],
                "runs": runs,
                "total_dol": total_dol,
                "coating_dol": coating_dol,
                "life_limit": limit,
                "life_pct": pct,
                "life_status": status,
                "life_left": left,
                "recoat_count": len(jobs),
                "last_coating_return": _iso(last_return),
                "residual_thickness": residual,
                "last_check_date": _iso(last_check.check_date) if last_check else None,
                "coating": item["coating"],
                "coating_type": None,
                "manufacturer": item["manufacturer"],
                "at_coater": at_coater,
                "coater": coater,
                "send_no": send_no,
                "dispatch_date": dispatch,
                "days_away": days_away,
                "wh_status": state["status"] if state else None,
                "repair_return": item["repair_return"],
            }
        )
    return rows, {"limit": limit, "warn_percent": warn, "counts": board["counts"]}


# ---------------------------------------------------------------- membranes


@_memo
def membrane_rows(db: Session, settings: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    cfg = settings or settings_dict(get_settings(db))
    limit, warn = cfg["membrane_life_days"], cfg["warn_percent"]
    elements = _grouped(db.query(models.Element).all(), "membrane_nr")
    masters = {compact_nr(m.membrane_nr): m for m in db.query(models.Membrane).all() if compact_nr(m.membrane_nr)}
    maintenance = _grouped(db.query(models.MembraneMaintenance).all(), "membrane_nr")
    rows: list[dict[str, Any]] = []
    for key in set(elements) | set(masters):
        if is_junk_serial(key) and key not in masters:
            continue  # free text typed into the membrane field
        lives = elements.get(key, [])
        latest = max(lives, key=_life_key) if lives else None
        master = masters.get(key)
        mounted = latest is not None and latest.disassembly_date is None and (latest.electrolyzer or latest.commissioning_date or latest.assembly_date)
        if mounted:
            bucket = "on_rack"
        elif master is not None and _as_date(master.decommission_date):
            bucket = "not_ok"
        else:
            bucket = "ok"
        total = merged_dol(lives)
        pct, status, left = life_status(total, limit, warn)
        display = (latest.membrane_nr if latest is not None else None) or (master.membrane_nr if master else key)
        rows.append(
            {
                "kind": "membrane",
                "serial": str(display).strip(),
                "key": key,
                "bucket": bucket,
                "reason": "in_service" if mounted else ("decommission" if bucket == "not_ok" else "ready"),
                "installed": bool(mounted),
                "in_service": bool(mounted and latest.commissioning_date),
                "element_nr": latest.element_nr if mounted else None,
                "last_element_nr": latest.element_nr if latest is not None else None,
                "electrolyzer": latest.electrolyzer if mounted else None,
                "position": latest.position if mounted else None,
                "commissioning_date": _iso(latest.commissioning_date) if latest is not None else None,
                "runs": len(lives),
                "total_dol": total,
                "coating_dol": None,
                "life_limit": limit,
                "life_pct": pct,
                "life_status": status,
                "life_left": left,
                "membrane_type": (master.membrane_type if master and master.membrane_type else (latest.membrane_type if latest is not None else None)),
                "maintenance_count": len(maintenance.get(key, [])),
            }
        )
    return rows


def part_rows(db: Session, kind: str, settings: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    if kind == "membrane":
        return membrane_rows(db, settings)
    return electrode_rows(db, kind, settings)[0]


def _current_mount(db: Session, field: str, serial: str, skip_id: int | None) -> models.Element | None:
    """The live installation of this part, ignoring the dismantled element it came from."""
    column = getattr(models.Element, field)
    match = compact_eq(column, serial)
    if match is None:
        return None
    rows = [row for row in db.query(models.Element).filter(match).all() if row.id != skip_id and row.disassembly_date is None]
    if not rows:
        return None
    return max(rows, key=_life_key)


def _segregation_of(db: Session, kind: str, serial: str):
    from .segregation_flow import classify_row

    match = compact_eq(models.ElectrodeSegregation.serial_nr, serial)
    if match is None:
        return None
    rows = db.query(models.ElectrodeSegregation).filter(match).all()
    rows = [row for row in rows if not row.electrode_kind or row.electrode_kind == kind]
    if not rows:
        return None
    row = max(rows, key=lambda item: item.id or 0)
    info = classify_row(row)
    quality = info.get("quality")
    outcome = info.get("outcome")
    if outcome == "reusable" and quality == "good":
        status = "reusable_good"
    elif outcome == "reusable" and quality == "medium":
        status = "reusable_medium"
    elif outcome == "reusable":
        status = "reusable"
    elif outcome == "rate_off":
        status = "rate_off"
    elif outcome == "coating_problem":
        status = "recoating"
    elif outcome == "mechanical_problem":
        status = "mechanical"
    else:
        status = "undecided"
    return {"status": status, "note": (row.segregation or row.decision or "").strip() or None}


def _open_coating(db: Session, kind: str, serial: str) -> dict[str, Any] | None:
    from .workflow_models import WfCoatingBatch, WfCoatingItem

    match = compact_eq(WfCoatingItem.serial, serial)
    if match is None:
        return None
    rows = (
        db.query(WfCoatingItem, WfCoatingBatch)
        .join(WfCoatingBatch, WfCoatingBatch.id == WfCoatingItem.batch_id)
        .filter(match, WfCoatingItem.element_kind == kind, WfCoatingBatch.status.notin_(("completed", "cancelled")))
        .all()
    )
    if not rows:
        return None
    _item, batch = max(rows, key=lambda pair: pair[1].id or 0)
    company = db.get(models.WhCompany, batch.company_id) if batch.company_id else None
    return {"status": batch.status, "company": company.name if company else None, "code": None}


def _wh_one(db: Session, kind: str, serial: str) -> dict[str, Any] | None:
    match = compact_eq(models.WhElementState.serial, serial)
    if match is None:
        return None
    state = db.query(models.WhElementState).filter(match, models.WhElementState.element_kind == kind).first()
    if state is None:
        return None
    company = db.get(models.WhCompany, state.company_id) if state.company_id else None
    return {"status": state.lifecycle_status, "company": company.name if company else None}


def part_now(db: Session, kind: str, serial: str, skip_id: int | None) -> dict[str, Any]:
    """Where one anode, cathode or membrane is after its element was taken apart."""
    shown = str(serial).strip()
    base = {"kind": kind, "serial": shown, "place": "idle", "status": "taken_off", "element_nr": None, "electrolyzer": None, "position": None, "company": None, "note": None}
    if not compact_nr(shown):
        return base
    field = {"anode": "anode_nr", "cathode": "cathode_nr", "membrane": "membrane_nr"}[kind]
    mounted = _current_mount(db, field, shown, skip_id)
    if mounted is not None:
        if mounted.commissioning_date and not mounted.decommissioning_date:
            status = "in_service"
        elif mounted.assembly_date or mounted.electrolyzer:
            status = "assembled"
        else:
            status = "waiting"
        base.update(
            {
                "place": "element",
                "status": status,
                "element_nr": mounted.element_nr,
                "electrolyzer": mounted.electrolyzer,
                "position": mounted.position,
            }
        )
        return base
    if kind != "membrane":
        coating = _open_coating(db, kind, shown)
        if coating:
            base.update({"place": "recoating", "status": coating["status"] or "recoating", "company": coating["company"]})
            return base
        warehouse = _wh_one(db, kind, shown)
        if warehouse and warehouse["status"] in ("at_coater", "ready_dispatch", "pending_receive"):
            base.update({"place": "warehouse", "status": warehouse["status"], "company": warehouse["company"]})
            return base
        decision = _segregation_of(db, kind, shown)
        if decision:
            base.update({"place": "inspection", "status": decision["status"], "note": decision["note"]})
            return base
        return base
    master = db.query(models.Membrane).filter(compact_eq(models.Membrane.membrane_nr, shown)).first()
    if master is not None and master.decommission_date:
        base.update({"place": "inspection", "status": "rate_off"})
    return base


def parts_now(db: Session, *, anode_nr: str | None, cathode_nr: str | None, membrane_nr: str | None, skip_id: int | None) -> list[dict[str, Any]]:
    rows = []
    for kind, serial in (("anode", anode_nr), ("cathode", cathode_nr), ("membrane", membrane_nr)):
        if compact_nr(serial):
            rows.append(part_now(db, kind, serial or "", skip_id))
    return rows


def life_histogram(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bins = [("0-25%", 0, 25), ("25-50%", 25, 50), ("50-75%", 50, 75), ("75-100%", 75, 100), (">100%", 100, 10**9)]
    out = []
    for label, lo, hi in bins:
        sel = [r for r in rows if r["life_pct"] is not None and lo <= r["life_pct"] < hi]
        out.append(
            {
                "label": label,
                "installed": sum(1 for r in sel if r["installed"]),
                "warehouse": sum(1 for r in sel if not r["installed"]),
            }
        )
    return out


def _due_within(row: dict[str, Any], days: int) -> bool:
    left = row.get("life_left")
    return row["life_status"] in ("ok", "warning") and left is not None and 0 <= left <= days


def life_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    installed = [r for r in rows if r["installed"]]
    return {
        "total": len(rows),
        "installed": len(installed),
        "in_service": sum(1 for r in rows if r["in_service"]),
        "warehouse": len(rows) - len(installed),
        "warning": sum(1 for r in rows if r["life_status"] == "warning"),
        "expired": sum(1 for r in rows if r["life_status"] == "expired"),
        "installed_warning": sum(1 for r in installed if r["life_status"] == "warning"),
        "installed_expired": sum(1 for r in installed if r["life_status"] == "expired"),
        "installed_ok": sum(1 for r in installed if r["life_status"] == "ok"),
        "installed_known": sum(1 for r in installed if r["life_status"] != "unknown"),
        # parts mounted now that will reach the life limit within the next N days (already expired ones are not counted)
        "due_30": sum(1 for r in installed if _due_within(r, 30)),
        "due_90": sum(1 for r in installed if _due_within(r, 90)),
        "due_180": sum(1 for r in installed if _due_within(r, 180)),
        "buckets": {name: sum(1 for r in rows if r["bucket"] == name) for name in BUCKETS},
    }


# ---------------------------------------------------------------- coating overview


def coating_overview(
    db: Session,
    kind: str,
    settings: dict[str, Any] | None = None,
    prepared: tuple[list[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    cfg = settings or settings_dict(get_settings(db))
    rows, meta = prepared if prepared is not None else electrode_rows(db, kind, cfg)
    jobs = _coating_jobs(db, kind)
    thin = cfg.get("coating_thickness_min")
    today = date.today()

    def short(r: dict[str, Any], reasons: list[str] | None = None) -> dict[str, Any]:
        return {**r, "reasons": reasons or []}

    at_coater = sorted((short(r) for r in rows if r["at_coater"]), key=lambda r: -(r["days_away"] or 0))
    pending = [short(r) for r in rows if r["bucket"] == "pending" and not r["at_coater"]]
    candidates: list[dict[str, Any]] = []
    for r in rows:
        if r["installed"] or r["at_coater"] or r["bucket"] not in ("ok", "not_ok"):
            continue
        reasons: list[str] = []
        if r["life_status"] == "expired":
            reasons.append("life_expired")
        elif r["life_status"] == "warning":
            reasons.append("life_warning")
        if thin is not None and r["residual_thickness"] is not None and r["residual_thickness"] < thin:
            reasons.append("thin_coating")
        if r["bucket"] == "not_ok" and r["reason"] == "coating":
            reasons.append("coating_failed")
        if r["bucket"] == "not_ok" and r["reason"] == "segregation":
            reasons.append("segregation_problem")
        if r["wh_status"] == "ready_dispatch":
            reasons.append("ready_dispatch")
        if reasons:
            candidates.append(short(r, reasons))
    candidates.sort(key=lambda r: (-(r["life_pct"] or 0), r["serial"]))
    installed_due = sorted(
        (short(r, [f"life_{r['life_status']}"]) for r in rows if r["installed"] and r["life_status"] in ("warning", "expired")),
        key=lambda r: -(r["life_pct"] or 0),
    )

    by_piece = Counter(j["key"] for j in jobs)
    times = Counter(min(n, 4) for n in by_piece.values())
    returned = [j for j in jobs if j["dispatch"] and j["return"] and j["return"] >= j["dispatch"]]
    turnaround = [(j["return"] - j["dispatch"]).days for j in returned]
    by_year: dict[int, dict[str, int]] = defaultdict(lambda: {"sent": 0, "returned": 0})
    for j in jobs:
        if j["dispatch"]:
            by_year[j["dispatch"].year]["sent"] += 1
        if j["return"]:
            by_year[j["return"].year]["returned"] += 1
    coaters: dict[str, dict[str, Any]] = {}
    for j in jobs:
        name = j["coater"] or "—"
        agg = coaters.setdefault(name, {"coater": name, "jobs": 0, "returned": 0, "open": 0, "days": []})
        agg["jobs"] += 1
        if j["return"]:
            agg["returned"] += 1
            if j["dispatch"] and j["return"] >= j["dispatch"]:
                agg["days"].append((j["return"] - j["dispatch"]).days)
    for r in at_coater:
        name = r["coater"] or "—"
        coaters.setdefault(name, {"coater": name, "jobs": 0, "returned": 0, "open": 0, "days": []})["open"] += 1
    coater_rows = [
        {"coater": c["coater"], "jobs": c["jobs"], "returned": c["returned"], "open": c["open"], "avg_days": round(sum(c["days"]) / len(c["days"])) if c["days"] else None}
        for c in sorted(coaters.values(), key=lambda c: -c["jobs"])
    ]
    monthly: dict[str, dict[str, int]] = {}
    for offset in range(11, -1, -1):
        month = (today.replace(day=1) - timedelta(days=30 * offset)).strftime("%Y-%m")
        monthly.setdefault(month, {"sent": 0, "returned": 0})
    for j in jobs:
        for field, name in (("dispatch", "sent"), ("return", "returned")):
            if j[field]:
                tag = j[field].strftime("%Y-%m")
                if tag in monthly:
                    monthly[tag][name] += 1

    recoated_pieces = len(by_piece)
    return {
        "kind": kind,
        "summary": {
            "pieces": len(rows),
            "recoated_pieces": recoated_pieces,
            "recoat_jobs": len(jobs),
            "never_recoated": len(rows) - recoated_pieces,
            "at_coater": len(at_coater),
            "pending_check": len(pending),
            "candidates": len(candidates),
            "installed_due": len(installed_due),
            "avg_turnaround_days": round(sum(turnaround) / len(turnaround)) if turnaround else None,
            "max_days_away": max((r["days_away"] or 0 for r in at_coater), default=0),
            "thin_threshold": thin,
        },
        "times": [{"label": label, "pieces": times.get(n, 0)} for n, label in ((1, "1×"), (2, "2×"), (3, "3×"), (4, "4×+"))],
        "by_year": [{"year": y, **v} for y, v in sorted(by_year.items())],
        "monthly": [{"month": m, **v} for m, v in monthly.items()],
        "coaters": coater_rows,
        "at_coater": at_coater,
        "pending_check": pending,
        "candidates": candidates[:LIST_LIMIT],
        "installed_due": installed_due[:LIST_LIMIT],
        "truncated": len(candidates) > LIST_LIMIT or len(installed_due) > LIST_LIMIT,
        "limit": meta["limit"],
    }


# ---------------------------------------------------------------- installed overview


def _real(raw: Any) -> bool:
    return bool(compact_nr(raw)) and not is_junk_serial(raw)


def installed_overview(db: Session, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = settings or settings_dict(get_settings(db))
    pipeline = [p for p in build_pipeline(db) if p["base_state"] in PLACED_STATES]
    life = {}
    for kind in ("anode", "cathode", "membrane"):
        life[kind] = {r["key"]: r for r in part_rows(db, kind, cfg) if r["installed"]}

    def part(item: dict[str, Any], kind: str) -> dict[str, Any]:
        raw = item[f"{kind}_nr"]
        key = compact_nr(raw)
        info = life[kind].get(key) if key else None
        return {
            "serial": raw,
            "life_pct": info["life_pct"] if info else None,
            "life_status": info["life_status"] if info else "unknown",
            "dol": (info["coating_dol"] if kind != "membrane" else info["total_dol"]) if info else None,
        }

    elements = []
    mounts: dict[str, dict[str, set[str]]] = {k: defaultdict(set) for k in ("anode", "cathode", "membrane")}
    for item in pipeline:
        parts = {kind: part(item, kind) for kind in ("anode", "cathode", "membrane")}
        for kind in parts:
            if _real(item[f"{kind}_nr"]):
                mounts[kind][compact_nr(item[f"{kind}_nr"])].add(item["element_nr"])
        elements.append({**{k: item[k] for k in ("element_nr", "state", "electrolyzer", "position", "group_nr", "commissioning_date", "dol", "days_in_state")}, **{f"{k}": v for k, v in parts.items()}})

    counts = {kind: len(mounts[kind]) for kind in mounts}
    duplicates = {kind: sorted(f"{key} → {', '.join(sorted(els))}" for key, els in mounts[kind].items() if len(els) > 1) for kind in mounts}
    missing = {
        kind: sum(1 for item in pipeline if not _real(item[f"{kind}_nr"]))
        for kind in ("anode", "cathode", "membrane")
    }

    by_el: dict[str, dict[str, Any]] = {}
    for name in all_electrolyzers():
        by_el[name] = {"electrolyzer": name, "cells": 0, "in_service": 0, "anodes": 0, "cathodes": 0, "membranes": 0, "capacity": CELLS_PER_ELECTROLYZER}
    for item in pipeline:
        agg = by_el.get(item["electrolyzer"] or "")
        if agg is None:
            continue
        agg["cells"] += 1
        agg["in_service"] += 1 if item["state"] == "in_service" else 0
        agg["anodes"] += 1 if _real(item["anode_nr"]) else 0
        agg["cathodes"] += 1 if _real(item["cathode_nr"]) else 0
        agg["membranes"] += 1 if _real(item["membrane_nr"]) else 0
    return {
        "summary": {
            "cells": len(pipeline),
            "in_service": sum(1 for p in pipeline if p["state"] == "in_service"),
            "anodes": counts["anode"],
            "cathodes": counts["cathode"],
            "membranes": counts["membrane"],
            "missing": missing,
            "duplicates": {k: len(v) for k, v in duplicates.items()},
            "capacity": PLANT_CAPACITY,
        },
        "duplicates": duplicates,
        "by_electrolyzer": list(by_el.values()),
        "elements": elements,
    }


# ---------------------------------------------------------------- cell occupancy (what sits in every cell)

PLACED_STATES = ("in_service", "installed", "decommissioned")


@_memo
def cells_overview(db: Session) -> dict[str, Any]:
    """Which element sits in every cell of every electrolyzer, and where an element is entered twice.

    Uses Assembly Data directly: an element is *in a cell* while its newest installation has no
    disassembly date. A cell with two such elements is a conflict (``conflict`` when two of them are
    on line / installed, ``stale`` when the extra one is only switched off but never dismantled).
    The same element number open in two different cells is listed under ``multi_cell``.
    """
    rows = db.query(models.Element).all()
    latest: dict[str, models.Element] = {}
    for el in rows:
        key = compact_nr(el.element_nr)
        if not key:
            continue
        if key not in latest or _life_key(el) >= _life_key(latest[key]):
            latest[key] = el

    def cell_of(el: models.Element) -> tuple[str, int] | None:
        if not _valid_electrolyzer(el.electrolyzer):
            return None
        name = format_electrolyzer_name(el.electrolyzer)
        text = norm_pos(el.position)
        if not name or not text.isdigit():
            return None
        return name, int(text)

    known = set(all_electrolyzers())
    occupants: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    unplaced = 0  # in the plant but no usable electrolyzer / position
    out_of_range = 0
    for key, el in latest.items():
        if el.disassembly_date:
            continue
        state = _base_state(el)
        if state not in PLACED_STATES:
            continue
        cell = cell_of(el)
        if cell is None:
            if _valid_electrolyzer(el.electrolyzer):
                unplaced += 1
            continue
        if cell[0] not in known or not 1 <= cell[1] <= CELLS_PER_ELECTROLYZER:
            out_of_range += 1
            continue
        occupants[cell].append(
            {
                "element_nr": str(el.element_nr).strip(),
                "state": state,
                "group_nr": el.group_nr,
                "anode_nr": el.anode_nr,
                "cathode_nr": el.cathode_nr,
                "membrane_nr": el.membrane_nr,
                "commissioning_date": _iso(el.commissioning_date),
                "dol": installation_dol(el.assembly_date, el.commissioning_date, el.disassembly_date, el.decommissioning_date),
            }
        )

    # the same element number still open in more than one cell (an older row that was never closed)
    open_cells: dict[str, dict[tuple[str, int], str]] = defaultdict(dict)
    for el in rows:
        key = compact_nr(el.element_nr)
        if not key or el.disassembly_date:
            continue
        if _base_state(el) not in PLACED_STATES:
            continue
        cell = cell_of(el)
        if cell is not None and cell[0] in known:
            open_cells[key].setdefault(cell, str(el.element_nr).strip())
    multi_cell = []
    flagged_cells: set[tuple[str, int]] = set()
    for key, cells in open_cells.items():
        if len(cells) > 1:
            names = sorted(cells, key=lambda c: (c[0][-1], c[0][0], c[1]))
            flagged_cells.update(names)
            multi_cell.append({"element_nr": next(iter(cells.values())), "cells": [f"{n}-{p}" for n, p in names]})
    multi_cell.sort(key=lambda m: m["element_nr"])

    cells_out: list[dict[str, Any]] = []
    per_el: dict[str, dict[str, int]] = {
        name: {"occupied": 0, "conflict": 0, "stale": 0, "in_service": 0} for name in all_electrolyzers()
    }
    for (name, pos), items in occupants.items():
        active = sum(1 for i in items if i["state"] in ("in_service", "installed"))
        if len(items) == 1:
            status = "ok"
        elif active >= 2:
            status = "conflict"
        else:
            status = "stale"
        items.sort(key=lambda i: (0 if i["state"] != "decommissioned" else 1, i["element_nr"]))
        agg = per_el[name]
        agg["occupied"] += 1
        agg["in_service"] += 1 if any(i["state"] == "in_service" for i in items) else 0
        if status == "conflict":
            agg["conflict"] += 1
        elif status == "stale":
            agg["stale"] += 1
        cells_out.append({"electrolyzer": name, "position": pos, "status": status, "elements": items})
    cells_out.sort(key=lambda c: (c["electrolyzer"][-1], c["electrolyzer"][0], c["position"]))

    trains = []
    for train in ("1", "2"):
        names = [n for n in all_electrolyzers() if n.endswith(train)]
        trains.append(
            {
                "train": train,
                "electrolyzers": [
                    {"electrolyzer": n, "capacity": CELLS_PER_ELECTROLYZER, "empty": CELLS_PER_ELECTROLYZER - per_el[n]["occupied"], **per_el[n]}
                    for n in names
                ],
            }
        )
    occupied = len(occupants)
    conflict = sum(1 for c in cells_out if c["status"] == "conflict")
    stale = sum(1 for c in cells_out if c["status"] == "stale")
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "summary": {
            "capacity": PLANT_CAPACITY,
            "occupied_cells": occupied,
            "empty_cells": PLANT_CAPACITY - occupied,
            "elements_placed": sum(len(c["elements"]) for c in cells_out),
            "conflict_cells": conflict,
            "stale_cells": stale,
            "multi_cell_elements": len(multi_cell),
            "unplaced": unplaced,
            "out_of_range": out_of_range,
            "problems": conflict + stale + len(multi_cell),
        },
        "trains": trains,
        "cells": cells_out,
        "multi_cell": multi_cell,
    }


# ---------------------------------------------------------------- the headline overview


def _monthly_flow(db: Session, months: int = 12) -> list[dict[str, Any]]:
    today = date.today()
    first = today.replace(day=1)
    tags: list[str] = []
    cursor = first
    for _ in range(months):
        tags.append(cursor.strftime("%Y-%m"))
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    tags.reverse()
    flow = {tag: {"month": tag, "assembled": 0, "commissioned": 0, "decommissioned": 0, "disassembled": 0} for tag in tags}
    for el in db.query(models.Element).all():
        for field, name in (("assembly_date", "assembled"), ("commissioning_date", "commissioned"), ("decommissioning_date", "decommissioned"), ("disassembly_date", "disassembled")):
            day = _as_date(getattr(el, field))
            if day:
                tag = day.strftime("%Y-%m")
                if tag in flow:
                    flow[tag][name] += 1
    return [flow[t] for t in tags]


@_memo
def audit_report(db: Session) -> dict[str, Any]:
    from .relationship_audit import run_audit

    return run_audit(db)


def _piece_vendor(row: dict[str, Any]) -> str:
    from .segregation_flow import vendor_of

    return vendor_of(row.get("coating"), row.get("manufacturer")) or "Other"


def _stock_block(rows: list[dict[str, Any]]) -> dict[str, Any]:
    spare = [r for r in rows if not r["installed"] and not r["at_coater"]]
    usable = [r for r in spare if r["bucket"] == "ok"]
    coated: Counter = Counter(_piece_vendor(r) for r in usable)
    lm = sum(1 for r in usable if str(r.get("last_electrolyzer") or "").strip().upper()[:1] in {"L", "M"})
    return {
        "usable": len(usable),
        "rate_off": sum(1 for r in spare if r["bucket"] == "not_ok"),
        "awaiting_check": sum(1 for r in spare if r["bucket"] == "pending"),
        "ready_dispatch": sum(1 for r in rows if r.get("wh_status") == "ready_dispatch"),
        "train_lm": lm,
        "coated": [{"vendor": name, "count": count} for name, count in coated.most_common() if name != "Other" or count],
    }


def _coating_by_company(db: Session) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, int]] = {}
    for kind in ("anode", "cathode"):
        for job in _coating_jobs(db, kind):
            name = (job.get("coater") or "").strip() or "—"
            row = merged.setdefault(name, {"anode_open": 0, "anode_returned": 0, "cathode_open": 0, "cathode_returned": 0})
            if job.get("return"):
                row[f"{kind}_returned"] += 1
            elif job.get("dispatch"):
                row[f"{kind}_open"] += 1
    out = [{"company": name, **counts} for name, counts in merged.items()]
    out.sort(key=lambda r: -(r["anode_returned"] + r["cathode_returned"] + r["anode_open"] + r["cathode_open"]))
    return out


def workshop_inventory(
    db: Session,
    pipeline: list[dict[str, Any]],
    anode_rows: list[dict[str, Any]],
    cathode_rows: list[dict[str, Any]],
    membranes: list[dict[str, Any]],
) -> dict[str, Any]:
    """The workshop sheet: assembled cells waiting to go on site, spare electrodes, coating, membranes."""
    from .segregation_flow import vendor_of

    ready = [
        p
        for p in pipeline
        if p.get("assembly_date") and not p.get("disassembly_date") and not p.get("commissioning_date") and not p.get("electrolyzer")
    ]
    ids = [p["row_id"] for p in ready if p.get("row_id")]
    elements = {e.id: e for e in db.query(models.Element).filter(models.Element.id.in_(ids)).all()} if ids else {}
    pairs: Counter = Counter()
    membrane_on_cell: Counter = Counter()
    for item in ready:
        el = elements.get(item.get("row_id"))
        anode = vendor_of(el.anode_coating) if el is not None else None
        cathode = vendor_of(el.cathode_coating) if el is not None else None
        pairs[(anode or "Other", cathode or "Other")] += 1
        membrane_on_cell[(item.get("membrane_type") or "").strip() or "—"] += 1
    stock_mem = [r for r in membranes if not r["installed"] and r["bucket"] == "ok"]
    by_type: Counter = Counter((r.get("membrane_type") or "").strip() or "—" for r in stock_mem)
    return {
        "assembled_total": len(ready),
        "assembled_pairs": [{"anode": a, "cathode": c, "count": n} for (a, c), n in pairs.most_common()],
        "assembled_membranes": [{"type": name, "count": n} for name, n in membrane_on_cell.most_common()],
        "awaiting_disassembly": sum(1 for p in pipeline if p.get("base_state") == "decommissioned" or p.get("state") == "awaiting_disassembly"),
        "anode": _stock_block(anode_rows),
        "cathode": _stock_block(cathode_rows),
        "coating_companies": _coating_by_company(db),
        "membrane_stock": len(stock_mem),
        "membrane_types": [{"type": name, "count": n} for name, n in by_type.most_common(12)],
    }


@_memo
def overview(db: Session) -> dict[str, Any]:
    cfg = settings_dict(get_settings(db))
    pipeline = build_pipeline(db)
    counts = pipeline_counts(pipeline)
    today = date.today()

    recent_cut = today - timedelta(days=90)
    recently_disassembled = sum(
        1
        for p in pipeline
        if p["base_state"] == "disassembled" and p["disassembly_date"] and date.fromisoformat(p["disassembly_date"]) >= recent_cut
    )
    shop_states = ("awaiting_disassembly", "awaiting_assembly", "assembling", "awaiting_qc", "ready")
    oldest = sorted((p for p in pipeline if p["state"] in shop_states and p["days_in_state"] is not None), key=lambda p: -p["days_in_state"])[:5]

    parts: dict[str, Any] = {}
    coating: dict[str, Any] = {}
    prepared_rows: dict[str, list[dict[str, Any]]] = {}
    for kind in ("anode", "cathode"):
        prepared = electrode_rows(db, kind, cfg)
        prepared_rows[kind] = prepared[0]
        parts[kind] = {"summary": life_summary(prepared[0]), "histogram": life_histogram(prepared[0])}
        coating[kind] = coating_overview(db, kind, cfg, prepared=prepared)["summary"]
    mem = membrane_rows(db, cfg)
    parts["membrane"] = {"summary": life_summary(mem), "histogram": life_histogram(mem)}

    # cells with an open voltage alert (worst severity per cell), not the number of raw events
    worst: dict[tuple[str, str], str] = {}
    rank = {"danger": 2, "warning": 1}
    for ev in db.query(models.AlertEvent).filter(models.AlertEvent.status == "open", models.AlertEvent.category == "voltage").all():
        cell = (ev.electrolyzer or "", ev.position or "")
        if rank.get(ev.severity, 0) >= rank.get(worst.get(cell, ""), 0):
            worst[cell] = ev.severity
    alerts = Counter(worst.values())

    in_plant = sum(1 for p in pipeline if p["base_state"] in PLACED_STATES)
    by_electrolyzer: Counter = Counter()
    for p in pipeline:
        if p["base_state"] in PLACED_STATES and p["electrolyzer"]:
            by_electrolyzer[p["electrolyzer"]] += 1

    events = (
        db.query(models.ElementShopEvent).order_by(models.ElementShopEvent.created_at.desc(), models.ElementShopEvent.id.desc()).limit(12).all()
    )
    cell_data = cells_overview(db)
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "cell_check": {
            "summary": cell_data["summary"],
            "trains": cell_data["trains"],
            "problems": [
                {"cell": f"{c['electrolyzer']}-{c['position']}", "status": c["status"], "elements": [e["element_nr"] for e in c["elements"]]}
                for c in cell_data["cells"]
                if c["status"] != "ok"
            ][:30],
            "multi_cell": cell_data["multi_cell"][:30],
        },
        "capacity": PLANT_CAPACITY,
        "counts": counts,
        "in_plant": in_plant,
        "occupancy_pct": round(in_plant * 100.0 / PLANT_CAPACITY, 1) if PLANT_CAPACITY else None,
        "recently_disassembled": recently_disassembled,
        "oldest_waiting": [
            {k: p[k] for k in ("element_nr", "state", "days_in_state", "since", "note")} for p in oldest
        ],
        "parts": parts,
        "coating": coating,
        "workshop": workshop_inventory(db, pipeline, prepared_rows["anode"], prepared_rows["cathode"], mem),
        "alerts": {"danger": alerts.get("danger", 0), "warning": alerts.get("warning", 0), "info": alerts.get("info", 0)},
        "by_electrolyzer": [{"electrolyzer": name, "cells": by_electrolyzer.get(name, 0), "capacity": CELLS_PER_ELECTROLYZER} for name in all_electrolyzers()],
        "monthly_flow": _monthly_flow(db),
        "events": [
            {"id": e.id, "element_nr": e.element_nr, "from_stage": e.from_stage, "to_stage": e.to_stage, "note": e.note, "user": e.user, "at": e.created_at.isoformat(timespec="seconds") if e.created_at else None}
            for e in events
        ],
        "settings": cfg,
    }
