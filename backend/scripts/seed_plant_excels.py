"""Load plant Excel catalogues into the live SQLite DB.

Sources (repo copies under docs/plant-data/):
  - ANODE-SERIAL-NUMBERS.xlsx  -> anodes
  - CATHODE-SERIAL-NUMBERS.xlsx -> cathodes
  - montage-install-dismantle-import-ready.xlsx -> elements (assembly)
  - TAFKIK.xlsx -> electrode_segregations
"""
from __future__ import annotations

import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app import models  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.plant_import import parse_assembly_excel, parse_tafkik_excel  # noqa: E402
from app.routers.elements import _apply_assembly_import  # noqa: E402
from app.segregation_enrich import apply_enrichment_to_row, build_latest_element_index, enrich_segregation_fields  # noqa: E402
from app.warehouse import compact_nr  # noqa: E402

DATA = ROOT / "docs" / "plant-data"


def _norm_serial(value) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def seed_anode_serials(db) -> int:
    path = DATA / "ANODE-SERIAL-NUMBERS.xlsx"
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["ANODE"] if "ANODE" in wb.sheetnames else wb[wb.sheetnames[0]]
    created = 0
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue
        serial = _norm_serial(row[1] if len(row) > 1 else None)
        if not serial:
            continue
        remark = _norm_serial(row[2] if len(row) > 2 else None) or None
        generation = None
        if remark and "نسل" in remark:
            generation = remark
        existing = db.get(models.Anode, serial)
        if existing:
            if remark and not existing.remarks:
                existing.remarks = remark
            if generation and not existing.generation:
                existing.generation = generation
            continue
        db.add(models.Anode(anode_nr=serial, remarks=remark, generation=generation))
        created += 1
    wb.close()
    db.commit()
    return created


def seed_cathode_serials(db) -> int:
    path = DATA / "CATHODE-SERIAL-NUMBERS.xlsx"
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["CATHODE"] if "CATHODE" in wb.sheetnames else wb[wb.sheetnames[0]]
    created = 0
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue
        serial = _norm_serial(row[1] if len(row) > 1 else None)
        if not serial:
            continue
        remark = _norm_serial(row[2] if len(row) > 2 else None) or None
        generation = None
        if remark and "نسل" in remark:
            generation = remark
        existing = db.get(models.Cathode, serial)
        if existing:
            if remark and not existing.remarks:
                existing.remarks = remark
            if generation and not existing.generation:
                existing.generation = generation
            continue
        db.add(models.Cathode(cathode_nr=serial, remarks=remark, generation=generation))
        created += 1
    wb.close()
    db.commit()
    return created


def seed_montage(db) -> dict:
    path = DATA / "montage-install-dismantle-import-ready.xlsx"
    content = path.read_bytes()
    parsed = parse_assembly_excel(content)
    if not parsed.get("recognized"):
        raise SystemExit(f"Montage workbook not recognized: {path}")
    return _apply_assembly_import(db, parsed, mode="upsert", progress=None)


def _seg_kwargs(fields: dict) -> dict:
    from datetime import date, datetime

    names = {c.name for c in models.ElectrodeSegregation.__table__.columns}
    out = {}
    for key, value in fields.items():
        if key not in names:
            continue
        if key.endswith("_date"):
            if value is None or value == "":
                out[key] = None
            elif isinstance(value, date) and not isinstance(value, datetime):
                out[key] = value
            else:
                try:
                    out[key] = date.fromisoformat(str(value)[:10])
                except ValueError:
                    out[key] = None
        else:
            out[key] = value
    return out


def seed_tafkik(db) -> int:
    path = DATA / "TAFKIK.xlsx"
    content = path.read_bytes()
    parsed = parse_tafkik_excel(content)
    records = parsed.get("records") or []
    anode_keys = {compact_nr(nr) for (nr,) in db.query(models.Anode.anode_nr).all() if nr}
    cathode_keys = {compact_nr(nr) for (nr,) in db.query(models.Cathode.cathode_nr).all() if nr}
    element_index = build_latest_element_index(db)
    existing = {
        (compact_nr(s), str(d) if d else "")
        for s, d in db.query(
            models.ElectrodeSegregation.serial_nr,
            models.ElectrodeSegregation.inspection_date,
        ).all()
        if s
    }
    created = 0
    for item in records:
        kind = item.get("electrode_kind")
        if not kind or kind == "unknown":
            key = compact_nr(item["serial_nr"])
            if key in anode_keys and key not in cathode_keys:
                kind = "anode"
            elif key in cathode_keys and key not in anode_keys:
                kind = "cathode"
        identity = (compact_nr(item["serial_nr"]), str(item.get("inspection_date") or ""))
        if identity in existing:
            continue
        fields = enrich_segregation_fields(
            db,
            serial_nr=item["serial_nr"],
            electrode_kind=kind,
            preserve_service_life=item.get("service_life") or None,
            excel_values=item,
            element_index=element_index,
        )
        row = models.ElectrodeSegregation(**_seg_kwargs(fields))
        apply_enrichment_to_row(row, fields)
        db.add(row)
        existing.add(identity)
        created += 1
        if created % 500 == 0:
            db.flush()
    db.commit()
    return created


def main() -> None:
    missing = [
        name
        for name in (
            "ANODE-SERIAL-NUMBERS.xlsx",
            "CATHODE-SERIAL-NUMBERS.xlsx",
            "montage-install-dismantle-import-ready.xlsx",
            "TAFKIK.xlsx",
        )
        if not (DATA / name).is_file()
    ]
    if missing:
        raise SystemExit(f"Missing plant-data files: {missing}")

    db = SessionLocal()
    try:
        a = seed_anode_serials(db)
        c = seed_cathode_serials(db)
        m = seed_montage(db)
        t = seed_tafkik(db)
        print(
            "OK anodes_new=",
            a,
            "cathodes_new=",
            c,
            "montage=",
            m,
            "tafkik_new=",
            t,
            "anode_total=",
            db.query(models.Anode).count(),
            "cathode_total=",
            db.query(models.Cathode).count(),
            "element_total=",
            db.query(models.Element).count(),
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
