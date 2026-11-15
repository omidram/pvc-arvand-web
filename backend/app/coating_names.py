"""Coating fields store the company name only.

Phrases such as «آند دنورا (قابل استفاده)», «دنوار» or «ANCAN» are the same
company. The TAFKIK company column is a status note, not a coating, and is
left alone.
"""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from . import models

# Longest alias wins when two names sit in the same phrase.
COMPANIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("آتیه پردازان شریف", ("آتیه پردازان شریف", "آتیه پردازان")),
    ("پرتو صنعت پاژ", ("پرتو صنعت پاژ", "پرتو صنعت باز")),
    ("سامان پایش", ("سامان پایش",)),
    ("پرماسکند", ("پرماسکند", "permascand", "new-permas", "new permas")),
    ("آنکان", ("آنکان", "انکان", "ancan")),
    ("دنورا", ("دنورا", "دنوار", "denora", "de nora")),
    ("رف رف", ("شرکت رف رف", "رف رف")),
)

_JUNK = (
    "آند",
    "کاتد",
    "قابل استفاده",
    "تعمیر",
    "خریداری",
    "xrf",
    "original",
    "اورجین",
    "اوریجین",
    "نسل",
    "مونتاژ",
    "لوز",
    "فلنج",
)

# These columns are a coating company. Segregation.company is not one of them.
COLUMNS: tuple[tuple[type, str], ...] = (
    (models.Element, "anode_coating"),
    (models.Element, "cathode_coating"),
    (models.Anode, "coating"),
    (models.Cathode, "coating"),
    (models.GroupDefinition, "anode_coating"),
    (models.GroupDefinition, "cathode_coating"),
    (models.AnodeRecoating, "manufacturer"),
    (models.CathodeRecoating, "manufacturer"),
)


def fold(value) -> str:
    text = "" if value is None else str(value)
    text = text.replace("ي", "ی").replace("ك", "ک").replace("\u200c", "")
    return re.sub(r"\s+", " ", text).strip()


def company_of(value) -> str | None:
    """The company named in this text, or None when it names no known coater."""
    text = fold(value)
    if not text or text.lower() in {"all", "همه"}:
        return None
    low = text.lower()
    hits: list[tuple[int, int, str]] = []
    for name, aliases in COMPANIES:
        for alias in aliases:
            needle = fold(alias).lower()
            pos = low.find(needle)
            if pos >= 0:
                hits.append((pos, -len(needle), name))
    if hits:
        hits.sort()
        return hits[0][2]
    if "اورجین" in text or "اوریجین" in text or "original" in low:
        return "دنورا"
    return None


def coating_option(value) -> str | None:
    """A name fit for the coating dropdown. Descriptions and status notes are dropped."""
    name = company_of(value)
    if name:
        return name
    text = fold(value)
    if not text or text.lower() in {"all", "همه"}:
        return None
    low = text.lower()
    if any(fold(word).lower() in low for word in _JUNK):
        return None
    if len(text) > 40:
        return None
    return text


def apply(value):
    """Value to store: the company when one is recognized, otherwise the typed text."""
    if value is None:
        return None
    text = fold(value)
    if not text:
        return None
    if text.lower() in {"all", "همه"}:
        return text
    return company_of(text) or text


def normalize_stored(db: Session) -> int:
    """Rewrite saved coating names to the company. Returns how many values changed."""
    changed = 0
    for model, column in COLUMNS:
        col = getattr(model, column)
        raws = [raw for (raw,) in db.query(col).filter(col.isnot(None)).distinct().all()]
        for raw in raws:
            text = fold(raw)
            name = company_of(text)
            if not name or name == text:
                continue
            result = db.query(model).filter(col == raw).update({column: name}, synchronize_session=False)
            changed += int(result or 0)
    return changed
