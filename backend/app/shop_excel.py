"""Load a shop-stage Excel into Assembly Data + the cell-shop pipeline.

Element / anode / cathode / membrane numbers are written onto the latest life
of that element and into the master catalogs so workflow and forms stay in step.
Manual shop stages still respect the same role rules as Move.
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import element_dashboard as svc
from . import models
from .excel_import import parse_sheet
from .plant_import import ensure_electrode_serial_prefix
from .relations_sync import link_serial, sync_element_group
from .routers.field_options import publish_assembly_value
from .database import commit_db
from .warehouse import compact_nr, load_compact_index

SHOP_FIELDS = [
    "element_nr",
    "stage",
    "electrolyzer",
    "position",
    "cell",
    "group_nr",
    "anode_nr",
    "cathode_nr",
    "membrane_nr",
    "membrane_type",
    "note",
]

_STAGE_ALIASES = {
    "inservice": "in_service",
    "درسرویس": "in_service",
    "installed": "installed",
    "نصبشده": "installed",
    "decommissioned": "decommissioned",
    "ازمدارخارجشده": "decommissioned",
    "waitingfordisassembly": "awaiting_disassembly",
    "awaitingdisassembly": "awaiting_disassembly",
    "درکارگاهc90منتظردمونتاژ": "awaiting_disassembly",
    "منتظردمونتاژ": "awaiting_disassembly",
    "rateoff": "disassembled",
    "disassembled": "disassembled",
    "waitingforassembly": "awaiting_assembly",
    "awaitingassembly": "awaiting_assembly",
    "منتظرمونتاژالمنتجدید": "awaiting_assembly",
    "beingassembled": "assembling",
    "assembling": "assembling",
    "درحالمونتاژ": "assembling",
    "assembledwaitingforqc": "awaiting_qc",
    "awaitingqc": "awaiting_qc",
    "مونتاژشدهدرانتظارqc": "awaiting_qc",
    "readyinshop": "ready",
    "ready": "ready",
    "آمادهدرکارگاه": "ready",
}

_CELL = re.compile(r"^([A-Za-z]+\d*)[\s\-/]+(\d{1,3})$")


def _compact_label(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\u200c", "").replace("ي", "ی").replace("ك", "ک")
    return re.sub(r"[^0-9a-zA-Zآ-ی]+", "", text).lower()


def _stage_key(value: Any) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    raw = str(value).strip()
    if raw in svc.ALL_STATES or raw in svc.MANUAL_STAGES:
        return raw
    return _STAGE_ALIASES.get(_compact_label(raw))


def _split_cell(value: Any) -> tuple[str | None, str | None]:
    text = str(value or "").strip()
    if not text:
        return None, None
    match = _CELL.match(text.replace("–", "-"))
    if not match:
        return None, None
    pos = match.group(2)
    return match.group(1).upper(), pos.zfill(3) if pos.isdigit() else pos


def _text(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def _latest_map(db: Session) -> dict[str, models.Element]:
    latest: dict[str, models.Element] = {}
    for el in db.query(models.Element).all():
        key = compact_nr(el.element_nr)
        if not key:
            continue
        prev = latest.get(key)
        rank = (str(el.assembly_date or ""), str(el.commissioning_date or ""), el.id or 0)
        if prev is None or rank >= (str(prev.assembly_date or ""), str(prev.commissioning_date or ""), prev.id or 0):
            latest[key] = el
    return latest


def _sync_parts(db: Session, el: models.Element, data: dict[str, Any], indexes: dict) -> dict[str, int]:
    created = {"anodes": 0, "cathodes": 0, "membranes": 0}
    anode = ensure_electrode_serial_prefix(_text(data.get("anode_nr")), "anode")
    cathode = ensure_electrode_serial_prefix(_text(data.get("cathode_nr")), "cathode")
    membrane = _text(data.get("membrane_nr"))
    membrane_type = _text(data.get("membrane_type"))
    group_nr = _text(data.get("group_nr"))
    if anode:
        size = len(indexes["anode"])
        el.anode_nr = link_serial(db, "anode", anode, index=indexes["anode"])
        created["anodes"] += int(len(indexes["anode"]) > size)
    if cathode:
        size = len(indexes["cathode"])
        el.cathode_nr = link_serial(db, "cathode", cathode, index=indexes["cathode"])
        created["cathodes"] += int(len(indexes["cathode"]) > size)
    if membrane:
        extra = {"membrane_type": membrane_type} if membrane_type else None
        size = len(indexes["membrane"])
        el.membrane_nr = link_serial(db, "membrane", membrane, extra=extra, index=indexes["membrane"])
        created["membranes"] += int(len(indexes["membrane"]) > size)
        if membrane_type:
            hit = db.query(models.Membrane).filter(models.Membrane.membrane_nr == el.membrane_nr).first()
            if hit is not None:
                hit.membrane_type = membrane_type[:100]
    if membrane_type:
        el.membrane_type = membrane_type[:100]
        publish_assembly_value(db, "elements", "membrane_type", el.membrane_type)
    if group_nr:
        el.group_nr = group_nr[:50]
    elif not (el.group_nr or "").strip():
        sync_element_group(db, el)
    return created


def import_shop_workbook(
    db: Session,
    content: bytes,
    *,
    tab_state: str | None,
    actor: models.User | None,
    groups: set[str],
    progress=None,
) -> dict[str, Any]:
    mapping, data_rows, arranged, ignored = parse_sheet(content, SHOP_FIELDS, optional=["id", "since", "days"])
    indexes = {
        "anode": load_compact_index(db, models.Anode, "anode_nr"),
        "cathode": load_compact_index(db, models.Cathode, "cathode_nr"),
        "membrane": load_compact_index(db, models.Membrane, "membrane_nr"),
    }
    pipeline = {i["key"]: i for i in svc.build_pipeline(db)}
    latest = _latest_map(db)
    who = (actor.full_name or actor.username) if actor else None
    updated = created = moved = skipped = 0
    catalogs = {"anodes": 0, "cathodes": 0, "membranes": 0}
    errors: list[str] = []
    total = len(data_rows)
    if progress:
        progress(0, total)

    tab = (tab_state or "").strip()
    if tab in ("shop", "all", ""):
        tab = None

    for done, row in enumerate(data_rows, start=1):
        raw = {mapping[i]: row[i] if i < len(row) else None for i in mapping}
        nr = _text(raw.get("element_nr"))
        key = compact_nr(nr)
        if not key:
            skipped += 1
            continue
        el = latest.get(key)
        is_new = el is None
        if is_new:
            el = models.Element(element_nr=nr[:50])
            db.add(el)
            latest[key] = el
            created += 1
        else:
            updated += 1

        cell_el, cell_pos = _split_cell(raw.get("cell"))
        electrolyzer = _text(raw.get("electrolyzer")) or cell_el
        position = _text(raw.get("position")) or cell_pos
        if electrolyzer and not el.electrolyzer:
            el.electrolyzer = electrolyzer.upper()[:50]
        if position and not el.position:
            el.position = position[:10]
        counts = _sync_parts(db, el, raw, indexes)
        for name, n in counts.items():
            catalogs[name] += n

        wanted = _stage_key(raw.get("stage")) or (tab if tab in svc.MANUAL_STAGES else None)
        if wanted in svc.MANUAL_STAGES:
            need = {"cellshop"} if wanted in ("awaiting_assembly", "assembling", "awaiting_qc", "ready") else {"operation"}
            if wanted == "awaiting_disassembly":
                need = {"operation"}
            if not (groups & need):
                skipped += 1
                if len(errors) < 8:
                    errors.append(f"{nr}: this stage belongs to {', '.join(need)}")
            elif (pipeline.get(key) or {}).get("state") == wanted:
                moved += 1
            else:
                try:
                    svc.set_shop_stage(db, el.element_nr, wanted, _text(raw.get("note")), who, pipeline)
                    moved += 1
                    if key in pipeline:
                        pipeline[key]["state"] = wanted
                    if wanted == "awaiting_disassembly" and actor is not None:
                        from .routers.workflow import handoff_cell_requests

                        try:
                            handoff_cell_requests(db, el.element_nr, "disassemble", actor, _text(raw.get("note")))
                        except Exception:  # noqa: BLE001
                            pass
                except ValueError as exc:
                    skipped += 1
                    if len(errors) < 8:
                        errors.append(str(exc))
        if progress and (done == total or done % 5 == 0):
            progress(done, total)

    if updated + created == 0:
        db.rollback()
        raise HTTPException(status_code=400, detail="No element rows were found in the Excel file.")
    commit_db(db)
    svc.clear_cache()
    return {
        "ok": True,
        "created": created,
        "updated": updated,
        "moved": moved,
        "skipped": skipped,
        "catalogs_created": catalogs,
        "arranged": arranged,
        "ignored": ignored,
        "errors": errors,
        "mapped": [mapping[i] for i in sorted(mapping)],
    }


def shop_export_rows(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for item in items:
        rows.append(
            {
                "element_nr": item.get("element_nr"),
                "stage": item.get("state"),
                "electrolyzer": item.get("electrolyzer"),
                "position": item.get("position"),
                "cell": f"{item['electrolyzer']}-{item['position']}" if item.get("electrolyzer") else "",
                "group_nr": item.get("group_nr"),
                "anode_nr": item.get("anode_nr"),
                "cathode_nr": item.get("cathode_nr"),
                "membrane_nr": item.get("membrane_nr"),
                "membrane_type": item.get("membrane_type"),
                "note": item.get("note"),
            }
        )
    return rows
