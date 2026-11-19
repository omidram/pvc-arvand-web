"""Place the official go-live position workbooks into the matching screen.

Each file name is a slot. A row is written only when every required cell is
present, dates that look Jalali are converted, and the piece is not already
sitting in another launch file. A previous import of the same file is replaced.
Nothing else in the database is deleted.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from io import BytesIO
from typing import Any

from openpyxl import load_workbook
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .database import commit_db
from .element_dashboard import _base_state, _event_date, clear_cache
from .plant_import import gregorian_to_jalali, jalali_to_gregorian
from .warehouse import compact_nr, ensure_indexed, load_compact_index
from .workflow_models import (
    MembraneStock,
    MembraneStockMove,
    WfAssembleRequest,
    WfCellRequest,
    WfCoatingBatch,
    WfCoatingItem,
    WfCoatingPackage,
    WfEvent,
    WfInspectionRequest,
    WfNotification,
    WfPurchase,
    WfPurchaseItem,
    WfWorkOrder,
)

MARKER_PREFIX = "ACM-LAUNCH:"
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_MARKS = {"x", "1", "yes", "y", "ok", "true", "بله", "بلی", "*", "✓", "✔", "√"}
_CLOSED = ("completed", "cancelled")

# Filename needles, after lower-casing and turning punctuation into spaces.
SLOTS: dict[str, dict[str, Any]] = {
    "pickup": {
        "needles": ("pick up to cell shop",),
        "file": "pick up to cell shop Element.xlsx",
        "columns": ("element",),
    },
    "disassemble": {
        "needles": ("dissassemble", "disassemble"),
        "file": "Waiting for DissAssemble Element.xlsx",
        "columns": ("element",),
    },
    "tafkik": {
        "needles": ("tafkik",),
        "file": "Waiting for Inspection-Process Check TAFKIK.xlsx",
        "columns": ("element", "anode", "cathode"),
    },
    "assembly": {
        "needles": ("waiting for assembly",),
        "file": "Anode-Cathode waiting for Assembly.xlsx",
        "columns": ("serial", "good", "medium", "recoating", "purchase"),
    },
    "membrane": {
        "needles": ("membrane stock",),
        "file": "membrane Stock.xlsx",
        "columns": ("membrane_type", "quantity"),
    },
    "qc": {
        "needles": ("waiting for qc",),
        "file": "assembled waiting for QC.xlsx",
        "columns": ("element", "anode", "cathode", "membrane_type", "membrane_code"),
    },
    "ready": {
        "needles": ("ready in shop",),
        "file": "Ready in Shop Elements.xlsx",
        "columns": ("element", "anode", "cathode", "membrane_type", "membrane_code"),
    },
    "mechanical": {
        "needles": ("mechanical problem",),
        "file": "Mechanical Problem Anode-Cathodes.xlsx",
        "columns": ("anode", "cathode"),
    },
    "coating": {
        "needles": ("coating problem",),
        "file": "Coating Problem Anode-Cathodes.xlsx",
        "columns": ("anode", "cathode"),
    },
    "rateoff": {
        "needles": ("rate off",),
        "file": "Rate off Anode-Cathodes.xlsx",
        "columns": ("anode", "cathode"),
    },
    "packed": {
        "needles": ("packed ready",),
        "file": "Packed Ready for send to coating company.xlsx",
        "columns": ("pack", "anode", "cathode"),
    },
    "atcoater": {
        "needles": ("at coating",),
        "file": "Anode-Cathodes at coating company.xlsx",
        "columns": ("anode", "cathode"),
    },
}

_ALIASES: dict[str, set[str]] = {
    "element": {"element", "elementnr", "elementno", "elementnumber", "elementnomber", "شمارهالمان", "شمارهالمنت"},
    "anode": {"anode", "anodenr", "anodeno", "anodenumber", "آند"},
    "cathode": {"cathode", "cathodenr", "cathodeno", "cathodenumber", "kathode", "کاتد"},
    "serial": {"anodecathodenumber", "anodecathodenr", "anodecathodeno", "serial", "شماره"},
    "good": {"reusablegood", "good"},
    "medium": {"reusablemedium", "medium"},
    "recoating": {"recoating", "recoated", "recoat"},
    "purchase": {"newpurchase", "purchase", "purchased"},
    "kind": {"kind", "electrode", "electrodekind", "آندیاکاتد", "نوعقطعه"},
    "membrane_type": {"membranetype", "memebranetype", "membrantype", "تایپممبراین", "نوعممبراین", "تایپممبران"},
    "membrane_code": {"membranecode", "membranenr", "membraneno", "membranenumber", "کدممبراین", "شمارهممبراین", "کدممبران"},
    "quantity": {"quantity", "qty", "count", "تعدادموجودی", "تعداد", "موجودی"},
    "pack": {"packnumber", "packno", "pallet", "palletno", "پالت", "شمارهپالت"},
}


def slot_catalog() -> list[dict[str, Any]]:
    return [
        {"key": key, "file": spec["file"], "columns": list(spec["columns"])}
        for key, spec in SLOTS.items()
    ]


def marker_of(slot: str) -> str:
    return f"{MARKER_PREFIX}{slot}"


def _fold_name(name: str) -> str:
    text = (name or "").replace("\\", "/").split("/")[-1]
    text = text.rsplit(".", 1)[0]
    text = text.translate(_DIGITS).replace("ي", "ی").replace("ك", "ک").lower()
    text = re.sub(r"[^0-9a-z\u0600-\u06ff]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def file_matches(slot: str, filename: str) -> bool:
    folded = _fold_name(filename)
    return any(needle in folded for needle in SLOTS[slot]["needles"])


def _compact_header(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.translate(_DIGITS).replace("\u200c", "").replace("ي", "ی").replace("ك", "ک")
    return re.sub(r"[^0-9a-zA-Z\u0600-\u06ff]+", "", text).lower()


def _cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).translate(_DIGITS).replace("\u200c", "").strip()
    return re.sub(r"\s+", " ", text)


def _blank(value: Any) -> bool:
    text = _cell_text(value).strip(" -—–−*")
    return text == ""


def _is_mark(value: Any) -> bool:
    raw = _cell_text(value).strip().lower()
    if raw in _MARKS:
        return True
    return _compact_header(value) in {"x", "1", "yes", "y", "ok", "true", "بله", "بلی"}


def parse_plant_day(value: Any) -> tuple[date | None, str | None]:
    """Return (day, error). Empty is (None, None). Jalali text and Persian digits are accepted."""
    if value is None or value == "":
        return None, None
    if isinstance(value, datetime):
        if 1200 <= value.year <= 1500:
            return _jalali_day(value.year, value.month, value.day)
        if value.year >= 1905:
            return value.date(), None
        return None, "تاریخ خوانده نشد"
    if isinstance(value, date):
        if 1200 <= value.year <= 1500:
            return _jalali_day(value.year, value.month, value.day)
        if value.year >= 1905:
            return value, None
        return None, "تاریخ خوانده نشد"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        serial = float(value)
        if 1 <= serial < 80000:
            parsed = datetime(1899, 12, 30) + timedelta(days=serial)
            return parse_plant_day(parsed)
        return None, "تاریخ خوانده نشد"
    text = _cell_text(value).strip()
    if not text:
        return None, None
    text = text.replace(".", "/").replace("-", "/")
    match = re.match(
        r"^(\d{4})/(\d{1,2})/(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$",
        text,
    )
    if not match:
        return None, "تاریخ خوانده نشد"
    year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
    if 1200 <= year <= 1500:
        return _jalali_day(year, month, day)
    if year >= 1905:
        try:
            return date(year, month, day), None
        except ValueError:
            return None, "تاریخ خوانده نشد"
    return None, "تاریخ خوانده نشد"


def _jalali_day(year: int, month: int, day: int) -> tuple[date | None, str | None]:
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None, "تاریخ شمسی نادرست است"
    try:
        converted = jalali_to_gregorian(year, month, day)
    except (ValueError, OverflowError):
        return None, "تاریخ شمسی نادرست است"
    if gregorian_to_jalali(converted.year, converted.month, converted.day) != (year, month, day):
        return None, "تاریخ شمسی نادرست است"
    return converted, None


def _read_sheet(content: bytes) -> tuple[list[tuple[Any, ...]], str | None]:
    try:
        workbook = load_workbook(BytesIO(content), data_only=True, read_only=True)
    except Exception:
        return [], "فایل اکسل باز نشد"
    try:
        sheet = workbook.worksheets[0]
        rows = [tuple(row) for row in sheet.iter_rows(values_only=True)]
    finally:
        workbook.close()
    return rows, None


def _map_headers(row: tuple[Any, ...], slot: str) -> dict[str, int] | None:
    needed = set(SLOTS[slot]["columns"])
    found: dict[str, int] = {}
    dates: list[int] = []
    for index, cell in enumerate(row):
        key = _compact_header(cell)
        if not key:
            continue
        if "date" in key or "تاریخ" in key or "tarikh" in key:
            dates.append(index)
        for name, aliases in _ALIASES.items():
            if key in aliases and name not in found:
                found[name] = index
    if not needed <= set(found):
        return None
    if dates:
        found["day"] = dates[0]
    return found


def _locate(rows: list[tuple[Any, ...]], slot: str) -> tuple[dict[str, int] | None, int]:
    for offset, row in enumerate(rows[:8]):
        mapped = _map_headers(row, slot)
        if mapped is not None:
            return mapped, offset
    return None, 0


def _quantity(value: Any) -> tuple[int | None, str | None]:
    text = _cell_text(value).replace(",", "").replace("،", "").strip()
    if not text:
        return None, "تعداد موجودی خالی است"
    try:
        number = float(text)
    except ValueError:
        return None, "تعداد موجودی عدد نیست"
    if number <= 0 or number != int(number):
        return None, "تعداد موجودی باید عدد درست و بزرگ‌تر از صفر باشد"
    return int(number), None


class _Book:
    def __init__(self, db: Session, slot: str, user_name: str | None):
        self.db = db
        self.slot = slot
        self.marker = marker_of(slot)
        self.user_name = (user_name or "launch")[:100]
        self.anodes = load_compact_index(db, models.Anode, "anode_nr")
        self.cathodes = load_compact_index(db, models.Cathode, "cathode_nr")
        self.membranes = load_compact_index(db, models.Membrane, "membrane_nr")
        self.elements = _latest_elements(db)
        self.shop = _shop_by_key(db)
        self.installed = _installed(db)
        self.blocked = _blocked(db, self.marker)
        self.open_assemble = _open_requests(db, WfAssembleRequest)
        self.open_inspection = _open_requests(db, WfInspectionRequest)
        self.open_cell = _open_requests(db, WfCellRequest)
        self.inspection_days = _inspection_days(db)

    def spell(self, kind: str, serial: str) -> str:
        key = compact_nr(serial)
        index = self.anodes if kind == "anode" else self.cathodes
        return index.get(key, serial.strip()[:50])

    def ensure(self, kind: str, serial: str) -> str:
        model = models.Anode if kind == "anode" else models.Cathode
        field = "anode_nr" if kind == "anode" else "cathode_nr"
        index = self.anodes if kind == "anode" else self.cathodes
        ensure_indexed(self.db, model, field, serial, index)
        return self.spell(kind, serial)


def _latest_elements(db: Session) -> dict[str, models.Element]:
    from .warehouse import _life_key

    latest: dict[str, models.Element] = {}
    for el in db.query(models.Element).all():
        key = compact_nr(el.element_nr)
        if not key:
            continue
        prev = latest.get(key)
        if prev is None or _life_key(el) >= _life_key(prev):
            latest[key] = el
    return latest


def _shop_by_key(db: Session) -> dict[str, models.ElementShopState]:
    found: dict[str, models.ElementShopState] = {}
    for row in db.query(models.ElementShopState).all():
        key = compact_nr(row.element_nr)
        if key:
            found[key] = row
    return found


def _installed(db: Session) -> set[tuple[str, str]]:
    busy: set[tuple[str, str]] = set()
    for el in db.query(models.Element.anode_nr, models.Element.cathode_nr, models.Element.disassembly_date).all():
        if el.disassembly_date is not None:
            continue
        for kind, raw in (("anode", el.anode_nr), ("cathode", el.cathode_nr)):
            key = compact_nr(raw)
            if key:
                busy.add((kind, key))
    return busy


def _blocked(db: Session, marker: str) -> dict[tuple[str, str], str]:
    """Serials already written by a different launch file."""
    blocked: dict[tuple[str, str], str] = {}

    def take(kind: str | None, serial: str | None, where: str) -> None:
        key = compact_nr(serial)
        if kind in ("anode", "cathode") and key:
            blocked.setdefault((kind, key), where)

    for row in db.query(models.ElectrodeSegregation).all():
        if _other_marker(row.remarks, marker):
            take((row.electrode_kind or "").lower(), row.serial_nr, "تفکیک راه‌اندازی")
    for model, field in ((models.AnodeRecoating, "anode_nr"), (models.CathodeRecoating, "cathode_nr")):
        kind = "anode" if field == "anode_nr" else "cathode"
        for row in db.query(model).all():
            if _other_marker(row.remarks, marker):
                take(kind, getattr(row, field), "بازگشت از پوشش")
    purchase_ids = {
        row.id
        for row in db.query(WfPurchase).all()
        if _other_marker(row.remarks, marker)
    }
    if purchase_ids:
        for item in db.query(WfPurchaseItem).filter(WfPurchaseItem.purchase_id.in_(purchase_ids)).all():
            take(item.element_kind, item.serial, "خرید نو")
    batch_ids = {
        row.id
        for row in db.query(WfCoatingBatch).all()
        if _other_marker(row.remarks, marker)
    }
    if batch_ids:
        for item in db.query(WfCoatingItem).filter(WfCoatingItem.batch_id.in_(batch_ids)).all():
            take(item.element_kind, item.serial, "پالت پوشش")
    return blocked


def _other_marker(text: str | None, marker: str) -> bool:
    body = text or ""
    return MARKER_PREFIX in body and marker not in body


def _reject(row_no: int, message: str, value: str | None = None) -> dict[str, Any]:
    item = {"row": row_no, "message": message}
    if value:
        item["value"] = value
    return item


def _kind_from_cell(value: Any) -> str | None:
    key = _compact_header(value)
    if key in {"anode", "a", "آند"}:
        return "anode"
    if key in {"cathode", "c", "kathode", "کاتد"}:
        return "cathode"
    return None


def _kind_of(book: _Book, serial: str, hinted: str | None) -> str | None:
    if hinted in ("anode", "cathode"):
        return hinted
    key = compact_nr(serial)
    in_anode = key in book.anodes
    in_cathode = key in book.cathodes
    if in_anode and not in_cathode:
        return "anode"
    if in_cathode and not in_anode:
        return "cathode"
    return None


def import_launch_workbook(
    db: Session,
    slot: str,
    filename: str,
    content: bytes,
    *,
    user_name: str | None,
    dry_run: bool,
) -> dict[str, Any]:
    if slot not in SLOTS:
        return _fail("این بخش شناخته نشد")
    if not file_matches(slot, filename):
        return _fail(
            f"نام فایل با این بخش جور نیست. فایل مورد انتظار: {SLOTS[slot]['file']}"
        )
    rows, error = _read_sheet(content)
    if error:
        return _fail(error)
    headers, header_at = _locate(rows, slot)
    if headers is None:
        return _fail("ستون‌های این فایل با این بخش جور نیست. چیزی نوشته نشد.")
    parsed, rejected = _parse_rows(rows, header_at, headers, slot)
    if not parsed:
        return {
            "ok": False,
            "dry_run": dry_run,
            "slot": slot,
            "accepted": 0,
            "rejected": rejected[:300],
            "rejected_count": len(rejected),
            "error": "ردیف کاملی برای تزریق نیست. هیچ داده‌ای نوشته نشد."
            if rejected
            else "این فایل ردیف داده ندارد. هیچ داده‌ای نوشته نشد.",
        }
    book = _Book(db, slot, user_name)
    accepted, more = _accept(book, slot, parsed)
    rejected.extend(more)
    if not accepted:
        db.rollback()
        return {
            "ok": False,
            "dry_run": dry_run,
            "slot": slot,
            "accepted": 0,
            "rejected": rejected[:300],
            "rejected_count": len(rejected),
            "error": "هیچ ردیفی شرایط نشستن در این بخش را نداشت. هیچ داده‌ای نوشته نشد.",
        }
    try:
        _replace_slot(book)
        written = _write(book, slot, accepted)
        book.db.flush()
        if dry_run:
            db.rollback()
        elif not commit_db(db):
            db.rollback()
            return _fail("پایگاه داده مشغول بود. دوباره تلاش کنید. چیزی قطعی نشد.")
        else:
            clear_cache()
    except Exception:
        db.rollback()
        raise
    return {
        "ok": True,
        "dry_run": dry_run,
        "slot": slot,
        "accepted": written,
        "rejected": rejected[:300],
        "rejected_count": len(rejected),
        "error": None,
    }


def _fail(message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "dry_run": False,
        "slot": None,
        "accepted": 0,
        "rejected": [],
        "rejected_count": 0,
        "error": message,
    }


def _parse_rows(
    rows: list[tuple[Any, ...]],
    header_at: int,
    headers: dict[str, int],
    slot: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    parsed: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for offset, row in enumerate(rows[header_at + 1 :], start=header_at + 2):
        if _row_empty(row):
            continue
        day, day_error = _row_day(row, headers)
        if day_error:
            rejected.append(_reject(offset, day_error))
            continue
        if slot in ("pickup", "disassemble"):
            element = _pick(row, headers, "element")
            if not element:
                rejected.append(_reject(offset, "شماره المان خالی است"))
            else:
                parsed.append({"row": offset, "element": element, "day": day})
        elif slot == "tafkik":
            element, anode, cathode = (_pick(row, headers, name) for name in ("element", "anode", "cathode"))
            missing = [
                label
                for label, value in (("شماره المان", element), ("آند", anode), ("کاتد", cathode))
                if not value
            ]
            if missing:
                rejected.append(_reject(offset, "ناقص است: " + "، ".join(missing)))
            else:
                parsed.append({"row": offset, "element": element, "anode": anode, "cathode": cathode, "day": day})
        elif slot in ("qc", "ready"):
            item = {
                "element": _pick(row, headers, "element"),
                "anode": _pick(row, headers, "anode"),
                "cathode": _pick(row, headers, "cathode"),
                "membrane_type": _pick(row, headers, "membrane_type"),
                "membrane_code": _pick(row, headers, "membrane_code"),
            }
            missing = [
                label
                for label, key in (
                    ("شماره المان", "element"),
                    ("آند", "anode"),
                    ("کاتد", "cathode"),
                    ("نوع ممبراین", "membrane_type"),
                    ("کد ممبراین", "membrane_code"),
                )
                if not item[key]
            ]
            if missing:
                rejected.append(_reject(offset, "ناقص است: " + "، ".join(missing), item["element"] or None))
            else:
                parsed.append({"row": offset, "day": day, **item})
        elif slot == "membrane":
            membrane_type = _pick(row, headers, "membrane_type")
            qty, qty_error = _quantity(_at(row, headers.get("quantity")))
            if not membrane_type:
                rejected.append(_reject(offset, "نوع ممبراین خالی است"))
            elif qty_error:
                rejected.append(_reject(offset, qty_error, membrane_type))
            else:
                parsed.append({"row": offset, "membrane_type": membrane_type, "quantity": qty, "day": day})
        elif slot == "assembly":
            parsed_row, row_rejected = _parse_assembly(row, headers, offset)
            rejected.extend(row_rejected)
            for piece in parsed_row:
                piece["day"] = day
                parsed.append(piece)
        elif slot == "packed":
            pack = _pick(row, headers, "pack")
            anode = _pick(row, headers, "anode")
            cathode = _pick(row, headers, "cathode")
            if not pack:
                rejected.append(_reject(offset, "شماره پالت خالی است"))
                continue
            if not anode and not cathode:
                rejected.append(_reject(offset, "آند و کاتد این ردیف هر دو خالی است", pack))
                continue
            if anode:
                parsed.append({"row": offset, "pack": pack, "kind": "anode", "serial": anode, "day": day})
            if cathode:
                parsed.append({"row": offset, "pack": pack, "kind": "cathode", "serial": cathode, "day": day})
        else:
            anode = _pick(row, headers, "anode")
            cathode = _pick(row, headers, "cathode")
            if not anode and not cathode:
                rejected.append(_reject(offset, "آند و کاتد این ردیف هر دو خالی است"))
                continue
            if anode:
                parsed.append({"row": offset, "kind": "anode", "serial": anode, "day": day})
            if cathode:
                parsed.append({"row": offset, "kind": "cathode", "serial": cathode, "day": day})
    return _drop_duplicates(slot, parsed, rejected)


def _parse_assembly(
    row: tuple[Any, ...], headers: dict[str, int], row_no: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    number = _pick(row, headers, "serial")
    hinted = _kind_from_cell(_at(row, headers.get("kind"))) if "kind" in headers else None
    if "kind" in headers and _at(row, headers.get("kind")) not in (None, "") and hinted is None and not _blank(_at(row, headers["kind"])):
        return [], [_reject(row_no, "نوع قطعه باید آند یا کاتد باشد", number or None)]
    filled: list[tuple[str, Any]] = []
    for category in ("good", "medium", "recoating", "purchase"):
        value = _at(row, headers.get(category))
        if not _blank(value):
            filled.append((category, value))
    if number and len(filled) == 1 and (_is_mark(filled[0][1]) or compact_nr(_cell_text(filled[0][1])) == compact_nr(number)):
        return [{"row": row_no, "serial": number, "category": filled[0][0], "kind_hint": hinted}], []
    if number and len(filled) == 0:
        return [], [_reject(row_no, "وضعیت قطعه (خوب، متوسط، ریکوت، خرید نو) مشخص نیست", number)]
    if number and len(filled) > 1:
        return [], [_reject(row_no, "برای یک شماره بیش از یک وضعیت علامت خورده است", number)]
    pieces = []
    rejected = []
    for category, value in filled:
        if _is_mark(value):
            rejected.append(_reject(row_no, "شماره قطعه خالی است"))
        else:
            pieces.append({"row": row_no, "serial": _cell_text(value), "category": category, "kind_hint": hinted})
    return pieces, rejected


def _drop_duplicates(
    slot: str,
    parsed: list[dict[str, Any]],
    rejected: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if slot == "membrane":
        key_of = lambda item: _compact_header(item["membrane_type"])
        label = "نوع ممبراین"
    elif slot in ("pickup", "disassemble", "tafkik", "qc", "ready"):
        key_of = lambda item: compact_nr(item["element"])
        label = "شماره المان"
    elif slot == "packed":
        key_of = lambda item: (item["kind"], compact_nr(item["serial"]))
        label = "شماره قطعه"
    else:
        key_of = lambda item: compact_nr(item["serial"])
        label = "شماره قطعه"
    counts: dict[Any, int] = {}
    for item in parsed:
        counts[key_of(item)] = counts.get(key_of(item), 0) + 1
    kept = []
    for item in parsed:
        if counts[key_of(item)] > 1:
            rejected.append(_reject(item["row"], f"این {label} در فایل تکرار شده و تزریق نشد", _show(item)))
        else:
            kept.append(item)
    return kept, rejected


def _show(item: dict[str, Any]) -> str:
    return str(item.get("element") or item.get("serial") or item.get("membrane_type") or item.get("pack") or "")


def _row_empty(row: tuple[Any, ...]) -> bool:
    return all(_blank(cell) for cell in row)


def _at(row: tuple[Any, ...], index: int | None) -> Any:
    if index is None or index >= len(row):
        return None
    return row[index]


def _pick(row: tuple[Any, ...], headers: dict[str, int], name: str) -> str:
    return _cell_text(_at(row, headers.get(name))).strip()


def _row_day(row: tuple[Any, ...], headers: dict[str, int]) -> tuple[date | None, str | None]:
    if "day" not in headers:
        return None, None
    value = _at(row, headers["day"])
    if _blank(value):
        return None, None
    return parse_plant_day(value)


def _accept(book: _Book, slot: str, parsed: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for item in parsed:
        reason = _screen(book, slot, item)
        if reason:
            rejected.append(_reject(item["row"], reason, _show(item)))
        else:
            accepted.append(item)
    return accepted, rejected


def _screen(book: _Book, slot: str, item: dict[str, Any]) -> str | None:
    if slot == "pickup":
        return _screen_pickup(book, item["element"])
    if slot == "disassemble":
        return _screen_disassemble(book, item["element"])
    if slot == "tafkik":
        return _screen_tafkik(book, item)
    if slot in ("qc", "ready"):
        return _screen_built(book, item, slot)
    if slot == "membrane":
        return None
    if slot == "assembly":
        kind = _kind_of(book, item["serial"], item.get("kind_hint"))
        if kind is None:
            return "از روی شماره مشخص نیست آند است یا کاتد. ردیف تزریق نشد"
        item["kind"] = kind
        return _screen_serial(book, kind, item["serial"])
    return _screen_serial(book, item["kind"], item["serial"])


def _screen_pickup(book: _Book, element: str) -> str | None:
    el = book.elements.get(compact_nr(element))
    if el is None:
        return "شماره المان در اطلاعات المان‌ها نیست"
    base = _base_state(el)
    if base == "disassembled":
        return "این المان دمونتاژ شده و دیگر منتظر انتقال به سل‌شاپ نیست"
    if base == "in_service":
        return "این المان هنوز در سرویس است و تاریخ خروج ندارد"
    if base == "installed":
        return "این المان روی الکترولایزر است و تاریخ خروج ندارد"
    if base != "decommissioned":
        return "این المان از مدار خارج نشده است"
    shop = book.shop.get(compact_nr(element))
    if shop is not None and shop.note == marker_of("disassemble"):
        return "این المان در فایل منتظر دمونتاژ ثبت شده است"
    if _live_open(book, book.open_cell, element) is not None:
        return "برای این المان یک فرآیند سل باز است"
    return None


def _screen_disassemble(book: _Book, element: str) -> str | None:
    el = book.elements.get(compact_nr(element))
    if el is None:
        return "شماره المان در اطلاعات المان‌ها نیست"
    base = _base_state(el)
    if base == "disassembled":
        return "این المان قبلاً دمونتاژ شده است"
    if base == "in_service":
        return "این المان هنوز در سرویس است"
    if base == "installed":
        return "این المان روی الکترولایزر است و تاریخ خروج ندارد"
    if base != "decommissioned":
        return "این المان از مدار خارج نشده است. تاریخ خروج باید در اطلاعات المان باشد"
    shop = book.shop.get(compact_nr(element))
    if shop is not None and (shop.note or "").startswith(MARKER_PREFIX) and shop.note != book.marker:
        return "این المان در فایل دیگر راه‌اندازی ثبت شده است"
    if _live_open(book, book.open_cell, element) is not None:
        return "برای این المان یک فرآیند سل باز است"
    return None


def _screen_tafkik(book: _Book, item: dict[str, Any]) -> str | None:
    el = book.elements.get(compact_nr(item["element"]))
    if el is None:
        return "شماره المان در اطلاعات المان‌ها نیست"
    if _base_state(el) != "disassembled":
        return "تاریخ دمونتاژ در اطلاعات المان نیست. ردیف تزریق نشد"
    mismatch = _part_conflict(el.anode_nr, item["anode"]) or _part_conflict(el.cathode_nr, item["cathode"])
    if mismatch:
        return "شماره آند یا کاتد با اطلاعات المان یکی نیست"
    existing = book.open_inspection.get(compact_nr(item["element"]))
    if existing is not None and book.marker not in (existing.last_note or ""):
        if _part_conflict(existing.anode_nr, item["anode"]) or _part_conflict(existing.cathode_nr, item["cathode"]):
            return "فرآیند بازرسی باز این المان شماره قطعه دیگری دارد"
    return None


def _screen_built(book: _Book, item: dict[str, Any], slot: str) -> str | None:
    key = compact_nr(item["element"])
    el = book.elements.get(key)
    if el is not None and not _launch_shell(el, book.marker):
        base = _base_state(el)
        if base != "new":
            return "این المان در سرویس، نصب‌شده، خارج‌شده یا دمونتاژشده است و در صف اسمبل نمی‌نشیند"
        if (
            _part_conflict(el.anode_nr, item["anode"])
            or _part_conflict(el.cathode_nr, item["cathode"])
            or _part_conflict(el.membrane_nr, item["membrane_code"])
            or _part_conflict(el.membrane_type, item["membrane_type"])
        ):
            return "قطعات این ردیف با اطلاعات فعلی المان یکی نیست"
    shop = book.shop.get(key)
    if shop is not None and (shop.note or "").startswith(MARKER_PREFIX) and shop.note != book.marker:
        return "این المان در فایل دیگر راه‌اندازی ثبت شده است"
    open_request = book.open_assemble.get(compact_nr(item["element"]))
    if open_request is not None and book.marker not in (open_request.last_note or ""):
        return "برای این المان یک فرآیند اسمبل باز وجود دارد"
    other = marker_of("qc" if slot == "ready" else "ready")
    if open_request is not None and other in (open_request.last_note or ""):
        return "این المان در فایل دیگر راه‌اندازی ثبت شده است"
    membrane = book.membranes.get(compact_nr(item["membrane_code"]))
    if membrane:
        master = book.db.get(models.Membrane, membrane)
        if master is not None and (master.membrane_type or "").strip() and _part_conflict(master.membrane_type, item["membrane_type"]):
            return "نوع ممبراین با شناسنامه همین کد یکی نیست"
    return None


def _screen_serial(book: _Book, kind: str, serial: str) -> str | None:
    key = compact_nr(serial)
    if not key:
        return "شماره قطعه خالی است"
    if (kind, key) in book.installed:
        return "این قطعه روی المانی است که هنوز دمونتاژ نشده"
    where = book.blocked.get((kind, key))
    if where:
        return f"این قطعه قبلاً با فایل دیگر راه‌اندازی در «{where}» نشسته است"
    return None


def _part_conflict(current: str | None, incoming: str) -> bool:
    if not (current or "").strip():
        return False
    return compact_nr(current) != compact_nr(incoming) and _compact_header(current) != _compact_header(incoming)


def _launch_shell(el: models.Element, marker: str) -> bool:
    return (el.remarks or "") == marker and not any(
        (
            el.electrolyzer,
            el.position,
            el.commissioning_date,
            el.decommissioning_date,
            el.disassembly_date,
        )
    )


def _live_open(book: _Book, mapping: dict[str, Any], element: str | None):
    """An open request that was not created by any launch file."""
    row = mapping.get(compact_nr(element))
    note = getattr(row, "last_note", None) or ""
    if row is None or note.startswith(MARKER_PREFIX):
        return None
    return row


def _open_requests(db: Session, model) -> dict[str, Any]:
    found: dict[str, Any] = {}
    for row in db.query(model).filter(model.status.notin_(_CLOSED)).all():
        key = compact_nr(row.element_nr)
        if key:
            found[key] = row
    return found


def _inspection_days(db: Session) -> dict[tuple[str, str], date]:
    found: dict[tuple[str, str], date] = {}
    for row in db.query(models.ElectrodeSegregation).all():
        kind = (row.electrode_kind or "").lower()
        key = compact_nr(row.serial_nr)
        current = _as_date(row.inspection_date)
        if kind in ("anode", "cathode") and key and current:
            prev = found.get((kind, key))
            if prev is None or current > prev:
                found[(kind, key)] = current
    return found


def _replace_slot(book: _Book) -> None:
    slot = book.slot
    db = book.db
    marker = book.marker
    if slot == "pickup":
        _drop_marked(book, WfCellRequest, "cell")
    elif slot == "disassemble":
        _clear_marked_shop(book)
        _drop_marked(book, WfCellRequest, "cell")
    elif slot == "tafkik":
        _drop_marked(book, WfInspectionRequest, "inspection")
    elif slot in ("qc", "ready"):
        _clear_marked_shop(book)
        _drop_assemble(book)
        for el in list(db.query(models.Element).all()):
            if _launch_shell(el, marker):
                for wo in db.query(WfWorkOrder).filter(WfWorkOrder.element_nr == el.element_nr, WfWorkOrder.status == "open"):
                    if wo.created_by_name == book.user_name:
                        _erase_flow(db, "workorder", wo.id)
                        db.delete(wo)
                book.elements.pop(compact_nr(el.element_nr), None)
                db.delete(el)
    elif slot == "membrane":
        for row in db.query(MembraneStock).all():
            if row.note == marker:
                db.delete(row)
        for row in db.query(MembraneStockMove).all():
            if row.note == marker:
                db.delete(row)
    elif slot == "assembly":
        _delete_marked(db, models.ElectrodeSegregation, "remarks", marker)
        _delete_marked(db, models.AnodeRecoating, "remarks", marker)
        _delete_marked(db, models.CathodeRecoating, "remarks", marker)
        _delete_purchases(db, marker)
    elif slot in ("mechanical", "coating", "rateoff"):
        _delete_marked(db, models.ElectrodeSegregation, "remarks", marker)
    elif slot in ("packed", "atcoater"):
        _delete_coating(book)
    db.flush()


def _erase_flow(db: Session, flow: str, record_id: int) -> None:
    db.query(WfEvent).filter(WfEvent.flow == flow, WfEvent.record_id == record_id).delete(synchronize_session=False)
    db.query(WfNotification).filter(WfNotification.flow == flow, WfNotification.record_id == record_id).delete(synchronize_session=False)


def _drop_marked(book: _Book, model, flow: str) -> None:
    for row in book.db.query(model).all():
        if book.marker not in (row.last_note or "") or row.status in _CLOSED:
            continue
        _erase_flow(book.db, flow, row.id)
        book.db.delete(row)


def _drop_assemble(book: _Book) -> None:
    for row in book.db.query(WfAssembleRequest).all():
        if book.marker not in (row.last_note or "") or row.status in _CLOSED:
            continue
        air_id = (row.decisions or {}).get("air_id") if isinstance(row.decisions, dict) else None
        report = book.db.get(models.AssemblyInspectionReport, air_id) if air_id else None
        if report is not None and report.remarks == book.marker:
            book.db.delete(report)
        _erase_flow(book.db, "assemble", row.id)
        book.db.delete(row)


def _announce(book: _Book, flow: str, record: Any, steps: list[tuple[str, str | None, str]], groups: list[str]) -> None:
    """History of the steps already passed, then tell the people who own the current step."""
    from .routers.workflow import _members, _title

    now = datetime.now()
    for action, src, dst in steps:
        book.db.add(
            WfEvent(
                flow=flow,
                record_id=record.id,
                action=action,
                from_status=src,
                to_status=dst,
                actor_name=book.user_name[:150],
                data={"launch": book.slot},
                created_at=now,
            )
        )
    title = _title(flow, record, book.db)[:200]
    for uid in _members(book.db, groups):
        book.db.add(
            WfNotification(
                user_id=uid,
                flow=flow,
                record_id=record.id,
                status=record.status,
                title=title,
                from_name=book.user_name[:150],
                created_at=now,
            )
        )


def _delete_marked(db: Session, model, field: str, marker: str) -> None:
    for row in db.query(model).all():
        if marker in (getattr(row, field) or ""):
            db.delete(row)


def _delete_purchases(db: Session, marker: str) -> None:
    for row in db.query(WfPurchase).all():
        if marker in (row.remarks or ""):
            for item in db.query(WfPurchaseItem).filter(WfPurchaseItem.purchase_id == row.id).all():
                db.delete(item)
            db.delete(row)


def _delete_coating(book: _Book) -> None:
    db = book.db
    batches = [row for row in db.query(WfCoatingBatch).all() if book.marker in (row.remarks or "")]
    serials: list[tuple[str, str]] = []
    for batch in batches:
        items = db.query(WfCoatingItem).filter(WfCoatingItem.batch_id == batch.id).all()
        if book.slot == "atcoater":
            serials.extend((item.element_kind, item.serial) for item in items)
        for item in items:
            db.delete(item)
        _erase_flow(db, "coating", batch.id)
        for package in db.query(WfCoatingPackage).filter(WfCoatingPackage.batch_id == batch.id).all():
            db.delete(package)
        db.delete(batch)
    db.flush()
    for kind, serial in serials:
        state = (
            db.query(models.WhElementState)
            .filter(models.WhElementState.element_kind == kind, models.WhElementState.serial == serial)
            .first()
        )
        if state is not None and state.lifecycle_status == "at_coater" and state.open_dispatch_id is None and state.company_id is None:
            state.lifecycle_status = "in_plant"


def _clear_marked_shop(book: _Book) -> None:
    for row in list(book.db.query(models.ElementShopState).all()):
        if row.note == book.marker:
            book.db.add(
                models.ElementShopEvent(
                    element_nr=row.element_nr,
                    from_stage=row.stage,
                    to_stage="clear",
                    note=book.marker,
                    user=book.user_name,
                    created_at=datetime.now(),
                )
            )
            book.shop.pop(compact_nr(row.element_nr), None)
            book.db.delete(row)


def _write(book: _Book, slot: str, accepted: list[dict[str, Any]]) -> int:
    if slot == "pickup":
        return _write_pickup(book, accepted)
    if slot == "disassemble":
        return _write_stage(book, accepted, "awaiting_disassembly")
    if slot == "tafkik":
        return _write_tafkik(book, accepted)
    if slot == "qc":
        return _write_built(book, accepted, "awaiting_qc", "await_insp_sign")
    if slot == "ready":
        return _write_built(book, accepted, "ready", "await_position")
    if slot == "membrane":
        return _write_membranes(book, accepted)
    if slot == "assembly":
        return _write_assembly(book, accepted)
    if slot in ("mechanical", "coating", "rateoff"):
        return _write_outcomes(book, accepted, slot)
    if slot == "packed":
        return _write_packed(book, accepted)
    if slot == "atcoater":
        return _write_at_coater(book, accepted)
    return 0


def _write_pickup(book: _Book, accepted: list[dict[str, Any]]) -> int:
    for item in accepted:
        el = book.elements[compact_nr(item["element"])]
        shop = book.shop.get(compact_nr(item["element"]))
        if shop is not None:
            book.db.add(
                models.ElementShopEvent(
                    element_nr=shop.element_nr,
                    from_stage=shop.stage,
                    to_stage="clear",
                    note=book.marker,
                    user=book.user_name,
                    created_at=datetime.now(),
                )
            )
            book.shop.pop(compact_nr(item["element"]), None)
            book.db.delete(shop)
        _open_cell_flow(book, el, "pickup")
    return len(accepted)


def _write_stage(book: _Book, accepted: list[dict[str, Any]], stage: str) -> int:
    for item in accepted:
        el = book.elements[compact_nr(item["element"])]
        _put_shop(book, el, stage, item.get("day"))
        if stage == "awaiting_disassembly":
            _open_cell_flow(book, el, "disassemble")
    return len(accepted)


def _open_cell_flow(book: _Book, el: models.Element, kind: str) -> None:
    if _live_open(book, book.open_cell, el.element_nr) is not None:
        return
    previous = book.open_cell.get(compact_nr(el.element_nr))
    if previous is not None and book.marker not in (previous.last_note or ""):
        _erase_flow(book.db, "cell", previous.id)
        book.db.delete(previous)
        book.db.flush()
        book.open_cell.pop(compact_nr(el.element_nr), None)
    day = _as_date(el.decommissioning_date) or date.today()
    seq, code = _fresh_code(book.db, WfCellRequest, "CR", day)
    if kind == "pickup":
        status = "await_shop"
        decision = None
        steps = [("created", None, "await_shutdown"), ("shutdown", "await_shutdown", "await_shop")]
        groups = ["cellshop"]
    else:
        status = "await_disassembly"
        decision = "disassemble"
        steps = [
            ("created", None, "await_shutdown"),
            ("shutdown", "await_shutdown", "await_shop"),
            ("receive", "await_shop", "in_shop"),
            ("decide", "in_shop", "await_disassembly"),
        ]
        groups = ["c90"]
    row = WfCellRequest(
        code=code,
        seq=seq,
        status=status,
        request_kind="removal",
        element_nr=(el.element_nr or "")[:50],
        element_id=el.id,
        electrolyzer=el.electrolyzer,
        position=el.position,
        reason=((el.decommission_reason or "").strip() or "خارج از مدار")[:800],
        decommission_date=day,
        decision=decision,
        last_note=book.marker,
        created_by_name=book.user_name,
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    book.db.add(row)
    book.db.flush()
    book.open_cell[compact_nr(el.element_nr)] = row
    _announce(book, "cell", row, steps, groups)


def _put_shop(book: _Book, el: models.Element, stage: str, day: date | None) -> None:
    shown = (el.element_nr or "").strip()[:50]
    key = compact_nr(shown)
    row = book.shop.get(key)
    previous = row.stage if row is not None else None
    if row is None:
        row = models.ElementShopState(element_nr=shown, stage=stage)
        book.db.add(row)
        book.shop[key] = row
    row.stage = stage
    row.note = book.marker
    row.updated_by = book.user_name
    row.updated_at = _stage_stamp(el, day)
    book.db.add(
        models.ElementShopEvent(
            element_nr=shown,
            from_stage=previous,
            to_stage=stage,
            note=book.marker,
            user=book.user_name,
            created_at=row.updated_at,
        )
    )


def _stage_stamp(el: models.Element, day: date | None) -> datetime:
    event = _event_date(el)
    stamp_day = day or date.today()
    if event and event > stamp_day:
        stamp_day = event
    return datetime.combine(stamp_day, datetime.now().time().replace(microsecond=0))


def _write_tafkik(book: _Book, accepted: list[dict[str, Any]]) -> int:
    written = 0
    for item in accepted:
        el = book.elements[compact_nr(item["element"])]
        anode = book.ensure("anode", item["anode"])
        cathode = book.ensure("cathode", item["cathode"])
        if not (el.anode_nr or "").strip():
            el.anode_nr = anode
        if not (el.cathode_nr or "").strip():
            el.cathode_nr = cathode
        existing = _open_inspection(book, el.element_nr or item["element"])
        if existing is not None and book.marker not in (existing.last_note or ""):
            if not (existing.anode_nr or "").strip():
                existing.anode_nr = anode
            if not (existing.cathode_nr or "").strip():
                existing.cathode_nr = cathode
            written += 1
            continue
        day = item.get("day") or _event_date(el) or date.today()
        seq, code = _fresh_code(book.db, WfInspectionRequest, "DS", day)
        request = WfInspectionRequest(
            code=code,
            seq=seq,
            status="await_inspection",
            element_nr=(el.element_nr or item["element"])[:50],
            element_id=el.id,
            electrolyzer=el.electrolyzer,
            position=el.position,
            anode_nr=anode,
            cathode_nr=cathode,
            membrane_nr=el.membrane_nr,
            disassembly_date=_as_date(el.disassembly_date),
            reason=(el.decommission_reason or None),
            last_note=book.marker,
            created_by_name=book.user_name,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        book.db.add(request)
        book.db.flush()
        book.open_inspection[compact_nr(request.element_nr)] = request
        _announce(
            book,
            "inspection",
            request,
            [("created", None, "await_request"), ("send", "await_request", "await_inspection")],
            ["inspection", "process"],
        )
        written += 1
    return written


def _open_inspection(book: _Book, element: str) -> WfInspectionRequest | None:
    return book.open_inspection.get(compact_nr(element))


def _write_built(book: _Book, accepted: list[dict[str, Any]], stage: str, status: str) -> int:
    for item in accepted:
        el = _ensure_built_element(book, item)
        _ensure_membrane(book, item["membrane_code"], item["membrane_type"])
        anode = book.ensure("anode", item["anode"])
        cathode = book.ensure("cathode", item["cathode"])
        el.anode_nr = el.anode_nr or anode
        el.cathode_nr = el.cathode_nr or cathode
        el.membrane_nr = el.membrane_nr or item["membrane_code"][:50]
        el.membrane_type = el.membrane_type or item["membrane_type"][:100]
        book.elements[compact_nr(el.element_nr)] = el
        book.installed.add(("anode", compact_nr(anode)))
        book.installed.add(("cathode", compact_nr(cathode)))
        day = item.get("day") or date.today()
        if el.assembly_date is None:
            el.assembly_date = day
        _put_shop(book, el, stage, day)
        seq, code = _fresh_code(book.db, WfAssembleRequest, "AS", day)
        request = WfAssembleRequest(
            code=code,
            seq=seq,
            status=status,
            element_nr=(el.element_nr or "")[:50],
            element_id=el.id,
            anode_nr=anode,
            cathode_nr=cathode,
            membrane_nr=item["membrane_code"][:50],
            membrane_type=item["membrane_type"][:100],
            assembly_date=day,
            last_note=book.marker,
            created_by_name=book.user_name,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        book.db.add(request)
        book.db.flush()
        _pin_assembly_form(book, request, day)
        if status == "await_insp_sign":
            steps = [
                ("created", None, "await_assembly"),
                ("assemble", "await_assembly", "await_air"),
                ("submit_air", "await_air", "await_insp_sign"),
            ]
            groups = ["inspection"]
        else:
            steps = [
                ("created", None, "await_assembly"),
                ("assemble", "await_assembly", "await_air"),
                ("submit_air", "await_air", "await_insp_sign"),
                ("sign_insp", "await_insp_sign", "await_proc_sign"),
                ("sign_proc", "await_proc_sign", "await_position"),
            ]
            groups = ["c90"]
        _announce(book, "assemble", request, steps, groups)
        from .routers.work_orders import ensure_work_order_process

        ensure_work_order_process(book.db, request.element_nr, "generation", _LaunchActor(book.user_name), day=day)
        book.db.flush()
    return len(accepted)


class _LaunchActor:
    def __init__(self, name: str):
        self.username = name
        self.full_name = name
        self.id = None


def _pin_assembly_form(book: _Book, request: WfAssembleRequest, day: date) -> None:
    from .assembly_inspection_def import empty_check_remarks, empty_checks

    report = models.AssemblyInspectionReport(
        assembly_date=day,
        element_nr=request.element_nr,
        anode_nr=request.anode_nr,
        cathode_nr=request.cathode_nr,
        membrane_nr=request.membrane_nr,
        membrane_type=request.membrane_type,
        checks=empty_checks(),
        check_remarks=empty_check_remarks(),
        remarks=book.marker,
    )
    book.db.add(report)
    book.db.flush()
    request.decisions = {"air_id": report.id}


def _ensure_built_element(book: _Book, item: dict[str, Any]) -> models.Element:
    key = compact_nr(item["element"])
    el = book.elements.get(key)
    if el is not None:
        return el
    el = models.Element(element_nr=item["element"][:50], remarks=book.marker)
    book.db.add(el)
    book.db.flush()
    book.elements[key] = el
    return el


def _ensure_membrane(book: _Book, code: str, membrane_type: str) -> None:
    key = compact_nr(code)
    if key in book.membranes:
        return
    stored = code.strip()[:50]
    book.db.add(models.Membrane(membrane_nr=stored, membrane_type=membrane_type[:100], remarks=book.marker))
    book.membranes[key] = stored


def _write_membranes(book: _Book, accepted: list[dict[str, Any]]) -> int:
    today = date.today()
    for item in accepted:
        day = item.get("day") or today
        book.db.add(
            MembraneStock(
                membrane_type=item["membrane_type"][:100],
                serial=None,
                quantity=item["quantity"],
                purchase_date=day,
                note=book.marker,
                created_by_name=book.user_name,
                created_at=datetime.now(),
            )
        )
        book.db.add(
            MembraneStockMove(
                kind="adjust",
                membrane_type=item["membrane_type"][:100],
                quantity=item["quantity"],
                move_date=day,
                purchase_date=day,
                from_stock=True,
                note=book.marker,
                user_name=book.user_name,
                created_at=datetime.now(),
            )
        )
    return len(accepted)


def _write_assembly(book: _Book, accepted: list[dict[str, Any]]) -> int:
    purchases: list[tuple[str, str, date]] = []
    for item in accepted:
        kind = item["kind"]
        serial = book.ensure(kind, item["serial"])
        day = item.get("day") or _decision_day(book, kind, serial)
        category = item["category"]
        if category in ("good", "medium"):
            quality = "good" if category == "good" else "medium"
            _add_segregation(
                book,
                kind,
                serial,
                day,
                decision="قابل استفاده",
                coating_quality=quality,
                segregation=quality,
                remarks="Inspection: قابل استفاده\nProcess: قابل استفاده\n" + book.marker,
            )
        elif category == "recoating":
            model = models.AnodeRecoating if kind == "anode" else models.CathodeRecoating
            field = "anode_nr" if kind == "anode" else "cathode_nr"
            book.db.add(model(**{field: serial, "return_date": datetime.combine(day, datetime.min.time()), "remarks": book.marker}))
        else:
            purchases.append((kind, serial, day))
    if purchases:
        _add_purchase(book, purchases)
    return len(accepted)


def _write_outcomes(book: _Book, accepted: list[dict[str, Any]], slot: str) -> int:
    decision = {"mechanical": "مشکل مکانیکی", "coating": "مشکل پوشش", "rateoff": "Rate off"}[slot]
    for item in accepted:
        serial = book.ensure(item["kind"], item["serial"])
        day = item.get("day") or _decision_day(book, item["kind"], serial)
        _add_segregation(book, item["kind"], serial, day, decision=decision, remarks=book.marker)
    return len(accepted)


def _decision_day(book: _Book, kind: str, serial: str) -> date:
    """Stay at least as new as the previous segregation row so this decision is the one on screen."""
    previous = book.inspection_days.get((kind, compact_nr(serial)))
    today = date.today()
    if previous and previous > today:
        return previous
    return today


def _add_segregation(
    book: _Book,
    kind: str,
    serial: str,
    day: date,
    *,
    decision: str,
    remarks: str,
    coating_quality: str | None = None,
    segregation: str | None = None,
) -> None:
    book.db.add(
        models.ElectrodeSegregation(
            serial_nr=serial[:50],
            electrode_kind=kind,
            inspection_date=day,
            decision=decision,
            coating_quality=coating_quality,
            segregation=segregation,
            remarks=remarks,
        )
    )


def _add_purchase(book: _Book, pieces: list[tuple[str, str, date]]) -> None:
    company = book.db.query(models.WhCompany).filter(models.WhCompany.name == "خرید نو").first()
    if company is None:
        company = models.WhCompany(name="خرید نو", is_supplier=True, is_coating=False, remarks=book.marker, created_at=datetime.now())
        book.db.add(company)
        book.db.flush()
    elif not company.is_supplier:
        company.is_supplier = True
    day = max(piece[2] for piece in pieces)
    seq, code = _fresh_code(book.db, WfPurchase, "LP", day)
    purchase = WfPurchase(
        code=code,
        seq=seq,
        status="completed",
        supplier_id=company.id,
        anode_count=sum(1 for kind, _, _ in pieces if kind == "anode"),
        cathode_count=sum(1 for kind, _, _ in pieces if kind == "cathode"),
        request_date=day,
        delivery_date=day,
        remarks=book.marker,
        created_by_name=book.user_name,
        created_at=datetime.now(),
        updated_at=datetime.now(),
        completed_at=datetime.now(),
    )
    book.db.add(purchase)
    book.db.flush()
    for kind, serial, _day in pieces:
        book.db.add(WfPurchaseItem(purchase_id=purchase.id, element_kind=kind, serial=serial, registered_at=datetime.now()))


def _write_packed(book: _Book, accepted: list[dict[str, Any]]) -> int:
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in accepted:
        groups.setdefault(item["pack"], []).append(item)
    for pack, pieces in groups.items():
        code = pack.strip()[:40]
        seq = _next_seq(book.db, WfCoatingPackage.seq)
        batch = WfCoatingBatch(
            status="await_dispatch",
            anode_count=sum(1 for piece in pieces if piece["kind"] == "anode"),
            cathode_count=sum(1 for piece in pieces if piece["kind"] == "cathode"),
            pallet_size=max(1, len(pieces)),
            remarks=book.marker,
            last_note=code,
            created_by_name=book.user_name,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        book.db.add(batch)
        book.db.flush()
        package = WfCoatingPackage(batch_id=batch.id, code=_free_code(book.db, code), seq=seq, pallet_no=1, created_at=datetime.now())
        book.db.add(package)
        book.db.flush()
        for line_no, piece in enumerate(pieces, start=1):
            serial = book.ensure(piece["kind"], piece["serial"])
            book.db.add(
                WfCoatingItem(
                    batch_id=batch.id,
                    package_id=package.id,
                    line_no=line_no,
                    element_kind=piece["kind"],
                    serial=serial,
                )
            )
        book.db.flush()
        _announce(book, "coating", batch, [("created", None, "await_dispatch")], ["procurement"])
    return len(accepted)


def _write_at_coater(book: _Book, accepted: list[dict[str, Any]]) -> int:
    from .warehouse_lifecycle import upsert_state

    day = date.today()
    seq = _next_seq(book.db, WfCoatingPackage.seq)
    batch = WfCoatingBatch(
        status="await_return",
        anode_count=sum(1 for piece in accepted if piece["kind"] == "anode"),
        cathode_count=sum(1 for piece in accepted if piece["kind"] == "cathode"),
        pallet_size=max(1, len(accepted)),
        dispatch_date=day,
        remarks=book.marker,
        created_by_name=book.user_name,
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    book.db.add(batch)
    book.db.flush()
    package = WfCoatingPackage(
        batch_id=batch.id,
        code=_free_code(book.db, "AT-COATER"),
        seq=seq,
        pallet_no=1,
        dispatch_date=day,
        created_at=datetime.now(),
    )
    book.db.add(package)
    book.db.flush()
    for line_no, piece in enumerate(accepted, start=1):
        serial = book.ensure(piece["kind"], piece["serial"])
        book.db.add(
            WfCoatingItem(
                batch_id=batch.id,
                package_id=package.id,
                line_no=line_no,
                element_kind=piece["kind"],
                serial=serial,
            )
        )
        upsert_state(book.db, piece["kind"], serial, lifecycle_status="at_coater")
    book.db.flush()
    _announce(book, "coating", batch, [("created", None, "await_return")], ["procurement"])
    return len(accepted)


def _free_code(db: Session, wanted: str) -> str:
    code = wanted[:40] or "PALLET"
    if db.query(WfCoatingPackage).filter(WfCoatingPackage.code == code).first() is None:
        return code
    seq = _next_seq(db, WfCoatingPackage.seq)
    return f"{code[:30]}-{seq}"[:40]


def _next_seq(db: Session, column) -> int:
    current = int(db.query(func.max(column)).scalar() or 0)
    pending = [
        int(getattr(obj, column.key) or 0)
        for obj in list(db.new)
        if hasattr(obj, column.key) and getattr(obj, column.key)
    ]
    return max([current, *pending]) + 1


def _fresh_code(db: Session, model, prefix: str, day: date) -> tuple[int, str]:
    seq = _next_seq(db, model.seq)
    code = _code(prefix, day, seq)
    while db.query(model).filter(model.code == code).first() is not None:
        seq += 1
        code = _code(prefix, day, seq)
    return seq, code


def _code(prefix: str, day: date, seq: int) -> str:
    return f"{prefix}-{day:%Y%m%d}-{seq:04d}"


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None
