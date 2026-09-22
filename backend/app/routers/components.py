"""Anodes, Cathodes, Membranes + their maintenance / recoating / coating-check sub-records."""
from .. import models, schemas
from ..crud import build_crud_router

anodes_router = build_crud_router(
    model=models.Anode,
    read_schema=schemas.AnodeBase,
    write_schema=schemas.AnodeBase,
    prefix="/anodes",
    tags=["anodes"],
    pk_field="anode_nr",
    search_fields=["anode_nr", "manufacturer", "batch"],
)

anode_maintenance_router = build_crud_router(
    model=models.AnodeMaintenance,
    read_schema=schemas.AnodeMaintenanceRead,
    write_schema=schemas.AnodeMaintenanceBase,
    prefix="/anode-maintenance",
    tags=["anodes"],
    search_fields=["anode_nr"],
)

anode_recoating_router = build_crud_router(
    model=models.AnodeRecoating,
    read_schema=schemas.AnodeRecoatingRead,
    write_schema=schemas.AnodeRecoatingBase,
    prefix="/anode-recoating",
    tags=["anodes"],
    search_fields=["anode_nr"],
)

anode_coating_checks_router = build_crud_router(
    model=models.AnodeCoatingCheck,
    read_schema=schemas.AnodeCoatingCheckRead,
    write_schema=schemas.AnodeCoatingCheckBase,
    prefix="/anode-coating-checks",
    tags=["anodes"],
    search_fields=["anode_nr"],
)

cathodes_router = build_crud_router(
    model=models.Cathode,
    read_schema=schemas.CathodeBase,
    write_schema=schemas.CathodeBase,
    prefix="/cathodes",
    tags=["cathodes"],
    pk_field="cathode_nr",
    search_fields=["cathode_nr", "manufacturer", "batch"],
)

cathode_maintenance_router = build_crud_router(
    model=models.CathodeMaintenance,
    read_schema=schemas.CathodeMaintenanceRead,
    write_schema=schemas.CathodeMaintenanceBase,
    prefix="/cathode-maintenance",
    tags=["cathodes"],
    search_fields=["cathode_nr"],
)

cathode_recoating_router = build_crud_router(
    model=models.CathodeRecoating,
    read_schema=schemas.CathodeRecoatingRead,
    write_schema=schemas.CathodeRecoatingBase,
    prefix="/cathode-recoating",
    tags=["cathodes"],
    search_fields=["cathode_nr"],
)

cathode_coating_checks_router = build_crud_router(
    model=models.CathodeCoatingCheck,
    read_schema=schemas.CathodeCoatingCheckRead,
    write_schema=schemas.CathodeCoatingCheckBase,
    prefix="/cathode-coating-checks",
    tags=["cathodes"],
    search_fields=["cathode_nr"],
)

membranes_router = build_crud_router(
    model=models.Membrane,
    read_schema=schemas.MembraneBase,
    write_schema=schemas.MembraneBase,
    prefix="/membranes",
    tags=["membranes"],
    pk_field="membrane_nr",
    search_fields=["membrane_nr", "membrane_type", "batch"],
)

membrane_maintenance_router = build_crud_router(
    model=models.MembraneMaintenance,
    read_schema=schemas.MembraneMaintenanceRead,
    write_schema=schemas.MembraneMaintenanceBase,
    prefix="/membrane-maintenance",
    tags=["membranes"],
    search_fields=["membrane_nr"],
)
