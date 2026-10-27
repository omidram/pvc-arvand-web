"""Global search: one box that looks through every searchable table of the program.

Each entry of ``ENTITIES`` names a table, the menu forms that may see it, a title column and the
page that opens the record. Every text column of the table is searched (``LIKE``, case-insensitive,
Persian/Arabic letters and digits treated alike). Users only get tables they have access to.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, Text, or_
from sqlalchemy.orm import Session

from .. import models, workflow_models as wf
from ..auth import get_current_user, user_permission_map
from ..database import get_db

router = APIRouter(prefix="/search", tags=["search"])

_SKIP_WORDS = ("image", "password", "hash", "token", "signature_data", "secret")


@dataclass
class Entity:
    key: str
    fa: str
    en: str
    model: Any
    forms: tuple[str, ...]
    title: tuple[str, ...]  # first non-empty column becomes the row title
    href: str  # "{id}" / "{column}" placeholders
    extra: tuple[str, ...] = field(default_factory=tuple)  # columns shown next to the title


ENTITIES: list[Entity] = [
    Entity("elements", "داده‌های مونتاژ (المنت)", "Assembly Data (elements)", models.Element, ("elements",), ("element_nr",), "/elements?q={element_nr}", ("electrolyzer", "position", "anode_nr", "cathode_nr", "membrane_nr")),
    Entity("anodes", "آند", "Anodes", models.Anode, ("anodes",), ("anode_nr",), "/anodes?q={anode_nr}", ("coating", "manufacturer")),
    Entity("cathodes", "کاتد", "Cathodes", models.Cathode, ("cathodes",), ("cathode_nr",), "/cathodes?q={cathode_nr}", ("coating", "manufacturer")),
    Entity("membranes", "ممبران", "Membranes", models.Membrane, ("membranes",), ("membrane_nr",), "/membranes?q={membrane_nr}", ("membrane_type",)),
    Entity("inspections", "گزارش بازرسی", "Inspection reports", models.InspectionReport, ("inspections",), ("element_nr",), "/inspections?id={id}", ("inspection_reason", "inspector_name")),
    Entity("assembly_inspection", "گزارش بازرسی مونتاژ", "Assembly inspection reports", models.AssemblyInspectionReport, ("inspections",), ("element_nr",), "/assembly-inspection?q={element_nr}"),
    Entity("segregation", "تفکیک الکترود (TAFKIK)", "Electrode segregation", models.ElectrodeSegregation, ("inspections", "anodes", "cathodes"), ("serial_nr",), "/segregation?serial_nr={serial_nr}", ("company", "decision")),
    Entity("shutdowns", "توقف‌ها", "Shutdowns", models.Shutdown, ("shutdowns",), ("cause", "code"), "/shutdowns?q={nr}", ("plant_part", "category")),
    Entity("shutdown_causes", "علل توقف", "Shutdown causes", models.ShutdownCause, ("shutdowns",), ("cause", "code"), "/shutdowns", ("category",)),
    Entity("remarks", "ملاحظات", "Remarks", models.Remark, ("remarks",), ("category", "text"), "/remarks", ("author",)),
    Entity("analyses", "آنالیزها", "Analyses", models.AnalysisSample, ("analyses",), ("analysis_type",), "/analyses", ("scope", "electrolyzer")),
    Entity("maintenance", "گزارش‌های تعمیرات", "Maintenance reports", models.MaintenanceReport, ("reports", "activity"), ("component_nr", "title"), "/maintenance-reports", ("kind", "title")),
    Entity("groups", "تعریف گروه", "Group definitions", models.GroupDefinition, ("elements",), ("group_nr",), "/elements", ("anode_coating", "cathode_coating", "membrane_type")),
    Entity("work_orders", "سفارش کار (برنامه‌ریز)", "Work orders (planner)", wf.WfWorkOrder, ("wf_planner", "wf_cellshop", "wf_c90"), ("code",), "/work-orders?id={id}", ("element_nr", "anode_nr", "cathode_nr", "status")),
    Entity("wf_purchase", "خرید جدید", "New purchases", wf.WfPurchase, ("wf_procurement", "wf_warehouse", "wf_process", "wf_c90", "wf_inspection"), ("code",), "/cartable", ("indent_no", "status")),
    Entity("wf_coating", "پوشش‌دهی مجدد", "Recoating batches", wf.WfCoatingBatch, ("wf_procurement", "wf_warehouse", "wf_c90", "wf_inspection", "wf_process"), ("code",), "/cartable", ("status",)),
    Entity("wf_cell", "درخواست سل", "Cell requests", wf.WfCellRequest, ("wf_operation", "wf_cellshop", "wf_c90"), ("code",), "/cartable", ("electrolyzer", "position", "status")),
    Entity("wf_inspection", "درخواست بازرسی", "Inspection requests", wf.WfInspectionRequest, ("wf_inspection", "wf_process", "wf_c90"), ("code",), "/cartable", ("anode_nr", "cathode_nr", "status")),
    Entity("wf_assemble", "درخواست مونتاژ", "Assemble requests", wf.WfAssembleRequest, ("wf_c90", "wf_inspection", "wf_process"), ("code",), "/cartable", ("status",)),
]


def _variants(q: str) -> list[str]:
    """The text as typed, with Arabic/Persian letters and digits swapped both ways."""
    pairs = [("ی", "ي"), ("ک", "ك")]
    out = {q}
    for a, b in pairs:
        out.add(q.replace(a, b))
        out.add(q.replace(b, a))
    fa_digits = "۰۱۲۳۴۵۶۷۸۹"
    for text in list(out):
        out.add(text.translate({ord(d): str(i) for i, d in enumerate(fa_digits)}))
    return [v for v in out if v]


def _text_columns(model: Any) -> list[Any]:
    cols = []
    for col in model.__table__.columns:
        if not isinstance(col.type, (String, Text)):
            continue
        if any(word in col.name.lower() for word in _SKIP_WORDS):
            continue
        cols.append(getattr(model, col.key))
    return cols


def _allowed(levels: dict[str, str], entity: Entity) -> bool:
    return any(levels.get(form, "none") != "none" for form in entity.forms)


class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return ""


@router.get("/global")
def global_search(
    q: str = Query(..., min_length=2, max_length=100),
    per_table: int = Query(15, ge=1, le=100),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    text = " ".join(q.split())
    if len(text) < 2:
        raise HTTPException(400, "Type at least 2 characters")
    levels = user_permission_map(db, user)
    variants = _variants(text)
    groups: list[dict[str, Any]] = []
    total = 0
    for entity in ENTITIES:
        if not _allowed(levels, entity):
            continue
        model = entity.model
        cols = _text_columns(model)
        if not cols:
            continue
        cond = or_(*[col.ilike(f"%{v}%") for col in cols for v in variants])
        try:
            count = db.query(model).filter(cond).count()
            if not count:
                continue
            pk = list(model.__table__.primary_key.columns)[0]
            rows = db.query(model).filter(cond).order_by(getattr(model, pk.key).desc()).limit(per_table).all()
        except Exception:  # noqa: BLE001 - a broken table must not break the whole search
            db.rollback()
            continue
        items = []
        for row in rows:
            data = {c.name: getattr(row, c.key, None) for c in model.__table__.columns}
            title = next((str(data[c]) for c in entity.title if data.get(c) not in (None, "")), None) or f"#{data.get(pk.name)}"
            hits = []
            for col in cols:
                value = getattr(row, col.key, None)
                if value in (None, ""):
                    continue
                sval = str(value)
                low = sval.lower()
                if any(v.lower() in low for v in variants):
                    hits.append({"field": col.name, "value": sval[:160]})
                if len(hits) >= 4:
                    break
            shown = {c: str(data[c]) for c in entity.extra if data.get(c) not in (None, "")}
            items.append(
                {
                    "id": data.get(pk.name),
                    "title": title,
                    "href": entity.href.format_map(_Safe({k: str(v if v is not None else "") for k, v in data.items()})),
                    "info": shown,
                    "matches": hits,
                }
            )
        total += count
        groups.append({"key": entity.key, "fa": entity.fa, "en": entity.en, "total": count, "rows": items})
    return {"q": text, "total": total, "groups": groups}
