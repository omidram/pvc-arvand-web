"""Anodes, Cathodes, Membranes + their maintenance / recoating / coating-check sub-records."""
from sqlalchemy.orm import Session

from .. import models, schemas
from ..crud import build_crud_router
from ..relations_sync import serial_hook


def _rename_serial(kind: str):
    """Keep elements and history on the same part when its serial number is edited."""

    def _apply(db: Session, old: str, new: str) -> None:
        pairs: list[tuple[type, str]] = []
        if kind == "anode":
            pairs = [
                (models.Element, "anode_nr"),
                (models.InspectionReport, "anode_nr"),
                (models.AssemblyInspectionReport, "anode_nr"),
                (models.AnodeMaintenance, "anode_nr"),
                (models.AnodeRecoating, "anode_nr"),
                (models.AnodeCoatingCheck, "anode_nr"),
            ]
        elif kind == "cathode":
            pairs = [
                (models.Element, "cathode_nr"),
                (models.InspectionReport, "cathode_nr"),
                (models.AssemblyInspectionReport, "cathode_nr"),
                (models.CathodeMaintenance, "cathode_nr"),
                (models.CathodeRecoating, "cathode_nr"),
                (models.CathodeCoatingCheck, "cathode_nr"),
            ]
        elif kind == "membrane":
            pairs = [
                (models.Element, "membrane_nr"),
                (models.InspectionReport, "membrane_nr"),
                (models.AssemblyInspectionReport, "membrane_nr"),
                (models.MembraneMaintenance, "membrane_nr"),
            ]
        for model, field in pairs:
            column = getattr(model, field)
            db.query(model).filter(column == old).update({column: new}, synchronize_session=False)
        if kind in ("anode", "cathode"):
            db.query(models.ElectrodeSegregation).filter(
                models.ElectrodeSegregation.electrode_kind == kind,
                models.ElectrodeSegregation.serial_nr == old,
            ).update({models.ElectrodeSegregation.serial_nr: new}, synchronize_session=False)
            from ..workflow_models import WfCoatingItem

            db.query(WfCoatingItem).filter(
                WfCoatingItem.element_kind == kind,
                WfCoatingItem.serial == old,
            ).update({WfCoatingItem.serial: new}, synchronize_session=False)
        db.query(models.MaintenanceReport).filter(
            models.MaintenanceReport.kind == kind,
            models.MaintenanceReport.component_nr == old,
        ).update({models.MaintenanceReport.component_nr: new}, synchronize_session=False)

    return _apply

# Key data a new anode / cathode must carry (the same lists drive the red * marks in the web forms).
ANODE_REQUIRED = ["anode_nr", "manufacturer", "coating", "received_date"]
CATHODE_REQUIRED = ["cathode_nr", "manufacturer", "coating", "received_date"]

anodes_router = build_crud_router(
    model=models.Anode,
    read_schema=schemas.AnodeBase,
    write_schema=schemas.AnodeBase,
    prefix="/anodes",
    tags=["anodes"],
    pk_field="anode_nr",
    search_fields=["anode_nr", "manufacturer", "batch"],
    required_fields=ANODE_REQUIRED,
    unique_compact=True,
    on_rename=_rename_serial("anode"),
)

anode_maintenance_router = build_crud_router(
    model=models.AnodeMaintenance,
    read_schema=schemas.AnodeMaintenanceRead,
    write_schema=schemas.AnodeMaintenanceBase,
    prefix="/anode-maintenance",
    tags=["anodes"],
    search_fields=["anode_nr"],
    after_save=serial_hook("anode", "anode_nr"),
)

anode_recoating_router = build_crud_router(
    model=models.AnodeRecoating,
    read_schema=schemas.AnodeRecoatingRead,
    write_schema=schemas.AnodeRecoatingBase,
    prefix="/anode-recoating",
    tags=["anodes"],
    search_fields=["anode_nr"],
    after_save=serial_hook("anode", "anode_nr"),
)

anode_coating_checks_router = build_crud_router(
    model=models.AnodeCoatingCheck,
    read_schema=schemas.AnodeCoatingCheckRead,
    write_schema=schemas.AnodeCoatingCheckBase,
    prefix="/anode-coating-checks",
    tags=["anodes"],
    search_fields=["anode_nr"],
    after_save=serial_hook("anode", "anode_nr"),
)

cathodes_router = build_crud_router(
    model=models.Cathode,
    read_schema=schemas.CathodeBase,
    write_schema=schemas.CathodeBase,
    prefix="/cathodes",
    tags=["cathodes"],
    pk_field="cathode_nr",
    search_fields=["cathode_nr", "manufacturer", "batch"],
    required_fields=CATHODE_REQUIRED,
    unique_compact=True,
    on_rename=_rename_serial("cathode"),
)

cathode_maintenance_router = build_crud_router(
    model=models.CathodeMaintenance,
    read_schema=schemas.CathodeMaintenanceRead,
    write_schema=schemas.CathodeMaintenanceBase,
    prefix="/cathode-maintenance",
    tags=["cathodes"],
    search_fields=["cathode_nr"],
    after_save=serial_hook("cathode", "cathode_nr"),
)

cathode_recoating_router = build_crud_router(
    model=models.CathodeRecoating,
    read_schema=schemas.CathodeRecoatingRead,
    write_schema=schemas.CathodeRecoatingBase,
    prefix="/cathode-recoating",
    tags=["cathodes"],
    search_fields=["cathode_nr"],
    after_save=serial_hook("cathode", "cathode_nr"),
)

cathode_coating_checks_router = build_crud_router(
    model=models.CathodeCoatingCheck,
    read_schema=schemas.CathodeCoatingCheckRead,
    write_schema=schemas.CathodeCoatingCheckBase,
    prefix="/cathode-coating-checks",
    tags=["cathodes"],
    search_fields=["cathode_nr"],
    after_save=serial_hook("cathode", "cathode_nr"),
)

membranes_router = build_crud_router(
    model=models.Membrane,
    read_schema=schemas.MembraneBase,
    write_schema=schemas.MembraneBase,
    prefix="/membranes",
    tags=["membranes"],
    pk_field="membrane_nr",
    search_fields=["membrane_nr", "membrane_type", "batch"],
    unique_compact=True,
    on_rename=_rename_serial("membrane"),
)

membrane_maintenance_router = build_crud_router(
    model=models.MembraneMaintenance,
    read_schema=schemas.MembraneMaintenanceRead,
    write_schema=schemas.MembraneMaintenanceBase,
    prefix="/membrane-maintenance",
    tags=["membranes"],
    search_fields=["membrane_nr"],
    after_save=serial_hook("membrane", "membrane_nr"),
)
