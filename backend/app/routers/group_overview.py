"""Group Overview: every cell element together with the specification of its defined group.

Mirrors the Access forms "Gruppen Übersicht" (active groups with their element counts) and
"frmSucheGruppe" (search a group, list all its elements). Filters take the Group Definition values
(anode coating, cathode coating, membrane type, electrode gap); leaving a filter empty means "All".
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..calculations import installation_dol
from ..database import get_db
from ..export_utils import ExportFilters, build_export_meta, export_pdf, export_xlsx
from .elements import natural_key

router = APIRouter(prefix="/group-overview", tags=["elements"])

# Group-definition fields compared with the element's own value.
SPEC_FIELDS = ["anode_coating", "cathode_coating", "membrane_type", "gap_mm"]

ROW_FIELDS = [
    "group_nr",
    "group_anode_coating",
    "group_cathode_coating",
    "group_membrane_type",
    "group_gap_mm",
    "group_remarks",
    "element_nr",
    "electrolyzer",
    "position",
    "status",
    "generation",
    "anode_nr",
    "cathode_nr",
    "membrane_nr",
    "anode_coating",
    "cathode_coating",
    "membrane_type",
    "gap_mm",
    "assembly_date",
    "commissioning_date",
    "disassembly_date",
    "dol_days",
    "mismatch",
    "remarks",
]


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def _same(a: Any, b: Any) -> bool:
    """Case-insensitive equality; numbers compare as numbers (2 == 2.0)."""
    left, right = _text(a).casefold(), _text(b).casefold()
    if left == right:
        return True
    try:
        return float(left.replace(",", ".")) == float(right.replace(",", "."))
    except ValueError:
        return False


def _spec_ok(spec: Any, wanted: Any) -> bool:
    """A group spec of "All" is valid for every value of that field."""
    return _text(spec).casefold() == "all" or _same(spec, wanted)


def _status(el: models.Element) -> str:
    if el.disassembly_date:
        return "disassembled"
    if el.decommissioning_date:
        return "decommissioned"
    if el.commissioning_date or el.assembly_date:
        return "active"
    return "planned"


def _is_live(status: str) -> bool:
    return status in ("active", "planned")


def _mismatches(el: models.Element, definition: models.GroupDefinition | None) -> list[str]:
    """Spec fields where the element deviates from its group (blank on either side is not a deviation)."""
    if definition is None:
        return []
    found = []
    for name in SPEC_FIELDS:
        wanted, actual = getattr(definition, name), getattr(el, name)
        if _text(wanted) and _text(actual) and not _spec_ok(wanted, actual):
            found.append(name)
    return found


def _definitions(db: Session) -> dict[str, models.GroupDefinition]:
    return {_text(d.group_nr): d for d in db.query(models.GroupDefinition).all()}


def _spec_score(definition: models.GroupDefinition, el: models.Element) -> int | None:
    """How many specified fields of this definition fit the element.

    A blank or "All" field is a wildcard. A filled field that differs from the
    element rules the definition out. Zero means the definition says nothing.
    """
    score = 0
    for name in SPEC_FIELDS:
        wanted = getattr(definition, name)
        if not _text(wanted) or _text(wanted).casefold() == "all":
            continue
        actual = getattr(el, name)
        if not _text(actual) or not _same(wanted, actual):
            return None
        score += 1
    return score


def _best_definition(el: models.Element, definitions: dict[str, models.GroupDefinition]) -> tuple[str, models.GroupDefinition | None]:
    """The element's own group number, or the one definition its coatings match."""
    key = _text(el.group_nr)
    if key:
        return key, definitions.get(key)
    best_score = 0
    best: list[tuple[str, models.GroupDefinition]] = []
    for gkey, definition in definitions.items():
        score = _spec_score(definition, el)
        if score is None or score <= 0:
            continue
        if score > best_score:
            best_score = score
            best = [(gkey, definition)]
        elif score == best_score:
            best.append((gkey, definition))
    if len(best) == 1:
        return best[0]
    return "", None


def _passes_spec(el: models.Element, definition: models.GroupDefinition | None, wanted: dict[str, Any]) -> bool:
    """A set filter matches the element's own value, or the group's definition when the element is blank."""
    for name, value in wanted.items():
        if not _text(value):
            continue
        actual = getattr(el, name, None)
        if _text(actual):
            if not _same(actual, value):
                return False
            continue
        if definition is None or not _spec_ok(getattr(definition, name), value):
            return False
    return True


@router.get("/summary")
def summary(
    anode_coating: str | None = None,
    cathode_coating: str | None = None,
    membrane_type: str | None = None,
    gap_mm: str | None = None,
    db: Session = Depends(get_db),
):
    """One line per group (defined, or used by an element): its spec and how many elements run in it."""
    definitions = _definitions(db)
    wanted = {"anode_coating": anode_coating, "cathode_coating": cathode_coating, "membrane_type": membrane_type, "gap_mm": gap_mm}
    spec_filter = any(_text(v) for v in wanted.values())
    stats: dict[str, dict[str, Any]] = {}
    for el in db.query(models.Element).all():
        key, definition = _best_definition(el, definitions)
        if not key or not _passes_spec(el, definition, wanted):
            continue
        row = stats.setdefault(key, {"active": 0, "total": 0, "off": 0, "mismatch": 0, "electrolyzers": set()})
        row["total"] += 1
        if _is_live(_status(el)):
            row["active"] += 1
            if el.electrolyzer:
                row["electrolyzers"].add(_text(el.electrolyzer))
            if _mismatches(el, definition):
                row["mismatch"] += 1
        else:
            row["off"] += 1

    out = []
    for key in sorted(set(definitions) | set(stats), key=natural_key):
        definition = definitions.get(key)
        defined_hit = definition is not None and all(
            not _text(v) or _spec_ok(getattr(definition, n), v) for n, v in wanted.items()
        )
        if spec_filter and not defined_hit and key not in stats:
            continue
        if not spec_filter and definition is None and key not in stats:
            continue
        counts = stats.get(key, {})
        out.append(
            {
                "group_nr": key,
                "defined": definition is not None,
                "anode_coating": definition.anode_coating if definition else None,
                "cathode_coating": definition.cathode_coating if definition else None,
                "membrane_type": definition.membrane_type if definition else None,
                "gap_mm": definition.gap_mm if definition else None,
                "remarks": definition.remarks if definition else None,
                "active_count": counts.get("active", 0),
                "inactive_count": counts.get("off", 0),
                "total_count": counts.get("total", 0),
                "mismatch_count": counts.get("mismatch", 0),
                "electrolyzers": sorted(counts.get("electrolyzers", set())),
            }
        )
    return out


