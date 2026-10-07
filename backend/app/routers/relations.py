"""Access relationships for this plant database.

The MDB has no DAO/MSysRelationships (enforced referential integrity is empty).
The working relationships are the form LinkMasterFields/LinkChildFields pairs and
the lookup queries (qryVerwendete*, designation tables, inspection/shutdown lists).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..inspection_reason_names import industrial_reason

router = APIRouter(prefix="/relations", tags=["relations"])

# parent field -> child field, taken from Access subform LinkMasterFields / LinkChildFields
# and from the JOIN queries that tie plant tables together.
LINKS = [
    {"name": "element-inspections", "parent": "elements.element_nr", "child": "inspection_reports.element_nr", "access": "subfrmListeInspektionsgruende"},
    {"name": "element-anode-half", "parent": "elements.element_nr", "child": "inspection_halfshell_grids.element_nr", "access": "subfrmInspektionsberichtAnodenhalbschale"},
    {"name": "element-cathode-half", "parent": "elements.element_nr", "child": "inspection_halfshell_grids.element_nr", "access": "subfrmInspektionsberichtKathodenhalbschale"},
    {"name": "element-membrane-as", "parent": "elements.element_nr", "child": "inspection_halfshell_grids.element_nr", "access": "subfrmInspektionsberichtMembranAS"},
    {"name": "element-membrane-ks", "parent": "elements.element_nr", "child": "inspection_halfshell_grids.element_nr", "access": "subfrmInspektionsberichtMembranKS"},
    {"name": "element-membrane-lt", "parent": "elements.element_nr", "child": "inspection_halfshell_grids.element_nr", "access": "subfrmInspektionsberichtMembranLT"},
    {"name": "anode-maintenance", "parent": "anodes.anode_nr", "child": "anode_maintenance.anode_nr", "access": "tblAnodeninstandhaltung"},
    {"name": "anode-recoating", "parent": "anodes.anode_nr", "child": "anode_recoating.anode_nr", "access": "subfrmSuchergebnisAnodenrecoatingDetails"},
    {"name": "anode-coating-check", "parent": "anodes.anode_nr", "child": "anode_coating_checks.anode_nr", "access": "tblAnodencoatingpruefung"},
    {"name": "cathode-maintenance", "parent": "cathodes.cathode_nr", "child": "cathode_maintenance.cathode_nr", "access": "tblKathodeninstandhaltung"},
    {"name": "cathode-recoating", "parent": "cathodes.cathode_nr", "child": "cathode_recoating.cathode_nr", "access": "subfrmSuchergebnisKathodenrecoatingDetails"},
    {"name": "cathode-coating-check", "parent": "cathodes.cathode_nr", "child": "cathode_coating_checks.cathode_nr", "access": "tblKathodencoatingpruefung"},
    {"name": "membrane-maintenance", "parent": "membranes.membrane_nr", "child": "membrane_maintenance.membrane_nr", "access": "subfrmSuchergebnisRemembraningDetails"},
    {"name": "element-group", "parent": "group_definitions.group_nr", "child": "elements.group_nr", "access": "Gruppenmerkmale"},
    {"name": "element-electrolyzer", "parent": "electrolyzers.name", "child": "elements.electrolyzer", "access": "tblElektrolyseurbezeichnung"},
    {"name": "shutdown-cause", "parent": "shutdown_causes.cause", "child": "shutdowns.cause", "access": "qryAbschaltungsursachen"},
    {"name": "shutdown-category", "parent": "shutdown_categories.category", "child": "shutdowns.category", "access": "tblAbschaltungskategorien"},
    {"name": "voltage-position", "parent": "elements.electrolyzer+position", "child": "voltage_readings.electrolyzer+position", "access": "Montage INNER JOIN Spannungen"},
    {"name": "normalization-voltage", "parent": "normalizations.id", "child": "voltage_readings.normalization_id", "access": "subfrmSpannung LinkMasterFields=Normierung"},
    {"name": "anode-segregation", "parent": "anodes.anode_nr", "child": "electrode_segregations.serial_nr", "access": "TAFKIK"},
    {"name": "cathode-segregation", "parent": "cathodes.cathode_nr", "child": "electrode_segregations.serial_nr", "access": "TAFKIK"},
    {"name": "element-anode-segregation", "parent": "elements.anode_nr", "child": "electrode_segregations.serial_nr", "access": "Assembly Data / TAFKIK"},
    {"name": "element-cathode-segregation", "parent": "elements.cathode_nr", "child": "electrode_segregations.serial_nr", "access": "Assembly Data / TAFKIK"},
]


def _values(*columns) -> list[str]:
    found: set[str] = set()
    for rows in columns:
        for (value,) in rows:
            if value is None:
                continue
            text = str(value).strip()
            if text:
                found.add(text)
    return sorted(found, key=lambda s: (s.upper(), s))


def _compact_upper(value: str) -> str:
    return "".join(str(value).split()).upper()


def _electrode_lookup_values(rows, *, prefix: str) -> list[str]:
    """Catalogue serials for anode/cathode combos (UA… / UC… first; drop short numeric junk)."""
    found: set[str] = set()
    pref = prefix.upper()
    for (value,) in rows:
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        compact = _compact_upper(text)
        # Element-style short numbers pollute combos (e.g. 8913) — skip them.
        if compact.isdigit() and len(compact) <= 5:
            continue
        # Drop corrupted placeholders like "UC -2///" / "UC 1////".
        if "/" in compact or compact.endswith("-"):
            continue
        if compact.startswith(pref):
            digits = "".join(ch for ch in compact[len(pref) :] if ch.isdigit())
            if len(digits) < 3:
                continue
        found.add(text)

    def sort_key(serial: str) -> tuple:
        compact = _compact_upper(serial)
        if compact.startswith(pref):
            return (0, compact)
        if compact.startswith(("A", "C", "DA", "DC", "LA", "PA", "HA")):
            return (1, compact)
        return (2, compact)

    return sorted(found, key=sort_key)


@router.get("")
def list_relations():
    return {"source": "PVC_Arvand MDB lookups and subform links", "links": LINKS}


@router.get("/lookups/{name}")
def lookup(name: str, db: Session = Depends(get_db)):
    # Prefer master tables so combos stay linked to real plant catalogues.
    if name == "anode-numbers":
        values = _electrode_lookup_values(db.query(models.Anode.anode_nr).distinct().all(), prefix="UA")
        if not values:
            values = _electrode_lookup_values(db.query(models.Element.anode_nr).distinct().all(), prefix="UA")
    elif name == "cathode-numbers":
        values = _electrode_lookup_values(db.query(models.Cathode.cathode_nr).distinct().all(), prefix="UC")
        if not values:
            values = _electrode_lookup_values(db.query(models.Element.cathode_nr).distinct().all(), prefix="UC")
    elif name == "membrane-numbers":
        values = _values(db.query(models.Membrane.membrane_nr).distinct().all())
        if not values:
            values = _values(db.query(models.Element.membrane_nr).distinct().all())
    elif name == "membrane-types":
        values = _values(db.query(models.Membrane.membrane_type).distinct().all())
        if not values:
            values = _values(db.query(models.Element.membrane_type).distinct().all())
    elif name == "groups":
        values = _values(db.query(models.GroupDefinition.group_nr).distinct().all())
        if not values:
            values = _values(db.query(models.Element.group_nr).distinct().all())
    elif name == "element-numbers":
        values = _values(db.query(models.Element.element_nr).distinct().all())
    elif name == "electrolyzers":
        from ..plant_topology import all_electrolyzers, format_electrolyzer_name, is_valid_electrolyzer_name

        found: set[str] = set()
        for source in (
            db.query(models.Electrolyzer.name).all(),
            db.query(models.Element.electrolyzer).distinct().all(),
        ):
            for (raw,) in source:
                if not is_valid_electrolyzer_name(raw):
                    continue
                name_el = format_electrolyzer_name(raw)
                if name_el:
                    found.add(name_el)
        for raw in all_electrolyzers():
            found.add(raw)
        values = sorted(found, key=lambda s: (s[0], s[1:] if len(s) > 1 else ""))
    elif name == "sub-plants":
        values = _values(db.query(models.SubPlant.name).distinct().all())
    elif name == "plant-parts":
        # Access Leistungstests combo: Teilanlagen UNION Gesamtanlagen (by language)
        values = _values(db.query(models.SubPlant.name).distinct().all())
        settings_row = db.query(models.PlantSettings).first()
        lang = ((settings_row.language if settings_row else None) or "EN").upper()
        lang_id = 1 if lang == "DE" else 2
        full = _values(
            db.query(models.FullPlant.name)
            .filter(
                (models.FullPlant.language_id == lang_id) | (models.FullPlant.language_id.is_(None))
            )
            .distinct()
            .all()
        )
        if not full:
            full = _values(db.query(models.FullPlant.name).distinct().all())
        seen = set(values)
        for item in full:
            if item not in seen:
                values.append(item)
                seen.add(item)
    elif name == "inspection-reasons":
        raw = _values(
            db.query(models.InspectionReason.reason).distinct().all(),
            db.query(models.InspectionReport.inspection_reason).distinct().all(),
        )
        values: list[str] = []
        seen: set[str] = set()
        for text in raw:
            translated = industrial_reason(text) or text
            if translated not in seen:
                seen.add(translated)
                values.append(translated)
    elif name == "shutdown-causes":
        values = _values(db.query(models.ShutdownCause.cause).distinct().all())
    elif name == "shutdown-categories":
        values = _values(db.query(models.ShutdownCategory.category).distinct().all())
    elif name == "decommission-reasons":
        values = _values(db.query(models.Element.decommission_reason).distinct().all())
    elif name == "generations":
        fixed = ["3", "4", "5", "5+", "6", "6+", "Blue Star"]
        extras = _values(
            db.query(models.Element.generation).distinct().all(),
            db.query(models.Anode.generation).distinct().all(),
            db.query(models.Cathode.generation).distinct().all(),
        )
        fixed_l = {v.lower() for v in fixed}
        values = fixed + [v for v in extras if v.lower() not in fixed_l]
    else:
        raise HTTPException(status_code=404, detail=f"Unknown lookup '{name}'")
    return {"name": name, "values": values}
