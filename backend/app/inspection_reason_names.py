"""Industrial English labels for Uhde inspection reasons (tblInspektionsgruende).

Access stored a German catalog (IDSprache=1) plus an English catalog (IDSprache=2).
German leftovers and German-only codes are mapped to the plant English wording.
Custom free-text reasons are left unchanged.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from . import models

# Normalized German / aliases → industrial English (Uhde BM / Access EN catalog).
_REASON_TO_EN: dict[str, str] = {
    "deformation wanne": "Deformation Pan",
    "deformation pan": "Deformation Pan",
    "deformation elektrode": "Deformation Electrode",
    "deformation electrode": "Deformation Electrode",
    "verfaerbungen": "Colored Area",
    "colored area": "Colored Area",
    "korrosion wanne": "Corrosion Pan",
    "corrosion pan": "Corrosion Pan",
    "korrosion elektrode": "Corrosion Electrode",
    "corrosion electrode": "Corrosion Electrode",
    "ablagerungen": "Deposits",
    "deposits": "Deposits",
    "leckage rueckwand": "Leakage Pan",
    "leakage pan": "Leakage Pan",
    "leckager lasernaht": "Leakage Web Area",
    "leckage lasernaht": "Leakage Web Area",
    "leakage web area": "Leakage Web Area",
    "leckage ecknaht": "Leakage Corner Area",
    "leakage corner area": "Leakage Corner Area",
    "leckage auslaufrohr flansch": "Leakage Outlet Nozzle/Flange",
    "leakage outlet nozzle flange": "Leakage Outlet Nozzle/Flange",
    "leckage zulaufrohr": "Leakage Inlet Nozzle",
    "leakage inlet nozzle": "Leakage Inlet Nozzle",
    "spannung hoch": "Voltage High",
    "voltage high": "Voltage High",
    "spannung tief": "Voltage Low",
    "voltage low": "Voltage Low",
    "membrantest 1": "Membrane Test 1",
    "membrane test 1": "Membrane Test 1",
    "membrantest 2": "Membrane Test 2",
    "membrane test 2": "Membrane Test 2",
    "remembraning": "Remembraning",
    "recoating kathode": "Recoating Cathode",
    "recoating cathode": "Recoating Cathode",
    "recoating anode": "Recoating Anode",
    "hoher wasserstoffgehalt": "High Hydrogen Concentration",
    "high hydrogen concentration": "High Hydrogen Concentration",
    "anode": "Anode",
    "kathode": "Cathode",
    "cathode": "Cathode",
    "leckage verschraubung": "Leakage Bolt",
    "leakage bolt": "Leakage Bolt",
    "leckage dichtung": "Leakage Gasket",
    "leakage gasket": "Leakage Gasket",
    "routineuntersuchung": "Routine Inspection",
    "routine inspection": "Routine Inspection",
    "leckage auslaufschlauch": "Leakage Outlet Hose",
    "leakage outlet hose": "Leakage Outlet Hose",
    "leckage zulaufschlauch": "Inlet Hose Leak",
    "inlet hose leak": "Inlet Hose Leak",
    "leakage inlet hose": "Inlet Hose Leak",
    "schutzelektrode geschweisst": "Protection Electrode Welded",
    "protection electrode welded": "Protection Electrode Welded",
    "schutzelektrode geschraubt": "Protection Electrode Non-Welded",
    "protection electrode non welded": "Protection Electrode Non-Welded",
    "leckage schweissnaht": "Leakage at Welding",
    "leakage at welding": "Leakage at Welding",
    "membran": "Membrane",
    "membrane": "Membrane",
    "standrohr": "Standpipe",
    "standpipe": "Standpipe",
    "elementverschraubung": "Element bolting",
    "element bolting": "Element bolting",
    "schweissfehler": "Weld defect",
    "weld defect": "Weld defect",
    "elektrolytschlauch": "Electrolyte hose",
    "electrolyte hose": "Electrolyte hose",
    "zulaufschlauch": "Inlet hose",
    "inlet hose": "Inlet hose",
}


def _norm(value: str | None) -> str:
    if not value:
        return ""
    text = value.strip().lower()
    for src, dst in (
        ("ä", "ae"),
        ("ö", "oe"),
        ("ü", "ue"),
        ("ß", "ss"),
        ("/", " "),
        ("-", " "),
        ("_", " "),
    ):
        text = text.replace(src, dst)
    return " ".join(text.split())


def industrial_reason(reason: str | None) -> str | None:
    """Translate a known German (or alias) inspection reason to industrial English."""
    key = _norm(reason)
    if key in _REASON_TO_EN:
        return _REASON_TO_EN[key]
    return reason


def persist_industrial_reasons(db: Session) -> int:
    """Rewrite stored German catalog reasons to industrial English. Returns rows changed."""
    changed = 0
    try:
        rows = db.query(models.InspectionReason).all()
    except Exception:
        return 0
    for row in rows:
        next_reason = industrial_reason(row.reason)
        if next_reason and next_reason != row.reason:
            row.reason = next_reason
            changed += 1
    if changed:
        db.commit()
    return changed
