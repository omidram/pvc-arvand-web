"""Element Inspection (CZ-03) can be stored when the inspection date is filled.

Every other line, the signature and the defect grids stay optional.
"""
from typing import Any

# (attribute, label printed on the form, optional boolean that also counts as filled)
INSPECTION_LINES: tuple[tuple[str, str, str | None], ...] = (
    ("client", "Client", None),
    ("anode_nr", "Anode NO", None),
    ("inspection_date", "Date Of Inspection", None),
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
    ("xrf_anode", "XRF.Anode", "xrf_anode_na"),
    ("xrf_cathode", "XRF.Cathode", "xrf_cathode_na"),
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
    ("leakage_pan_cathode", "Leakage pan cathode", None),
    ("leakage_web_cathode", "Leakage web cathode", None),
    ("leakage_corner_cathode", "Leakage corner cathode", None),
    ("leakage_outlet_cathode", "Leakage outlet cathode", None),
    ("leakage_inlet_cathode", "Leakage inlet cathode", None),
    ("leakage_flange", "Loose Flange anode", None),
    ("leakage_flange_cathode", "Loose Flange cathode", None),
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
    """Only the inspection date is required. The rest of the sheet may be blank."""
    if _filled(_get(data, "inspection_date")):
        return []
    return ["Date Of Inspection"]
