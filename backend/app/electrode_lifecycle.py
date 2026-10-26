"""Fill Anode/Cathode Recoating, Coating Check and Maintenance from plant workflows.

The Access tables stay the source of truth. Workflow steps write the same fields
operators used to type by hand (dispatch, return, warranty, inspection).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from . import models
from .calculations import serial_dol, shutdowns_affecting
from .warehouse import compact_eq, compact_nr, load_shutdown_windows


def _stamp(day: date | datetime | None) -> datetime | None:
    if day is None:
        return None
    if isinstance(day, datetime):
        return day
    return datetime.combine(day, datetime.min.time())


def _user_name(user: Any) -> str | None:
    name = (getattr(user, "full_name", None) or getattr(user, "username", None) or "").strip()
    return name[:100] or None


def _match(column, serial: str):
    return compact_eq(column, serial)


def last_dol(db: Session, kind: str, serial: str) -> int | None:
    field = "anode_nr" if kind == "anode" else "cathode_nr"
    key = compact_nr(serial)
    if not key:
        return None
    lives = [el for el in db.query(models.Element).all() if compact_nr(getattr(el, field)) == key]
    latest = None
    for el in lives:
        mark = el.disassembly_date or el.decommissioning_date or el.assembly_date
        if latest is None or (mark and latest[0] and mark > latest[0]):
            latest = (mark, el)
    elo = latest[1].electrolyzer if latest else None
    return serial_dol(lives, shutdowns=shutdowns_affecting(load_shutdown_windows(db), elo))


def _count_recoats(db: Session, kind: str, serial: str) -> int:
    key = compact_nr(serial)
    if kind == "anode":
        return sum(1 for r in db.query(models.AnodeRecoating).all() if compact_nr(r.anode_nr) == key)
    return sum(1 for r in db.query(models.CathodeRecoating).all() if compact_nr(r.cathode_nr) == key)


def _open_recoating(db: Session, kind: str, serial: str, code: str | None):
    if kind == "anode":
        q = db.query(models.AnodeRecoating)
        match = _match(models.AnodeRecoating.anode_nr, serial)
        if match is not None:
            q = q.filter(match)
        else:
            q = q.filter(models.AnodeRecoating.anode_nr == serial)
        if code:
            hit = q.filter(models.AnodeRecoating.coating_nr == code).order_by(models.AnodeRecoating.id.desc()).first()
            if hit:
                return hit
        return q.filter(models.AnodeRecoating.return_date.is_(None)).order_by(models.AnodeRecoating.id.desc()).first()
    q = db.query(models.CathodeRecoating)
    match = _match(models.CathodeRecoating.cathode_nr, serial)
    if match is not None:
        q = q.filter(match)
    else:
        q = q.filter(models.CathodeRecoating.cathode_nr == serial)
    if code:
        for row in q.order_by(models.CathodeRecoating.id.desc()).all():
            blob = f"{row.remarks or ''}"
            if code in blob:
                return row
    return q.filter(models.CathodeRecoating.return_date.is_(None)).order_by(models.CathodeRecoating.id.desc()).first()


def recoating_on_dispatch(
    db: Session,
    *,
    kind: str,
    serial: str,
    code: str | None,
    dispatch_date: date | None,
    manufacturer: str | None,
    prior_days: int | None,
) -> None:
    serial = (serial or "").strip()
    if not serial or kind not in ("anode", "cathode"):
        return
    row = _open_recoating(db, kind, serial, code)
    remark = f"Workflow {code}" if code else "Workflow recoating"
    if kind == "anode":
        if row is None:
            row = models.AnodeRecoating(anode_nr=serial, recoating_number=str(_count_recoats(db, "anode", serial) + 1))
            db.add(row)
        row.coating_nr = code or row.coating_nr
        row.dispatch_date = _stamp(dispatch_date) or row.dispatch_date
        row.manufacturer = (manufacturer or row.manufacturer or "")[:100] or row.manufacturer
        row.prior_service_days = prior_days if prior_days is not None else row.prior_service_days
        if not (row.remarks or "").startswith("Workflow"):
            row.remarks = remark
        return
    if row is None:
        row = models.CathodeRecoating(cathode_nr=serial)
        db.add(row)
    row.dispatch_date = _stamp(dispatch_date) or row.dispatch_date
    row.manufacturer = (manufacturer or row.manufacturer or "")[:100] or row.manufacturer
    row.prior_service_days = prior_days if prior_days is not None else row.prior_service_days
    if not (row.remarks or "").startswith("Workflow"):
        row.remarks = remark


def recoating_on_return(
    db: Session,
    *,
    kind: str,
    serial: str,
    code: str | None,
    return_date: date | None,
    warranty_months: int | None,
    warranty_start: date | None,
) -> None:
    serial = (serial or "").strip()
    if not serial or kind not in ("anode", "cathode"):
        return
    row = _open_recoating(db, kind, serial, code)
    if row is None:
        recoating_on_dispatch(db, kind=kind, serial=serial, code=code, dispatch_date=None, manufacturer=None, prior_days=None)
        row = _open_recoating(db, kind, serial, code)
    if row is None:
        return
    row.return_date = _stamp(return_date) or row.return_date
    if warranty_months is not None:
        row.warranty_months = warranty_months
    if warranty_start is not None:
        row.warranty_start = warranty_start
    elif warranty_months is not None and row.warranty_start is None:
        row.warranty_start = return_date if isinstance(return_date, date) else None


def recoating_on_approve(
    db: Session,
    *,
    kind: str,
    serial: str,
    code: str | None,
    dispatch_date: date | None,
    return_date: date | None,
    manufacturer: str | None,
    remark: str | None,
    warranty_months: int | None,
    warranty_start: date | None,
    prior_days: int | None,
) -> None:
    serial = (serial or "").strip()
    if not serial or kind not in ("anode", "cathode"):
        return
    row = _open_recoating(db, kind, serial, code)
    text = (remark or "").strip() or (f"Workflow {code}" if code else None)
    if kind == "anode":
        if row is None:
            row = models.AnodeRecoating(anode_nr=serial, recoating_number=str(_count_recoats(db, "anode", serial) + 1))
            db.add(row)
        elif not row.recoating_number:
            row.recoating_number = str(_count_recoats(db, "anode", serial))
        row.coating_nr = code or row.coating_nr
        row.dispatch_date = _stamp(dispatch_date) or row.dispatch_date
        row.return_date = _stamp(return_date) or row.return_date
        row.manufacturer = (manufacturer or row.manufacturer or "")[:100] or row.manufacturer
        if text:
            row.remarks = text
        row.warranty_months = warranty_months if warranty_months is not None else row.warranty_months
        row.warranty_start = warranty_start or row.warranty_start
        row.prior_service_days = prior_days if prior_days is not None else row.prior_service_days
        return
    if row is None:
        row = models.CathodeRecoating(cathode_nr=serial)
        db.add(row)
    row.dispatch_date = _stamp(dispatch_date) or row.dispatch_date
    row.return_date = _stamp(return_date) or row.return_date
    row.manufacturer = (manufacturer or row.manufacturer or "")[:100] or row.manufacturer
    if text:
        row.remarks = text
    row.warranty_months = warranty_months if warranty_months is not None else row.warranty_months
    row.warranty_start = warranty_start or row.warranty_start
    row.prior_service_days = prior_days if prior_days is not None else row.prior_service_days


def coating_check_on_inspect(
    db: Session,
    *,
    kind: str,
    serial: str,
    code: str | None,
    inspector: str | None,
    note: str | None,
    day: date | None = None,
) -> None:
    serial = (serial or "").strip()
    if not serial or kind not in ("anode", "cathode"):
        return
    when = _stamp(day or date.today())
    remark = (note or "").strip() or (f"Workflow inspect {code}" if code else "Workflow inspect")
    if kind == "anode":
        q = db.query(models.AnodeCoatingCheck)
        match = _match(models.AnodeCoatingCheck.anode_nr, serial)
        if match is not None:
            q = q.filter(match)
        if code:
            existing = q.filter(models.AnodeCoatingCheck.coating_nr == code).order_by(models.AnodeCoatingCheck.id.desc()).first()
            if existing:
                existing.check_date = when or existing.check_date
                existing.inspector = inspector or existing.inspector
                existing.remarks = remark
                existing.dol_days = last_dol(db, kind, serial) if existing.dol_days is None else existing.dol_days
                return
        db.add(
            models.AnodeCoatingCheck(
                anode_nr=serial,
                coating_nr=code,
                check_date=when,
                inspector=inspector,
                remarks=remark,
                dol_days=last_dol(db, kind, serial),
            )
        )
        return
    q = db.query(models.CathodeCoatingCheck)
    match = _match(models.CathodeCoatingCheck.cathode_nr, serial)
    if match is not None:
        q = q.filter(match)
    same_day = q.filter(models.CathodeCoatingCheck.check_date == when).order_by(models.CathodeCoatingCheck.id.desc()).first() if when else None
    if same_day:
        same_day.inspector = inspector or same_day.inspector
        same_day.remarks = remark
        return
    db.add(
        models.CathodeCoatingCheck(
            cathode_nr=serial,
            check_date=when,
            inspector=inspector,
            remarks=remark,
        )
    )


def maintenance_from_inspection(
    db: Session,
    *,
    kind: str,
    serial: str,
    finding: str | None,
    action: str | None,
    day: date | None = None,
) -> None:
    serial = (serial or "").strip()
    text = (finding or "").strip()
    if not serial or not text or kind not in ("anode", "cathode"):
        return
    when = _stamp(day or date.today())
    act = (action or "").strip() or None
    if kind == "anode":
        q = db.query(models.AnodeMaintenance)
        match = _match(models.AnodeMaintenance.anode_nr, serial)
        if match is not None:
            q = q.filter(match)
        for row in q.order_by(models.AnodeMaintenance.id.desc()).limit(8):
            if (row.finding or "").strip() == text and (row.date.date() if row.date else None) == (when.date() if when else None):
                return
        db.add(models.AnodeMaintenance(anode_nr=serial, date=when, finding=text, action=act))
        return
    q = db.query(models.CathodeMaintenance)
    match = _match(models.CathodeMaintenance.cathode_nr, serial)
    if match is not None:
        q = q.filter(match)
    for row in q.order_by(models.CathodeMaintenance.id.desc()).limit(8):
        if (row.finding or "").strip() == text and (row.date.date() if row.date else None) == (when.date() if when else None):
            return
    db.add(models.CathodeMaintenance(cathode_nr=serial, date=when, finding=text, action=act))


def write_tafkik_warranty(
    db: Session,
    *,
    serial: str,
    kind: str | None,
    company: str | None,
    warranty_start: date | None,
    warranty_months: int | None,
) -> None:
    """Store the coater/supplier warranty date on the TAFKIK (segregation) row."""
    serial = (serial or "").strip()
    if not serial:
        return
    parts: list[str] = []
    if warranty_start is not None:
        parts.append(warranty_start.isoformat())
    if warranty_months is not None:
        parts.append(f"{int(warranty_months)}m")
    text = " ".join(parts)[:100]
    if not text:
        return
    match = compact_eq(models.ElectrodeSegregation.serial_nr, serial)
    row = None
    if match is not None:
        row = (
            db.query(models.ElectrodeSegregation)
            .filter(match)
            .order_by(models.ElectrodeSegregation.id.desc())
            .first()
        )
    if row is None:
        row = models.ElectrodeSegregation(serial_nr=serial[:50], electrode_kind=(kind or None))
        db.add(row)
    row.warranty = text
    if kind:
        row.electrode_kind = kind
    name = (company or "").strip()[:100]
    if name and not (row.company or "").strip():
        row.company = name
