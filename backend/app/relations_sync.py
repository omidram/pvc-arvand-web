"""Keep related tables in step when data is saved.

The plant database links tables by *value* (anode number, element number, group, electrolyzer ...), not by
foreign keys. So a number typed into one form must be matched against the master table in the same way
everywhere: compared without case/spaces, stored with the master's spelling, and added to the master list
when it is new. These helpers do that; ``relationship_audit`` checks and repairs old data the same way.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .warehouse import compact_nr, ensure_indexed

# kind -> (master model, key field)
MASTERS: dict[str, tuple[Any, str]] = {
    "anode": (models.Anode, "anode_nr"),
    "cathode": (models.Cathode, "cathode_nr"),
    "membrane": (models.Membrane, "membrane_nr"),
}

# Values typed as "nothing" in the old Access data.
PLACEHOLDERS = frozenset({"*", "-", "—", "?", "XXXXX", "N/A", "NA"})


def is_placeholder(value: Any) -> bool:
    text = str(value or "").strip().upper()
    return not text or text in PLACEHOLDERS


_ARABIC = re.compile(r"[\u0600-\u06FF]")


def is_junk_serial(value: Any) -> bool:
    """Free text typed into a serial field ("ممبرین قبلا استفاده شده است", "UA XXXXX"): not a real part number."""
    text = str(value or "").strip()
    if is_placeholder(text) or "XXXXX" in text.upper():
        return True
    if _ARABIC.search(text) or not re.search(r"\d", text):
        return True
    return len(text) > 30


def find_master(db: Session, kind: str, raw: Any):
    """The master row (anode / cathode / membrane) with this number, ignoring case and spaces."""
    model, field = MASTERS[kind]
    key = compact_nr(raw)
    if not key:
        return None
    column = getattr(model, field)
    return db.query(model).filter(func.replace(func.upper(column), " ", "") == key).first()


def link_serial(db: Session, kind: str, raw: Any, extra: dict | None = None, index: dict | None = None) -> Any:
    """Spelling of this number as the master table has it; the master row is created when it is new."""
    if is_placeholder(raw):
        return raw
    model, field = MASTERS[kind]
    key = compact_nr(raw)
    if index is not None and key and key in index:
        return index[key]
    hit = find_master(db, kind, raw)
    if hit is not None:
        if index is not None and key:
            index[key] = getattr(hit, field)
        return getattr(hit, field)
    if is_junk_serial(raw):
        return raw  # kept as typed; never becomes a master row
    ensure_indexed(db, model, field, raw, index, extra=extra)
    if index is not None and key and key in index:
        return index[key]
    return str(raw).strip()[:50]


def serial_hook(kind: str, attr: str) -> Callable[[Session, Any], None]:
    """``after_save`` hook for crud routers: store ``obj.<attr>`` with the master's spelling (creating the master)."""

    def _hook(db: Session, obj: Any) -> None:
        setattr(obj, attr, link_serial(db, kind, getattr(obj, attr, None)))

    return _hook


def multi_hook(*pairs: tuple[str, str]) -> Callable[[Session, Any], None]:
    hooks = [serial_hook(kind, attr) for kind, attr in pairs]

    def _hook(db: Session, obj: Any) -> None:
        for hook in hooks:
            hook(db, obj)

    return _hook


_COATING_ALIAS = {
    "ancan": "ancan",
    "آنکان": "ancan",
    "انکان": "ancan",
    "انكان": "ancan",
}


def _group_token(value: Any) -> str:
    text = str(value or "").strip().lower().replace(" ", "").replace("\u200c", "")
    return _COATING_ALIAS.get(text, text)


def _group_wildcard(value: Any) -> bool:
    """Empty or 'All' on Group Definition means that characteristic is not a filter."""
    text = str(value or "").strip().lower().replace(" ", "").replace("\u200c", "")
    return text in ("", "all", "همه")


def _group_values_match(defined: Any, actual: Any) -> bool:
    """True when the assembly value is the defined coating/membrane/gap (aliases and shorter names included)."""
    d = _group_token(defined)
    a = _group_token(actual)
    if not d:
        return True
    if d == a:
        return True
    extras = [_group_token(part) for part in re.findall(r"\(([^)]+)\)", str(defined or ""))]
    candidates = [d, *extras]
    if d.startswith("original"):
        candidates.append(d.removeprefix("original"))
    for cand in candidates:
        if not cand:
            continue
        if cand == a:
            return True
        if a and cand in a:
            return True
        if a and a in cand and len(a) >= 4:
            return True
    return False


def group_match_score(
    group: models.GroupDefinition,
    *,
    anode_coating: Any = None,
    cathode_coating: Any = None,
    membrane_type: Any = None,
    gap_mm: Any = None,
) -> int | None:
    """How many specified characteristics fit. None = a specified field disagrees. 0 = definition says nothing."""
    score = 0
    for defined, actual in (
        (group.anode_coating, anode_coating),
        (group.cathode_coating, cathode_coating),
        (group.membrane_type, membrane_type),
        (group.gap_mm, gap_mm),
    ):
        if _group_wildcard(defined):
            continue
        score += 1
        if not _group_values_match(defined, actual):
            return None
    return score


def match_defined_group(
    db: Session,
    *,
    anode_coating: Any = None,
    cathode_coating: Any = None,
    membrane_type: Any = None,
    gap_mm: Any = None,
    definitions: list[models.GroupDefinition] | None = None,
) -> str | None:
    """Group number whose defined coating, membrane and gap match this element.

    A definition with no characteristics is ignored, so an empty group is not applied to every element.
    The most specific match wins. Pass ``definitions`` when matching many elements.
    """
    best: tuple[int, str] | None = None
    groups = definitions if definitions is not None else db.query(models.GroupDefinition).all()
    for group in groups:
        score = group_match_score(
            group,
            anode_coating=anode_coating,
            cathode_coating=cathode_coating,
            membrane_type=membrane_type,
            gap_mm=gap_mm,
        )
        if score and (best is None or score > best[0]):
            best = (score, group.group_nr)
    return best[1] if best else None


def sync_element_group(db: Session, el: models.Element, definitions: list[models.GroupDefinition] | None = None) -> str:
    """Point one Assembly Data row at the Group Definition its coatings match.

    A group that still fits is kept. A blank group, a missing group, or a group whose
    specification no longer fits moves to a more specific match. Returns assigned, kept,
    blank, or mismatch (left in place because nothing else fits).
    """
    groups = definitions if definitions is not None else db.query(models.GroupDefinition).all()
    kwargs = {
        "anode_coating": el.anode_coating,
        "cathode_coating": el.cathode_coating,
        "membrane_type": el.membrane_type,
        "gap_mm": el.gap_mm,
    }
    best = match_defined_group(db, definitions=groups, **kwargs)
    by_nr = {g.group_nr: g for g in groups}
    current = str(el.group_nr or "").strip()
    current_group = by_nr.get(current)
    current_score = group_match_score(current_group, **kwargs) if current_group is not None else None
    best_score = group_match_score(by_nr[best], **kwargs) if best and best in by_nr else 0
    if not current:
        if not best:
            return "blank"
        el.group_nr = best
        return "assigned"
    if current_score:
        if best and best != current and best_score > current_score:
            el.group_nr = best
            return "assigned"
        return "kept"
    if best and best != current:
        el.group_nr = best
        return "assigned"
    return "mismatch"


def apply_defined_groups(db: Session) -> int:
    """Realign every Assembly Data row with Group Definition. Returns how many group numbers changed."""
    definitions = db.query(models.GroupDefinition).all()
    changed = 0
    for el in db.query(models.Element).all():
        if sync_element_group(db, el, definitions) == "assigned":
            changed += 1
    return changed


def group_link_report(db: Session) -> dict[str, int]:
    """How Assembly Data sits against Group Definition right now (no writes)."""
    definitions = db.query(models.GroupDefinition).all()
    counts = {"assigned_fit": 0, "blank": 0, "mismatch": 0, "missing_group": 0, "elements": 0}
    by_nr = {g.group_nr: g for g in definitions}
    for el in db.query(models.Element).all():
        counts["elements"] += 1
        kwargs = {
            "anode_coating": el.anode_coating,
            "cathode_coating": el.cathode_coating,
            "membrane_type": el.membrane_type,
            "gap_mm": el.gap_mm,
        }
        current = str(el.group_nr or "").strip()
        if not current:
            counts["blank"] += 1
            continue
        group = by_nr.get(current)
        if group is None:
            counts["missing_group"] += 1
            continue
        if group_match_score(group, **kwargs):
            counts["assigned_fit"] += 1
        else:
            counts["mismatch"] += 1
    return counts


def link_group(db: Session, raw: Any) -> Any:
    """Group number as Group Definition has it (not created here - groups are defined on purpose)."""
    key = compact_nr(raw)
    if not key:
        return raw
    column = models.GroupDefinition.group_nr
    hit = db.query(models.GroupDefinition).filter(func.replace(func.upper(column), " ", "") == key).first()
    return hit.group_nr if hit else raw
