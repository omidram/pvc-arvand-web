"""Chlor-alkali cell room layout.

Two trains, twelve electrolyzers each (letters A–M, no I), two racks per
electrolyzer. Rack ranges follow the Access arrangement blocks: 1–84 and 85–168.
Live voltage tags use names such as A1; the arrangement table stores 1A.
"""
from __future__ import annotations

LETTERS = ("A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M")

RACKS = (
    {"id": "1", "start": 1, "end": 84},
    {"id": "2", "start": 85, "end": 168},
)


def norm_pos(value) -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        return ""
    try:
        return str(int(float(text)))
    except (TypeError, ValueError):
        return text


def electrolyzer_name(train: str, letter: str) -> str:
    return f"{letter.upper()}{train}"


def all_electrolyzers() -> tuple[str, ...]:
    return tuple(electrolyzer_name(train, letter) for train in ("1", "2") for letter in LETTERS)


def train_of(electrolyzer: str) -> str | None:
    name = (electrolyzer or "").strip().upper()
    if len(name) >= 2 and name[-1] in {"1", "2"} and name[0] in LETTERS:
        return name[-1]
    return None


def letter_of(electrolyzer: str) -> str | None:
    name = (electrolyzer or "").strip().upper()
    if name[:1] in LETTERS:
        return name[:1]
    return None


def rack_of(position) -> dict | None:
    try:
        number = int(norm_pos(position))
    except ValueError:
        return None
    for rack in RACKS:
        if rack["start"] <= number <= rack["end"]:
            return rack
    return None


def arrangement_name(electrolyzer: str) -> str | None:
    """Access arrangement key. A1 -> 1A. Does not rewrite stored rows."""
    train = train_of(electrolyzer)
    letter = letter_of(electrolyzer)
    if not train or not letter:
        return None
    return f"{train}{letter}"


def format_electrolyzer_name(name: str | None) -> str:
    """Normalize A1 / 1A / a1 → A1. Leaves non-cell-room names unchanged."""
    raw = (name or "").strip().upper()
    if not raw:
        return ""
    if len(raw) >= 2 and raw[0] in LETTERS and raw[-1] in {"1", "2"}:
        return f"{raw[0]}{raw[-1]}"
    if len(raw) >= 2 and raw[0] in {"1", "2"} and raw[1] in LETTERS:
        return f"{raw[1]}{raw[0]}"
    return raw
