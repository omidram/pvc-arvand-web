"""Element Workflow: where every element and electrode is in the plant's flowchart, and what does not fit.

Flowchart:

    In Service --(operator records the decommissioning date and the failure reason)-->
        healthy, or only a balance --> same element, new position only
        broken --> C90, waiting for disassembly
    C90 dismantles it --> the element is rate off and ceases; anode, cathode and membrane are separate
    Inspection examines the anode and the cathode:
        usable, good coating / usable, medium coating (separate counts) --> ready for a NEW element
        holed or unusable, irreparable --> that piece is rate off
        holed or unusable, but recoatable --> recoating, then the coating steps continue

Nothing is stored here: every number is read from Assembly Data, Segregation, the warehouse board and the recoating jobs.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from . import element_dashboard as dash
from . import models
from .relations_sync import is_junk_serial
from .segregation_flow import classify_row
from .warehouse import _as_date, _iso, _life_key, compact_nr

RECENT_DAYS = 365  # a removal older than this is history; missing decisions are only chased for recent ones
SEG_SLACK = 45  # a decision may be written this many days before the recorded disassembly date

KINDS = ("anode", "cathode")

# Flowchart nodes that hold electrodes (everything after "decision").
ELECTRODE_NODES = (
    "reusable_good",
    "reusable_medium",
    "reusable_open",
    "rate_off",
    "coating_warranty",
    "coating_no_warranty",
    "mechanical_warranty",
    "mechanical_no_warranty",
    "undecided",
)

ISSUES = (
    "decommission_no_reason",
    "disassembled_no_decision",
    "warranty_no_vendor",
    "rate_off_installed",
    "problem_installed",
    "warehouse_ok_but_not_reusable",
    "warehouse_bad_but_reusable",
)


def _seg_day(row: models.ElectrodeSegregation) -> date | None:
    return _as_date(row.inspection_date) or _as_date(row.disassemble_date) or _as_date(row.decommission_date)


def _start(el: models.Element) -> date | None:
    return _as_date(el.commissioning_date) or _as_date(el.assembly_date)


def _end(el: models.Element) -> date | None:
    return _as_date(el.disassembly_date) or _as_date(el.decommissioning_date)


def node_of(info: dict[str, Any]) -> str:
    outcome = info["outcome"]
    if outcome == "reusable":
        return {"good": "reusable_good", "medium": "reusable_medium"}.get(info["quality"], "reusable_open")
    if outcome == "rate_off":
        return "rate_off"
    if outcome == "undecided":
        return "undecided"
    base = "coating" if outcome == "coating_problem" else "mechanical"
    return f"{base}_warranty" if info["warranty"] else f"{base}_no_warranty"


def _latest_segregations(db: Session) -> dict[tuple[str, str], models.ElectrodeSegregation]:
    best: dict[tuple[str, str], models.ElectrodeSegregation] = {}
    for row in db.query(models.ElectrodeSegregation).all():
        key = compact_nr(row.serial_nr)
        if not key:
            continue
        kinds = [row.electrode_kind] if row.electrode_kind in KINDS else list(KINDS)  # unknown kind: matched later by the electrode itself
        for kind in kinds:
            rank = (_seg_day(row) or date.min, row.id or 0)
            cur = best.get((kind, key))
            if cur is None or rank >= (_seg_day(cur) or date.min, cur.id or 0):
                best[(kind, key)] = row
    return best


def build(db: Session) -> dict[str, Any]:
    """Electrode flow rows plus every cross-check. Cached for a short time by the caller."""
    today = date.today()
    recent_from = today - timedelta(days=RECENT_DAYS)
    elements = db.query(models.Element).all()
    segs = _latest_segregations(db)

    rows: list[dict[str, Any]] = []
    issues: dict[str, list[dict[str, Any]]] = {name: [] for name in ISSUES}

    for kind in KINDS:
        field = f"{kind}_nr"
        by_key: dict[str, list[models.Element]] = defaultdict(list)
        for el in elements:
            key = compact_nr(getattr(el, field))
            if key and not is_junk_serial(key):
                by_key[key].append(el)
        wh = {r["key"]: r for r in dash.electrode_rows(db, kind)[0]}

        for key in {k for (kd, k) in segs if kd == kind} | set(by_key):
            lives = sorted(by_key.get(key, []), key=_life_key)
            latest = lives[-1] if lives else None
            info_row = wh.get(key)
            display = (getattr(latest, field) if latest is not None else None) or (info_row["serial"] if info_row else key)
            seg = segs.get((kind, key))
            seg_day = _seg_day(seg) if seg is not None else None
            start = _start(latest) if latest is not None else None
            end = _end(latest) if latest is not None else None
            installed = bool(info_row["installed"]) if info_row else bool(latest is not None and latest.disassembly_date is None and (latest.electrolyzer or latest.commissioning_date or latest.assembly_date))
            decision = classify_row(seg) if seg is not None else None
            base = {
                "kind": kind,
                "serial": str(display).strip(),
                "key": key,
                "element_nr": latest.element_nr if latest is not None else None,
                "installed": installed,
            }

            # ---- removal without a decision (the flowchart's "separation, inspection, decision" step)
            if latest is not None and not installed and latest.disassembly_date is not None:
                removed = _as_date(latest.disassembly_date)
                reinstalled = any((_start(o) or date.min) >= removed for o in lives if o is not latest)
                answered = seg_day is not None and removed is not None and seg_day >= removed - timedelta(days=SEG_SLACK)
                if removed is not None and removed >= recent_from and not answered and not reinstalled:
                    issues["disassembled_no_decision"].append({**base, "date": _iso(removed), "detail": None})

            if decision is None or seg is None:
                continue

            consumed = bool(start and seg_day and start > seg_day)  # installed again after this decision was written
            stale = bool(not installed and end and seg_day and seg_day < end - timedelta(days=SEG_SLACK))  # decision belongs to an earlier removal
            resolved = bool(
                decision["outcome"] in ("coating_problem", "mechanical_problem")
                and info_row
                and info_row.get("last_coating_return")
                and seg_day
                and info_row["last_coating_return"] >= seg_day.isoformat()
            )
            at_coater = bool(info_row and info_row.get("at_coater"))
            bucket = info_row["bucket"] if info_row else None
            detail = decision["vendor"] or ("—" if decision["warranty"] else None)
            row = {
                **base,
                "node": node_of(decision),
                "outcome": decision["outcome"],
                "quality": decision["quality"],
                "warranty": decision["warranty"],
                "vendor": decision["vendor"],
                "destination": decision["destination"],
                "steps": decision["steps"],
                "date": _iso(seg_day),
                "decision": seg.decision,
                "segregation": seg.segregation,
                "problems": seg.problems,
                "pallet": seg.pallet,
                "bucket": bucket,
                "at_coater": at_coater,
                "resolved": resolved,
                "current": not installed and not consumed and not stale and not resolved,
                "detail": detail,
            }

            if decision["warranty"] and not decision["vendor"]:
                issues["warranty_no_vendor"].append({**row, "detail": seg.decision or seg.segregation})

            if installed and consumed:
                if decision["outcome"] == "rate_off":
                    issues["rate_off_installed"].append({**row, "detail": seg.decision or seg.segregation})
                elif decision["outcome"] in ("coating_problem", "mechanical_problem") and not resolved:
                    issues["problem_installed"].append({**row, "detail": seg.decision or seg.segregation})

            if row["current"]:
                rows.append(row)
                if decision["outcome"] in ("rate_off", "coating_problem", "mechanical_problem") and bucket == "ok":
                    issues["warehouse_ok_but_not_reusable"].append({**row, "detail": seg.decision or seg.segregation})
                if decision["outcome"] == "reusable" and bucket in ("not_ok", "out_repair"):
                    issues["warehouse_bad_but_reusable"].append({**row, "detail": f"{bucket}: {info_row['reason']}" if info_row else bucket})

    # elements taken out of service but with no reason recorded
    for el in elements:
        if el.decommissioning_date and not (el.decommission_reason or "").strip() and (_as_date(el.decommissioning_date) or date.min) >= recent_from:
            issues["decommission_no_reason"].append(
                {"kind": "element", "serial": str(el.element_nr or "").strip(), "key": compact_nr(el.element_nr), "element_nr": el.element_nr, "date": _iso(el.decommissioning_date), "detail": f"{el.electrolyzer or ''}-{el.position or ''}".strip("-")}
            )

    return {"rows": rows, "issues": issues}


_BUILD_CACHE: dict[int, tuple[float, dict[str, Any]]] = {}


def cached_build(db: Session) -> dict[str, Any]:
    import time

    key = id(db.get_bind())
    hit = _BUILD_CACHE.get(key)
    now = time.monotonic()
    if hit is not None and now - hit[0] < dash.CACHE_SECONDS:
        return hit[1]
    data = build(db)
    _BUILD_CACHE[key] = (now, data)
    return data


def clear_cache() -> None:
    _BUILD_CACHE.clear()


def overview(db: Session) -> dict[str, Any]:
    data = cached_build(db)
    pipeline = dash.build_pipeline(db)
    counts = dash.pipeline_counts(pipeline)
    node_counts: dict[str, dict[str, int]] = {n: {"anode": 0, "cathode": 0, "total": 0} for n in ELECTRODE_NODES}
    vendors: dict[str, int] = defaultdict(int)
    at_coater = 0
    for r in data["rows"]:
        slot = node_counts[r["node"]]
        slot[r["kind"]] += 1
        slot["total"] += 1
        if r["node"] in ("coating_warranty", "mechanical_warranty"):
            vendors[r["vendor"] or "—"] += 1
        if r["at_coater"]:
            at_coater += 1
    healthy_kept = sum(1 for i in pipeline if i["state"] == "ready" and i["base_state"] == "decommissioned")
    return {
        "elements": {
            "in_service": counts["in_service"],
            "installed": counts["installed"],
            "decommissioned": counts["decommissioned"],
            "awaiting_disassembly": counts["awaiting_disassembly"],
            "healthy_kept": healthy_kept,
            "awaiting_assembly": counts["awaiting_assembly"],
            "assembling": counts["assembling"],
            "awaiting_qc": counts["awaiting_qc"],
            "ready": counts["ready"],
        },
        "electrodes": node_counts,
        "vendors": [{"vendor": v, "count": n} for v, n in sorted(vendors.items(), key=lambda kv: -kv[1])],
        "at_coater": at_coater,
        "issues": {name: len(items) for name, items in data["issues"].items()},
        "recent_days": RECENT_DAYS,
    }


def node_list(db: Session, node: str, q: str | None = None, limit: int = 500) -> dict[str, Any]:
    data = cached_build(db)
    if node.startswith("issue:"):
        items = list(data["issues"].get(node[6:], []))
    elif node in ELECTRODE_NODES:
        items = [r for r in data["rows"] if r["node"] == node]
    else:
        items = []
    if q:
        needle = q.strip().lower()
        squeezed = compact_nr(q)
        items = [i for i in items if (squeezed and squeezed in (i.get("key") or "")) or needle in str(i.get("element_nr") or "").lower() or needle in str(i.get("detail") or "").lower()]
    items.sort(key=lambda i: (i.get("date") or ""), reverse=True)
    return {"node": node, "total": len(items), "items": items[:limit], "truncated": len(items) > limit}