def _rows(
    db: Session,
    *,
    group: str | None,
    anode_coating: str | None,
    cathode_coating: str | None,
    membrane_type: str | None,
    gap_mm: str | None,
    status: str,
    mismatch_only: bool,
    q: str | None,
) -> list[dict[str, Any]]:
    definitions = _definitions(db)
    wanted = {"anode_coating": anode_coating, "cathode_coating": cathode_coating, "membrane_type": membrane_type, "gap_mm": gap_mm}
    spec_filter = any(_text(v) for v in wanted.values())
    needle = _text(q).casefold()

    rows: list[dict[str, Any]] = []
    for el in db.query(models.Element).all():
        key, definition = _best_definition(el, definitions)
        if _text(group) and not _same(key, group):
            continue
        if not _passes_spec(el, definition, wanted):
            continue
        # Without a filter, only elements that belong to a group. A filter also lists
        # elements that match it even when no group definition fits them.
        if not key and not spec_filter:
            continue
        state = _status(el)
        if status == "active" and not _is_live(state):
            continue
        if status == "inactive" and _is_live(state):
            continue
        bad = _mismatches(el, definition)
        if mismatch_only and not bad:
            continue
        row = {
            "group_nr": key,
            "group_anode_coating": definition.anode_coating if definition else None,
            "group_cathode_coating": definition.cathode_coating if definition else None,
            "group_membrane_type": definition.membrane_type if definition else None,
            "group_gap_mm": definition.gap_mm if definition else None,
            "group_remarks": definition.remarks if definition else None,
            "element_nr": el.element_nr,
            "electrolyzer": el.electrolyzer,
            "position": el.position,
            "status": state,
            "generation": el.generation,
            "anode_nr": el.anode_nr,
            "cathode_nr": el.cathode_nr,
            "membrane_nr": el.membrane_nr,
            "anode_coating": el.anode_coating,
            "cathode_coating": el.cathode_coating,
            "membrane_type": el.membrane_type,
            "gap_mm": el.gap_mm,
            "assembly_date": el.assembly_date.isoformat() if el.assembly_date else None,
            "commissioning_date": el.commissioning_date.isoformat() if el.commissioning_date else None,
            "disassembly_date": el.disassembly_date.isoformat() if el.disassembly_date else None,
            "dol_days": installation_dol(
                el.assembly_date, el.commissioning_date, el.disassembly_date, el.decommissioning_date
            ),
            "mismatch": bad,
            "remarks": el.remarks,
            "defined": definition is not None,
        }
        if needle and needle not in " ".join(_text(v) for v in row.values() if not isinstance(v, (list, bool))).casefold():
            continue
        rows.append(row)

    rows.sort(
        key=lambda r: (
            natural_key(r["group_nr"]),
            natural_key(r["electrolyzer"]),
            natural_key(r["position"]),
            natural_key(r["element_nr"]),
        )
    )
    return rows


def _filters(
    group: str | None = Query(default=None, description="Group number; empty = all groups"),
    anode_coating: str | None = Query(default=None),
    cathode_coating: str | None = Query(default=None),
    membrane_type: str | None = Query(default=None),
    gap_mm: str | None = Query(default=None),
    status: str = Query(default="active", pattern="^(active|inactive|all)$"),
    mismatch_only: bool = Query(default=False),
    q: str | None = Query(default=None),
) -> dict[str, Any]:
    return {
        "group": group,
        "anode_coating": anode_coating,
        "cathode_coating": cathode_coating,
        "membrane_type": membrane_type,
        "gap_mm": gap_mm,
        "status": status,
        "mismatch_only": mismatch_only,
        "q": q,
    }


@router.get("/elements")
def elements(filters: dict[str, Any] = Depends(_filters), limit: int = Query(default=5000, le=50000), db: Session = Depends(get_db)):
    rows = _rows(db, **filters)
    return {"total": len(rows), "rows": rows[:limit]}


def _export_rows(db: Session, filters: dict[str, Any], export: ExportFilters):
    rows = _rows(db, **filters)
    for row in rows:
        row["mismatch"] = ", ".join(row["mismatch"])
        row.pop("defined", None)
    return export.apply(rows, ROW_FIELDS)


@router.get("/export.meta", include_in_schema=False)
def export_meta():
    return build_export_meta(ROW_FIELDS)


@router.get("/export.xlsx", include_in_schema=False)
def export_group_xlsx(
    filters: dict[str, Any] = Depends(_filters),
    export: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    rows, fields = _export_rows(db, filters, export)
    return export_xlsx(rows, fields, "group-overview")


@router.get("/export.pdf", include_in_schema=False)
def export_group_pdf(
    filters: dict[str, Any] = Depends(_filters),
    export: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    rows, fields = _export_rows(db, filters, export)
    return export_pdf(rows, fields, "group-overview")
