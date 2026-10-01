"""Enrich electrode segregation (TAFKIK) rows from Assembly / Inspection / AriaORMS."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from . import models
from .warehouse import compact_nr


def _as_date(value: date | datetime | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value


def _pos_key(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.isdigit():
        return str(int(text))
    return text.upper()


def format_service_life(install: date | None, decommission: date | None) -> str | None:
    if not install or not decommission:
        return None
    days = (decommission - install).days
    if days < 0:
        return None
    if days >= 365:
        years = days // 365
        rem = days % 365
        months = rem // 30
        if months:
            return f"{years}سال و {months}ماه"
        return f"{years}سال"
    if days >= 30:
        return f"{days // 30}ماه"
    return f"{days}روز"


def build_latest_element_index(db: Session) -> dict[str, models.Element]:
    """Map compact serial → latest Element that mounts that anode/cathode."""
    index: dict[str, models.Element] = {}
    for el in db.query(models.Element).order_by(models.Element.id.asc()).all():
        for nr in (el.anode_nr, el.cathode_nr):
            key = compact_nr(nr)
            if key:
                index[key] = el
    return index


def find_latest_element(
    db: Session,
    serial: str,
    index: dict[str, models.Element] | None = None,
) -> models.Element | None:
    key = compact_nr(serial)
    if not key:
        return None
    if index is not None:
        return index.get(key)
    return build_latest_element_index(db).get(key)


def _side_on_element(el: models.Element, serial: str) -> str | None:
    key = compact_nr(serial)
    if key and key == compact_nr(el.anode_nr):
        return "anode"
    if key and key == compact_nr(el.cathode_nr):
        return "cathode"
    return None


def pair_serial_from_element(el: models.Element, serial: str) -> str | None:
    side = _side_on_element(el, serial)
    if side == "anode":
        return (el.cathode_nr or "").strip() or None
    if side == "cathode":
        return (el.anode_nr or "").strip() or None
    return None


def coating_for_serial(el: models.Element, serial: str) -> str | None:
    side = _side_on_element(el, serial)
    if side == "anode":
        return (el.anode_coating or "").strip() or None
    if side == "cathode":
        return (el.cathode_coating or "").strip() or None
    return (el.anode_coating or el.cathode_coating or "").strip() or None


def _latest_inspection_for_serial(db: Session, serial: str) -> models.InspectionReport | None:
    key = compact_nr(serial)
    if not key:
        return None
    rows = (
        db.query(models.InspectionReport)
        .order_by(models.InspectionReport.id.desc())
        .limit(5000)
        .all()
    )
    for row in rows:
        if key in {
            compact_nr(row.anode_nr),
            compact_nr(row.cathode_nr),
            compact_nr(row.electrode_nr_anode),
            compact_nr(row.electrode_nr_cathode),
        }:
            return row
    return None


def xrf_for_serial(db: Session, serial: str) -> str | None:
    key = compact_nr(serial)
    if not key:
        return None
    insp = _latest_inspection_for_serial(db, serial)
    if insp:
        if key == compact_nr(insp.anode_nr) or key == compact_nr(insp.electrode_nr_anode):
            if insp.xrf_anode:
                return str(insp.xrf_anode).strip() or None
        if key == compact_nr(insp.cathode_nr) or key == compact_nr(insp.electrode_nr_cathode):
            if insp.xrf_cathode:
                return str(insp.xrf_cathode).strip() or None
        if insp.xrf_anode:
            return str(insp.xrf_anode).strip() or None
        if insp.xrf_cathode:
            return str(insp.xrf_cathode).strip() or None
    seg = (
        db.query(models.ElectrodeSegregation)
        .filter(models.ElectrodeSegregation.serial_nr.isnot(None))
        .order_by(models.ElectrodeSegregation.id.desc())
        .limit(3000)
        .all()
    )
    for row in seg:
        if compact_nr(row.serial_nr) == key and row.xrf:
            return str(row.xrf).strip() or None
    return None


def inspection_form_serial(db: Session, serial: str, element_nr: str | None = None) -> str | None:
    insp = _latest_inspection_for_serial(db, serial)
    if insp and insp.client:
        return str(insp.client).strip() or None
    if element_nr:
        row = (
            db.query(models.InspectionReport)
            .filter(models.InspectionReport.element_nr == element_nr)
            .order_by(models.InspectionReport.id.desc())
            .first()
        )
        if row and row.client:
            return str(row.client).strip() or None
    return None


def _norm_at(
    db: Session,
    electrolyzer: str,
    at: date,
) -> models.ElectrolyzerNormalization | None:
    end = datetime.combine(at, datetime.max.time())
    start = datetime.combine(at - timedelta(days=30), datetime.min.time())
    rows = (
        db.query(models.ElectrolyzerNormalization)
        .filter(
            models.ElectrolyzerNormalization.electrolyzer == electrolyzer,
            models.ElectrolyzerNormalization.date.isnot(None),
            models.ElectrolyzerNormalization.date <= end,
            models.ElectrolyzerNormalization.date >= start,
        )
        .order_by(models.ElectrolyzerNormalization.date.desc())
        .limit(40)
        .all()
    )
    for row in rows:
        if row.total_current is not None or row.anolyte_temp is not None or row.catholyte_temp is not None:
            return row
    older = (
        db.query(models.ElectrolyzerNormalization)
        .filter(
            models.ElectrolyzerNormalization.electrolyzer == electrolyzer,
            models.ElectrolyzerNormalization.date.isnot(None),
            models.ElectrolyzerNormalization.date <= end,
        )
        .order_by(models.ElectrolyzerNormalization.date.desc())
        .limit(80)
        .all()
    )
    for row in older:
        if row.total_current is not None or row.anolyte_temp is not None or row.catholyte_temp is not None:
            return row
    return rows[0] if rows else (older[0] if older else None)


def _voltage_at(
    db: Session,
    electrolyzer: str,
    position: str | None,
    at: date,
) -> float | None:
    pos = _pos_key(position)
    if not pos:
        return None
    end = datetime.combine(at, datetime.max.time())
    start = datetime.combine(at - timedelta(days=14), datetime.min.time())
    candidates = (
        db.query(models.VoltageReading)
        .filter(
            models.VoltageReading.electrolyzer == electrolyzer,
            models.VoltageReading.date.isnot(None),
            models.VoltageReading.date <= end,
            models.VoltageReading.date >= start,
            models.VoltageReading.voltage.isnot(None),
        )
        .order_by(models.VoltageReading.date.desc())
        .limit(400)
        .all()
    )
    for row in candidates:
        if _pos_key(row.position) == pos:
            return float(row.voltage) if row.voltage is not None else None
    older = (
        db.query(models.VoltageReading)
        .filter(
            models.VoltageReading.electrolyzer == electrolyzer,
            models.VoltageReading.date.isnot(None),
            models.VoltageReading.date <= end,
            models.VoltageReading.voltage.isnot(None),
        )
        .order_by(models.VoltageReading.date.desc())
        .limit(800)
        .all()
    )
    for row in older:
        if _pos_key(row.position) == pos:
            return float(row.voltage) if row.voltage is not None else None
    return None


def monitoring_at_decommission(
    db: Session,
    el: models.Element,
    decommission: date | None,
) -> tuple[float | None, float | None, float | None]:
    """Return (voltage, kA, temperature) near decommissioning from AriaORMS."""
    if not decommission or not el.electrolyzer:
        return None, None, None
    elo = str(el.electrolyzer).strip()
    voltage = _voltage_at(db, elo, el.position, decommission)
    norm = _norm_at(db, elo, decommission)
    ka = float(norm.total_current) if norm and norm.total_current is not None else None
    temp = None
    if norm:
        if norm.anolyte_temp is not None:
            temp = float(norm.anolyte_temp)
        elif norm.catholyte_temp is not None:
            temp = float(norm.catholyte_temp)
    return voltage, ka, temp


def _parse_maybe_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def enrich_segregation_fields(
    db: Session,
    *,
    serial_nr: str,
    electrode_kind: str | None = None,
    preserve_service_life: str | None = None,
    excel_values: dict[str, Any] | None = None,
    element_index: dict[str, models.Element] | None = None,
) -> dict[str, Any]:
    """
    Build field updates from Assembly Data + Inspection + monitoring.

    - company / dates / problems from latest matching Element
    - service_life calculated only when preserve_service_life is empty
    - pair serial / pair XRF / inspection form serial / decommission V·kA·T filled
    - excel_values supply workshop columns that are not assembly-driven
    """
    excel = excel_values or {}
    out: dict[str, Any] = {}
    for key in (
        "xrf",
        "voltage_quality",
        "warranty",
        "coating_quality",
        "decision",
        "segregation",
        "pallet",
        "remarks",
        "inspection_date",
        "problems",
        "pair_serial_nr",
        "pair_xrf",
        "decommission_voltage",
        "decommission_ka",
        "decommission_temp",
        "inspection_form_serial",
    ):
        if key in excel and excel[key] is not None:
            out[key] = excel[key]

    el = find_latest_element(db, serial_nr, element_index)
    kind = electrode_kind
    if el:
        side = _side_on_element(el, serial_nr)
        if side:
            kind = side
        coating = coating_for_serial(el, serial_nr)
        if coating:
            out["company"] = coating
        install = _as_date(el.commissioning_date) or _as_date(el.assembly_date)
        if install:
            out["install_date"] = install
        decomm = _as_date(el.decommissioning_date)
        if decomm:
            out["decommission_date"] = decomm
        disassemble = _as_date(el.disassembly_date)
        if disassemble:
            out["disassemble_date"] = disassemble
        if el.decommission_reason:
            out["problems"] = str(el.decommission_reason).strip() or None

        pair = pair_serial_from_element(el, serial_nr)
        if pair:
            out["pair_serial_nr"] = pair
            if not out.get("pair_xrf"):
                pair_xrf = xrf_for_serial(db, pair)
                if pair_xrf:
                    out["pair_xrf"] = pair_xrf

        if not out.get("inspection_form_serial"):
            form_serial = inspection_form_serial(db, serial_nr, el.element_nr)
            if form_serial:
                out["inspection_form_serial"] = form_serial

        at = decomm or disassemble
        v, ka, temp = monitoring_at_decommission(db, el, at)
        if v is not None:
            out["decommission_voltage"] = v
        if ka is not None:
            out["decommission_ka"] = ka
        if temp is not None:
            out["decommission_temp"] = temp

        life_src = (preserve_service_life if preserve_service_life is not None else excel.get("service_life")) or None
        if life_src:
            out["service_life"] = life_src
        else:
            life = format_service_life(install, decomm)
            if life:
                out["service_life"] = life
    else:
        for key in ("company", "problems", "service_life", "install_date", "disassemble_date", "decommission_date"):
            if excel.get(key) is not None:
                out[key] = excel[key]
        life_src = (preserve_service_life if preserve_service_life is not None else out.get("service_life")) or None
        if life_src:
            out["service_life"] = life_src
        else:
            life = format_service_life(
                _parse_maybe_date(out.get("install_date") or excel.get("install_date")),
                _parse_maybe_date(out.get("decommission_date") or excel.get("decommission_date")),
            )
            if life:
                out["service_life"] = life

    if kind:
        out["electrode_kind"] = kind
    out["serial_nr"] = serial_nr
    return out


def apply_enrichment_to_row(
    db: Session,
    row: models.ElectrodeSegregation,
    *,
    element_index: dict[str, models.Element] | None = None,
) -> bool:
    """Mutate an existing ORM row. Never overwrites existing service_life."""
    preserve = row.service_life
    fields = enrich_segregation_fields(
        db,
        serial_nr=row.serial_nr,
        electrode_kind=row.electrode_kind,
        preserve_service_life=preserve,
        element_index=element_index,
    )
    changed = False
    for key, value in fields.items():
        if key == "serial_nr":
            continue
        if key == "service_life":
            if preserve:
                continue
            if value and getattr(row, key) != value:
                setattr(row, key, value)
                changed = True
            continue
        if value is None:
            continue
        if getattr(row, key, None) != value:
            setattr(row, key, value)
            changed = True
    return changed
