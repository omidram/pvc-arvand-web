"""Element Inspection (CZ-03) may be stored only when it is filled through the signature.

Defect grids and free remarks stay optional: an empty grid cell is "no mark", and
Remarks / Deposits may be blank. A yes/no line counts as filled when its note has
text or its OK flag is set. Keep the same list in frontend inspection-sheet.tsx.
"""
from typing import Any

# (attribute, label printed on the form, optional boolean that also counts as filled)
INSPECTION_LINES: tuple[tuple[str, str, str | None], ...] = (
    ("client", "Client", None),
    ("anode_nr", "Anode NO", None),
    ("inspection_date", "Date", None),
    ("electrolyzer", "electrolyzer No", None),
    ("cathode_nr", "Cathode No", None),
    ("operation_days", "Operation days", None),
    ("position", "Position", None),
    ("membrane_nr", "membrane No", None),
    ("electrode_nr_anode", "Electrode No (Anode)", None),
    ("element_nr", "Element no", None),
    ("membrane_type", "membrane Type", None),
    ("electrode_nr_cathode", "Electrode No (Cathode)", None),
    ("inspection_reason", "Reason for inspection", None),
    ("blister_anode_area", "Blister anode surface %", None),
    ("blister_periphery_top", "Blister periphery % (1)", None),
    ("blister_periphery_bottom", "Blister periphery % (2)", None),
    ("blister_periphery_side", "Blister periphery % (3)", None),
    ("blister_corners", "Blister corner %", None),
    ("folds", "Wrinkle (w)", None),
    ("pressure_marks", "Pressure marks (pm)", None),
    ("visible_holes", "Visible holes (vh)", None),
    ("cracks", "Tears (T)", None),
    ("xrf_anode", "XRF.Anode", None),
    ("xrf_cathode", "XRF.Cathode", None),
    ("deformation_pan", "Deformation pan (DP)", None),
    ("deformation_electrode", "Deformation electrode (DP)", None),
    ("coloured_area", "coloured area (CA)", None),
    ("coloured_electrode", "coloured electrode (CE)", None),
    ("coloured_pan", "coloured pan (CP)", None),
    ("leakage_pan", "Leakage pan (LP)", None),
    ("leakage_web", "Leakage Web area (Lw)", None),
    ("leakage_corner", "Leakage corner area (LC)", None),
    ("leakage_outlet", "Leakage outlet nozzle (LO)", None),
    ("leakage_inlet", "Leakage inlet nozzle (LI)", None),
    ("sample_cathode_note", "sample cathode", "sample_cathode"),
    ("anode_tube_remark", "insert pipe (Anode)", "anode_tube_ok"),
    ("sample_anode_note", "sample anode", "sample_anode"),
    ("cathode_tube_remark", "insert pipe (cathode)", "cathode_tube_ok"),
    ("anode_spacer_remark", "spacer strip (Anode)", "anode_spacer_ok"),
    ("sample_membrane_note", "sample membrane", "sample_membrane"),
    ("cathode_spacer_remark", "spacer strip (cathode)", "cathode_spacer_ok"),
    ("frame_gasket_remark", "Frame gasket", "frame_gasket_ok"),
)


def _get(data: Any, name: str) -> Any:
    if isinstance(data, dict):
        return data.get(name)
    return getattr(data, name, None)


def _filled(value: Any) -> bool:
    if value is None or value is False:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def missing_inspection_labels(data: Any) -> list[str]:
    missing: list[str] = []
    for key, label, flag in INSPECTION_LINES:
        if _filled(_get(data, key)) or (flag and _get(data, flag) is True):
            continue
        missing.append(label)
    name_ok = _filled(_get(data, "inspector_name")) or _filled(_get(data, "sign_insp_name")) or _filled(_get(data, "signature"))
    if not name_ok:
        missing.append("Name")
    if not _filled(_get(data, "sign_insp_image")):
        missing.append("Signature (Insp.)")
    return missing
