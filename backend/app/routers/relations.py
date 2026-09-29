"""Access relationships for this plant database.

The MDB has no DAO/MSysRelationships (enforced referential integrity is empty).
The working relationships are the form LinkMasterFields/LinkChildFields pairs and
the lookup queries (qryVerwendete*, designation tables, inspection/shutdown lists).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

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
    return sorted(found, key=lambda s: (len(s), s))


@router.get("")
def list_relations():
    return {"source": "PVC_Arvand MDB lookups and subform links", "links": LINKS}


@router.get("/lookups/{name}")
def lookup(name: str, db: Session = Depends(get_db)):
    if name == "anode-numbers":
        values = _values(
            db.query(models.Element.anode_nr).distinct().all(),
            db.query(models.Anode.anode_nr).distinct().all(),
        )
    elif name == "cathode-numbers":
        values = _values(
            db.query(models.Element.cathode_nr).distinct().all(),
            db.query(models.Cathode.cathode_nr).distinct().all(),
        )
    elif name == "membrane-numbers":
        values = _values(
            db.query(models.Element.membrane_nr).distinct().all(),
            db.query(models.Membrane.membrane_nr).distinct().all(),
        )
    elif name == "membrane-types":
        values = _values(
            db.query(models.Element.membrane_type).distinct().all(),
            db.query(models.Membrane.membrane_type).distinct().all(),
        )
    elif name == "groups":
        values = _values(
            db.query(models.GroupDefinition.group_nr).distinct().all(),
            db.query(models.Element.group_nr).distinct().all(),
        )
    elif name == "element-numbers":
        values = _values(db.query(models.Element.element_nr).distinct().all())
    elif name == "electrolyzers":
        rows = db.query(models.Electrolyzer.name).order_by(models.Electrolyzer.nr).all()
        values = _values(rows, db.query(models.Element.electrolyzer).distinct().all())
    elif name == "sub-plants":
        values = _values(db.query(models.SubPlant.name).distinct().all())
    elif name == "inspection-reasons":
        values = _values(
            db.query(models.InspectionReason.reason).distinct().all(),
            db.query(models.InspectionReport.inspection_reason).distinct().all(),
        )
    elif name == "shutdown-causes":
        values = _values(db.query(models.ShutdownCause.cause).distinct().all())
    elif name == "shutdown-categories":
        values = _values(db.query(models.ShutdownCategory.category).distinct().all())
    else:
        raise HTTPException(status_code=404, detail=f"Unknown lookup '{name}'")
    return {"name": name, "values": values}
