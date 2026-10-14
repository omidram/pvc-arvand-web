"""Segregation decision -> position in the element workflow (Element Workflow flowchart).

After an element is disassembled each anode and cathode is inspected and a decision is written in free text
(``decision``, ``warranty``, ``coating_quality``, ``segregation``). The flowchart turns that into one path:

    reusable  -> coating quality good | medium      -> re-assembly under a new element code
    not reusable -> rate off                        -> written off
                 -> coating problem  -> warranty (vendor)  | no warranty -> warehouse
                 -> mechanical problem -> warranty (vendor) | no warranty -> warehouse
    nothing decided yet                             -> undecided
"""
from __future__ import annotations

import re
from typing import Any

OUTCOMES = (
    "reusable",
    "rate_off",
    "coating_problem",
    "mechanical_problem",
    "undecided",
)

# Display names as drawn in the flowchart; aliases are matched in the (normalised) decision / company text.
VENDORS: dict[str, tuple[str, ...]] = {
    "Ancan": ("آنکان", "انکان", "ancan"),
    "Denora": ("دنورا", "denora", "de nora"),
    "Atiyeh Pardazan Sharif": ("آتیه", "atiyeh", "atieh"),
    "Saman Payesh": ("سامان پایش", "saman"),
}

_MECHANICAL = ("مکانیکی", "مکانیک", "mechanical")
_RATE_OFF = ("خارج از رده", "اسقاط", "rate off", "rate-off", "rateoff")
_UNDECIDED = ("بلاتکلیف", "عدم وجود اطلاعات", "نامشخص")
_GOOD = ("خوب", "good", "نو")
_MEDIUM = ("متوسط", "medium")


def norm(value: Any) -> str:
    """Lower case, one Persian spelling of ی/ک, no zero-width joiners, single spaces."""
    text = "" if value is None else str(value)
    text = text.replace("ي", "ی").replace("ك", "ک").replace("\u200c", " ")
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text.replace("غیر گارانتی", "بدون گارانتی").replace("غیرگارانتی", "بدون گارانتی")


def _is_reusable_text(text: str) -> bool:
    # "قابل استفاده" with the common typo "قابل استقاده"
    return bool(re.match(r"قابل است[فق]اده", text))


def _warranty_of(text: str, warranty_field: str, mechanical: bool) -> bool | None:
    """True / False when the text or the warranty column says so; for a mechanical problem the words after it count."""
    if mechanical:
        for key in _MECHANICAL:
            if key in text:
                tail = text.split(key, 1)[1]
                if "بدون گارانتی" in tail:
                    return False
                if "گارانتی" in tail:
                    return True
                break
    both = f"{text} {warranty_field}"
    if "بدون گارانتی" in both or "گارالتی" in warranty_field:
        return False
    if "گارانتی" in both:
        return True
    return None


def _has(text: str, words: tuple[str, ...]) -> bool:
    return any(w in text for w in words)


def vendor_of(*texts: Any) -> str | None:
    for raw in texts:
        text = norm(raw)
        if not text:
            continue
        for name, aliases in VENDORS.items():
            if _has(text, aliases):
                return name
    return None


def _quality(segregation: str, coating_quality: str) -> str | None:
    """good | medium | None for a reusable electrode (the decision text wins over the XRF-style grade)."""
    for text in (segregation, coating_quality):
        if not text:
            continue
        if _has(text, _MEDIUM):
            return "medium"
        if _has(text, _GOOD):
            return "good"
    grade = coating_quality.strip()
    if grade == "a":
        return "good"
    if grade in ("b", "c"):
        return "medium"
    return None


def classify(decision: Any = None, warranty: Any = None, coating_quality: Any = None, segregation: Any = None, company: Any = None) -> dict[str, Any]:
    """The flowchart position of one segregation record."""
    dec, war, cq, seg = norm(decision), norm(warranty), norm(coating_quality), norm(segregation)
    both = f"{dec} {seg}".strip()

    def result(outcome: str, **extra: Any) -> dict[str, Any]:
        info: dict[str, Any] = {"outcome": outcome, "quality": None, "warranty": None, "vendor": None, "destination": None}
        info.update(extra)
        info["steps"] = steps(info)
        return info

    if not both:
        return result("undecided", destination="decision")
    if _has(both, _RATE_OFF):
        return result("rate_off", destination="rate_off")

    reusable_text = _is_reusable_text(dec) or (not dec and _is_reusable_text(seg))
    if reusable_text and not _has(dec, _MECHANICAL):
        return result("reusable", quality=_quality(seg, cq), destination="assembly")

    if _has(dec, _UNDECIDED) and "گارانتی" not in dec and "پوشش" not in seg:
        return result("undecided", destination="decision")

    mechanical = _has(both, _MECHANICAL)
    guaranteed = _warranty_of(both, war, mechanical)
    vendor = vendor_of(dec, seg, company) if guaranteed else None
    destination = "vendor" if guaranteed else "warehouse"

    if mechanical:
        return result("mechanical_problem", warranty=guaranteed, vendor=vendor, destination=destination)
    if guaranteed is not None or _has(both, ("پوشش", "coating", "recoat")):
        return result("coating_problem", warranty=guaranteed, vendor=vendor, destination=destination)
    return result("undecided", destination="decision")


def steps(info: dict[str, Any]) -> list[str]:
    """Node keys the electrode has passed, in order (used to light up the path)."""
    out = ["segregation"]
    outcome = info["outcome"]
    if outcome == "undecided":
        return out
    if outcome == "reusable":
        out += ["reusable"]
        if info.get("quality"):
            out.append(f"quality_{info['quality']}")
        out.append("assembly")
        return out
    out.append("not_reusable")
    if outcome == "rate_off":
        out.append("rate_off")
        return out
    out.append("coating" if outcome == "coating_problem" else "mechanical")
    if info.get("warranty") is True:
        out += ["warranty", "vendor"]
    else:
        out.append("no_warranty")
    out.append("warehouse")
    return out


def classify_row(row: Any) -> dict[str, Any]:
    return classify(
        getattr(row, "decision", None),
        getattr(row, "warranty", None),
        getattr(row, "coating_quality", None),
        getattr(row, "segregation", None),
        getattr(row, "company", None),
    )
