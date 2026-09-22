"""Plant configuration: electrolyzers, sub-plants, transformers, rectifiers, arrangement, settings."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..crud import build_crud_router
from ..database import get_db

electrolyzers_router = build_crud_router(
    model=models.Electrolyzer,
    read_schema=schemas.ElectrolyzerBase,
    write_schema=schemas.ElectrolyzerBase,
    prefix="/electrolyzers",
    tags=["config"],
    pk_field="nr",
)

sub_plants_router = build_crud_router(
    model=models.SubPlant,
    read_schema=schemas.SubPlantBase,
    write_schema=schemas.SubPlantBase,
    prefix="/sub-plants",
    tags=["config"],
    pk_field="nr",
)

full_plants_router = build_crud_router(
    model=models.FullPlant,
    read_schema=schemas.FullPlantBase,
    write_schema=schemas.FullPlantBase,
    prefix="/full-plants",
    tags=["config"],
    pk_field="id",
)

rectifiers_router = build_crud_router(
    model=models.Rectifier,
    read_schema=schemas.RectifierBase,
    write_schema=schemas.RectifierBase,
    prefix="/rectifiers",
    tags=["config"],
    pk_field="nr",
)

transformers_router = build_crud_router(
    model=models.Transformer,
    read_schema=schemas.TransformerBase,
    write_schema=schemas.TransformerBase,
    prefix="/transformers",
    tags=["config"],
    pk_field="nr",
)

arrangements_router = build_crud_router(
    model=models.ElectrolyzerArrangement,
    read_schema=schemas.ElectrolyzerArrangementRead,
    write_schema=schemas.ElectrolyzerArrangementBase,
    prefix="/arrangements",
    tags=["config"],
)

reserve_positions_router = build_crud_router(
    model=models.ReservePosition,
    read_schema=schemas.ReservePositionRead,
    write_schema=schemas.ReservePositionBase,
    prefix="/reserve-positions",
    tags=["config"],
)

correction_factors_router = build_crud_router(
    model=models.CorrectionFactor,
    read_schema=schemas.CorrectionFactorRead,
    write_schema=schemas.CorrectionFactorBase,
    prefix="/correction-factors",
    tags=["settings"],
)

electrode_areas_router = build_crud_router(
    model=models.ElectrodeArea,
    read_schema=schemas.ElectrodeAreaRead,
    write_schema=schemas.ElectrodeAreaBase,
    prefix="/electrode-areas",
    tags=["settings"],
)

voltage_distribution_classes_router = build_crud_router(
    model=models.VoltageDistributionClass,
    read_schema=schemas.VoltageDistributionClassRead,
    write_schema=schemas.VoltageDistributionClassBase,
    prefix="/voltage-distribution-classes",
    tags=["settings"],
)

settings_router = APIRouter(prefix="/settings", tags=["settings"])


@settings_router.get("", response_model=schemas.PlantSettingsRead)
def get_settings(db: Session = Depends(get_db)):
    obj = db.query(models.PlantSettings).first()
    if not obj:
        obj = models.PlantSettings()
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


@settings_router.put("", response_model=schemas.PlantSettingsRead)
def update_settings(payload: schemas.PlantSettingsBase, db: Session = Depends(get_db)):
    obj = db.query(models.PlantSettings).first()
    if not obj:
        obj = models.PlantSettings()
        db.add(obj)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj
