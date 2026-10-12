"""Standardized voltage (Un) / current efficiency (CE) / SPC boards.

Thin HTTP layer over :mod:`app.un_ce_engine`, which reproduces the Access queries.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models, un_ce_engine as eng
from ..database import get_db
from ..plant_topology import all_electrolyzers

router = APIRouter(prefix="/un-ce", tags=["un-ce"])


def _csv(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def _el_set(value: str | None) -> set[str] | None:
    items = {eng.ekey(v) for v in _csv(value)}
    items.discard("")
    return items or None


def _group_set(value: str | None) -> set[str] | None:
    items = {eng.gkey(v) for v in _csv(value)}
    items.discard("")
    return items or None


def _train_set(value: str | None) -> set[str] | None:
    items = set(_csv(value))
    return items or None


def _elements_set(value: str | None) -> set[tuple[str, str]] | None:
    out: set[tuple[str, str]] = set()
    for part in _csv(value):
        if ":" not in part:
            continue
        el, pos = part.split(":", 1)
        key = (eng.ekey(el), eng.pkey(pos))
        if key[0] and key[1]:
            out.add(key)
    return out or None


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class UnCeSettingsIn(BaseModel):
    iref: float = Field(gt=0)
    area_m2: float = Field(gt=0)
    umin: float = Field(ge=0)
    anodic_correction: float = 0.0
    clo_analysis: int = Field(ge=1, le=2)
    temp_correction_element: int = Field(ge=1, le=2)
    acidified: bool


def _settings_payload(db: Session) -> dict:
    cfg = eng.load_cfg(db)
    factors = [
        {"iref": f.reference_current_density, "tkorr": f.temp_correction, "ckorr": f.conc_correction}
        for f in db.query(models.CorrectionFactor).order_by(models.CorrectionFactor.reference_current_density).all()
        if f.reference_current_density is not None
    ]
    areas = [a.area_m2 for a in db.query(models.ElectrodeArea).order_by(models.ElectrodeArea.area_m2).all() if a.area_m2]
    return {**cfg.as_dict(), "iref_options": factors, "area_options": areas}


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return _settings_payload(db)


@router.put("/settings")
def put_settings(body: UnCeSettingsIn, db: Session = Depends(get_db)):
    row = db.query(models.UnCeSettings).first()
    if row is None:
        row = models.UnCeSettings()
        db.add(row)
    row.iref = body.iref
    row.area_m2 = body.area_m2
    row.umin = body.umin
    row.anodic_correction = body.anodic_correction
    row.clo_analysis = body.clo_analysis
    row.temp_correction_element = body.temp_correction_element
    plant = db.query(models.PlantSettings).first()
    if plant is not None:
        plant.acidified = body.acidified
    db.commit()
    return _settings_payload(db)


@router.get("/options")
def get_options(db: Session = Depends(get_db)):
    names: set[str] = set(all_electrolyzers())
    for (name,) in db.query(models.ElectrolyzerNormalization.electrolyzer).distinct().all():
        key = eng.ekey(name)
        if key:
            names.add(key)
    groups: set[str] = set()
    for g in db.query(models.GroupDefinition).all():
        key = eng.gkey(g.group_nr)
        if key:
            groups.add(key)
    for (g,) in db.query(models.Element.group_nr).distinct().all():
        key = eng.gkey(g)
        if key and key != "0":
            groups.add(key)
    trains = sorted({t for t in (eng.train_of_key(n, eng.train_map(db)) for n in names) if t})
    return {
        "electrolyzers": sorted(names),
        "groups": sorted(groups, key=lambda x: (0, int(x)) if x.isdigit() else (1, x)),
        "trains": trains,
    }


# ---------------------------------------------------------------------------
# Un
# ---------------------------------------------------------------------------


@router.get("/un")
def standardized_voltage_board(
    scope: str = Query(..., pattern="^(plant|train|electrolyzer|group|element)$"),
    table: str = Query("1", pattern="^[12]$"),
    calc: str = Query("all", pattern="^(individual|several|all)$"),
    date_from: str | None = None,
    date_till: str | None = None,
    electrolyzers: str | None = None,
    trains: str | None = None,
    groups: str | None = None,
    elements: str | None = None,
    limit: int = Query(5000, ge=1, le=50000),
    db: Session = Depends(get_db),
):
    """Un exactly as the Access "Standardized Voltage" forms.

    ``table`` 1 = "Electrolyzers" (NormElek / Gesamt Normierung), 2 = "All elements per
    electrolyzer" (Normierung + element readings, or the manually entered group/element data).
    """
    cfg = eng.load_cfg(db)
    d0, d1 = eng.parse_day(date_from), eng.parse_day(date_till)
    pick = calc != "all"
    if scope == "plant":
        result = eng.un_plant_rows(db, cfg, table=table, d0=d0, d1=d1)
    elif scope == "train":
        wanted = _train_set(trains) if pick else None
        if pick and not wanted:
            raise HTTPException(status_code=422, detail="Select a train")
        result = eng.un_train_rows(db, cfg, table=table, d0=d0, d1=d1, trains=wanted)
    elif scope == "electrolyzer":
        wanted = _el_set(electrolyzers) if pick else None
        if pick and not wanted:
            raise HTTPException(status_code=422, detail="Select an electrolyzer")
        result = eng.un_electrolyzer_rows(db, cfg, table=table, d0=d0, d1=d1, els=wanted)
    elif scope == "group":
        wanted_groups = _group_set(groups) if pick else None
        if pick and not wanted_groups:
            raise HTTPException(status_code=422, detail="Select a group")
        result = eng.un_group_rows(db, cfg, table=table, calc=calc, d0=d0, d1=d1, groups=wanted_groups)
    else:
        wanted_elements = _elements_set(elements) if pick else None
        if pick and not wanted_elements:
            raise HTTPException(status_code=422, detail="Select an element")
        result = eng.un_element_rows(db, cfg, table=table, d0=d0, d1=d1, elements=wanted_elements, limit=limit)
    return result.to_dict(cfg)


# ---------------------------------------------------------------------------
# CE
# ---------------------------------------------------------------------------


@router.get("/ce")
def current_efficiency_board(
    scope: str = Query(..., pattern="^(plant|train|electrolyzer|group|element)$"),
    basis: str = Query("anodic", pattern="^(anodic|naoh)$"),
    calc: str = Query("all", pattern="^(individual|several|all)$"),
    date_from: str | None = None,
    date_till: str | None = None,
    electrolyzers: str | None = None,
    trains: str | None = None,
    groups: str | None = None,
    elements: str | None = None,
    db: Session = Depends(get_db),
):
    """CE [%] (= µNaOH) either from the anodic balance (computed) or from the NaOH balance
    (entered), per Total plant / Train / Electrolyzer / Group / Element."""
    cfg = eng.load_cfg(db)
    d0, d1 = eng.parse_day(date_from), eng.parse_day(date_till)
    pick = calc != "all"
    wanted_els = _el_set(electrolyzers) if pick and scope == "electrolyzer" else None
    wanted_trains = _train_set(trains) if pick and scope == "train" else None
    wanted_groups = _group_set(groups) if pick and scope == "group" else None
    wanted_elements = _elements_set(elements) if pick and scope == "element" else None
    if pick and scope != "plant" and not (wanted_els or wanted_trains or wanted_groups or wanted_elements):
        raise HTTPException(status_code=422, detail="Select what to calculate for")

    if basis == "naoh":
        refs = wanted_els or wanted_trains or wanted_groups
        result = eng.ce_naoh_rows(db, cfg, scope=scope, d0=d0, d1=d1, refs=refs, elements=wanted_elements)
    elif scope == "plant":
        result = eng.ce_plant_rows(db, cfg, d0=d0, d1=d1)
    elif scope == "train":
        result = eng.ce_train_rows(db, cfg, d0=d0, d1=d1, trains=wanted_trains)
    elif scope == "electrolyzer":
        result = eng.ce_electrolyzer_rows(db, cfg, d0=d0, d1=d1, els=wanted_els)
    elif scope == "group":
        result = eng.ce_group_rows(db, cfg, d0=d0, d1=d1, groups=wanted_groups)
    else:
        result = eng.ce_element_rows(db, cfg, d0=d0, d1=d1, elements=wanted_elements)
    return result.to_dict(cfg)


# ---------------------------------------------------------------------------
# SPC (Un x CE)
# ---------------------------------------------------------------------------


@router.get("/spc")
def spc_board(
    scope: str = Query("electrolyzer", pattern="^(plant|electrolyzer)$"),
    un_table: str = Query("1", pattern="^[12]$"),
    ce_basis: str = Query("anodic", pattern="^(anodic|naoh)$"),
    calc: str = Query("all", pattern="^(individual|several|all)$"),
    date_from: str | None = None,
    date_till: str | None = None,
    electrolyzers: str | None = None,
    db: Session = Depends(get_db),
):
    cfg = eng.load_cfg(db)
    d0, d1 = eng.parse_day(date_from), eng.parse_day(date_till)
    if scope == "plant":
        result = eng.spc_plant_rows(db, cfg, un_table=un_table, d0=d0, d1=d1)
    else:
        wanted = _el_set(electrolyzers) if calc != "all" else None
        if calc != "all" and not wanted:
            raise HTTPException(status_code=422, detail="Select an electrolyzer")
        result = eng.spc_electrolyzer_rows(db, cfg, un_table=un_table, ce_basis=ce_basis, d0=d0, d1=d1, els=wanted)
    return result.to_dict(cfg)
