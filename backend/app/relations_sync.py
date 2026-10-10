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


def link_serial(db: Session, kind: str, raw: Any, extra: dict | None = None) -> Any:
    """Spelling of this number as the master table has it; the master row is created when it is new."""
    if is_placeholder(raw):
        return raw
    model, field = MASTERS[kind]
    hit = find_master(db, kind, raw)
    if hit is not None:
        return getattr(hit, field)
    if is_junk_serial(raw):
        return raw  # kept as typed; never becomes a master row
    ensure_indexed(db, model, field, raw, None, extra=extra)
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


def link_group(db: Session, raw: Any) -> Any:
    """Group number as Group Definition has it (not created here - groups are defined on purpose)."""
    key = compact_nr(raw)
    if not key:
        return raw
    column = models.GroupDefinition.group_nr
    hit = db.query(models.GroupDefinition).filter(func.replace(func.upper(column), " ", "") == key).first()
    return hit.group_nr if hit else raw
