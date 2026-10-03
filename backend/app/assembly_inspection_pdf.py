"""PDF export matching Uhde Assembly Inspection Report layout."""
from __future__ import annotations

import base64
import io
from datetime import date, datetime
from typing import Any

from fastapi.responses import StreamingResponse
from reportlab.lib.colors import Color, black, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from pathlib import Path

from . import models
from .assembly_inspection_def import ACTIVITY_SECTIONS

NAVY = Color(0.04, 0.12, 0.29)
LIGHT = Color(0.94, 0.95, 0.97)
OK_FILL = Color(0.85, 0.95, 0.88)

_FONT_OK = False
_ROOT = Path(__file__).resolve().parents[2]


def _ensure_fonts() -> None:
    global _FONT_OK
    if _FONT_OK:
        return
    fonts = _ROOT / "docs" / "fonts"
    try:
        pdfmetrics.registerFont(TTFont("Vazir", str(fonts / "Vazirmatn-Regular.ttf")))
        pdfmetrics.registerFont(TTFont("Vazir-Bold", str(fonts / "Vazirmatn-Bold.ttf")))
        _FONT_OK = True
    except Exception:
        _FONT_OK = False


def _font(bold: bool = False) -> str:
    _ensure_fonts()
    if _FONT_OK:
        return "Vazir-Bold" if bold else "Vazir"
    return "Helvetica-Bold" if bold else "Helvetica"


def _txt(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _image(data_url: str | None) -> ImageReader | None:
    raw = (data_url or "").strip()
    if not raw.startswith("data:image") or "," not in raw:
        return None
    try:
        payload = base64.b64decode(raw.split(",", 1)[1], validate=False)
        return ImageReader(io.BytesIO(payload))
    except Exception:
        return None


def _box(c: canvas.Canvas, x: float, y: float, w: float, h: float, fill: Color | None = None) -> None:
    if fill is not None:
        c.setFillColor(fill)
        c.rect(x, y, w, h, stroke=0, fill=1)
    c.setStrokeColor(black)
    c.setLineWidth(0.7)
    c.rect(x, y, w, h, stroke=1, fill=0)


def _fit(c: canvas.Canvas, text: str, font: str, size: float, max_w: float) -> str:
    t = text or ""
    while t and c.stringWidth(t, font, size) > max_w:
        t = t[:-1]
    return t


def _draw_header_cell(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str, value: str) -> None:
    _box(c, x, y, w, h)
    c.setFillColor(black)
    c.setFont(_font(True), 7)
    c.drawString(x + 3, y + h - 10, label)
    c.setFont(_font(False), 8.5)
    c.drawString(x + 3, y + 4, _fit(c, value, _font(False), 8.5, w - 8))


def _draw_checkbox(c: canvas.Canvas, x: float, y: float, checked: bool) -> None:
    size = 9
    _box(c, x, y, size, size)
    if checked:
        c.setStrokeColor(black)
        c.setLineWidth(1.4)
        c.line(x + 1.5, y + 4.5, x + 3.5, y + 2)
        c.line(x + 3.5, y + 2, x + 7.5, y + 7.5)


def draw_report(c: canvas.Canvas, row: models.AssemblyInspectionReport, page_w: float, page_h: float) -> None:
    margin = 28
    usable = page_w - 2 * margin
    y = page_h - margin

    # Title bar
    _box(c, margin, y - 36, usable, 36, NAVY)
    c.setFillColor(white)
    c.setFont(_font(True), 9)
    c.drawString(margin + 8, y - 14, "Uhde")
    c.setFont(_font(True), 11)
    title = "Inspection Report for the Assembly of cell Elements"
    c.drawCentredString(page_w / 2, y - 22, title)
    y -= 48

    # Header grid row 1
    row_h = 28
    cols1 = [
        ("Assembly Date", _txt(row.assembly_date), 0.18),
        ("Anode No", _txt(row.anode_nr), 0.18),
        ("Cathode No", _txt(row.cathode_nr), 0.18),
        ("Membrane type", _txt(row.membrane_type), 0.22),
        ("Membrane no", _txt(row.membrane_nr), 0.24),
    ]
    x = margin
    for label, value, frac in cols1:
        w = usable * frac
        _draw_header_cell(c, x, y - row_h, w, row_h, label, value)
        x += w
    y -= row_h

    cols2 = [
        ("Element No.", _txt(row.element_nr), 0.18),
        ("Electrolyzer", _txt(row.electrolyzer), 0.18),
        ("Position", _txt(row.position), 0.12),
        ("Group", _txt(row.group_nr), 0.14),
        ("Remarks", _txt(row.remarks), 0.38),
    ]
    x = margin
    for label, value, frac in cols2:
        w = usable * frac
        _draw_header_cell(c, x, y - row_h, w, row_h, label, value)
        x += w
    y -= row_h + 8

    # Activities header: category | checked | text | remark
    act_h = 16
    cat_w = 54
    check_w = 36
    remark_w = 110
    text_w = usable - cat_w - check_w - remark_w
    x0 = margin
    x1 = x0 + cat_w
    x2 = x1 + check_w
    x3 = x2 + text_w
    _box(c, x0, y - act_h, cat_w, act_h, LIGHT)
    _box(c, x1, y - act_h, check_w, act_h, LIGHT)
    _box(c, x2, y - act_h, text_w, act_h, LIGHT)
    _box(c, x3, y - act_h, remark_w, act_h, LIGHT)
    c.setFillColor(black)
    c.setFont(_font(True), 7.5)
    c.drawCentredString(x1 + check_w / 2, y - 11, "checked")
    c.drawString(x2 + 3, y - 11, "Activities")
    c.drawCentredString(x3 + remark_w / 2, y - 11, "Remark")
    y -= act_h

    checks = row.checks or {}
    check_remarks = getattr(row, "check_remarks", None) or {}
    line_h = 13.2
    for section in ACTIVITY_SECTIONS:
        items = section["items"]
        block_h = line_h * len(items)
        if y - block_h < 120:
            c.showPage()
            y = page_h - margin
        _box(c, x0, y - block_h, cat_w, block_h, LIGHT)
        c.setFillColor(black)
        c.setFont(_font(True), 8)
        c.saveState()
        c.translate(x0 + cat_w / 2, y - block_h / 2)
        c.rotate(90)
        c.drawCentredString(0, -3, section["title"])
        c.restoreState()

        for idx, item in enumerate(items):
            top = y - idx * line_h
            _box(c, x1, top - line_h, check_w, line_h)
            _box(c, x2, top - line_h, text_w, line_h)
            _box(c, x3, top - line_h, remark_w, line_h)
            checked = bool(checks.get(item["key"]))
            if checked:
                c.setFillColor(OK_FILL)
                c.rect(x1 + 1, top - line_h + 1, check_w - 2, line_h - 2, stroke=0, fill=1)
            _draw_checkbox(c, x1 + check_w / 2 - 4.5, top - line_h + 2, checked)
            c.setFillColor(black)
            c.setFont(_font(False), 7)
            label = _fit(c, item["label"], _font(False), 7, text_w - 8)
            c.drawString(x2 + 3, top - line_h + 3.5, label)
            remark = _fit(c, _txt(check_remarks.get(item["key"])), _font(False), 7, remark_w - 8)
            c.drawString(x3 + 3, top - line_h + 3.5, remark)
        y -= block_h

    y -= 10
    # Measurements
    meas_h = 26
    parts = [
        ("Spacer thickness of anode:", _txt(row.spacer_thickness_anode)),
        ("Spacer thickness of cathode:", _txt(row.spacer_thickness_cathode)),
        ("Electrode distance:", _txt(row.electrode_distance)),
    ]
    part_w = usable / 3
    x = margin
    for label, value in parts:
        _box(c, x, y - meas_h, part_w, meas_h)
        c.setFillColor(black)
        c.setFont(_font(True), 7)
        c.drawString(x + 3, y - 11, label)
        c.setFont(_font(False), 9)
        c.drawString(x + 3, y - 22, value)
        x += part_w
    y -= meas_h + 8

    # Signatures
    sign_h = 78
    if y - sign_h < margin:
        c.showPage()
        y = page_h - margin
    sign_w = usable / 3
    roles = [
        ("Maintenance cell work shop", row.sign_maint_name, row.sign_maint_image, row.sign_maint_at),
        ("Inspection", row.sign_insp_name, row.sign_insp_image, row.sign_insp_at),
        ("Process", row.sign_proc_name, row.sign_proc_image, row.sign_proc_at),
    ]
    x = margin
    for label, name, image, at in roles:
        _box(c, x, y - sign_h, sign_w, sign_h)
        c.setFillColor(black)
        c.setFont(_font(True), 7.5)
        c.drawString(x + 4, y - 12, label)
        c.setFont(_font(False), 8)
        c.drawString(x + 4, y - 24, _fit(c, _txt(name), _font(False), 8, sign_w - 10))
        img = _image(image)
        if img is not None:
            try:
                c.drawImage(img, x + 6, y - sign_h + 8, width=sign_w - 14, height=42, preserveAspectRatio=True, mask="auto")
            except Exception:
                pass
        if at:
            c.setFont(_font(False), 6.5)
            c.drawString(x + 4, y - sign_h + 4, _fit(c, _txt(at), _font(False), 6.5, sign_w - 10))
        x += sign_w


def assembly_inspection_pdf_response(
    rows: list[models.AssemblyInspectionReport],
    filename: str = "assembly-inspection.pdf",
) -> StreamingResponse:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4
    if not rows:
        c.setFont(_font(True), 12)
        c.drawString(40, page_h - 60, "No assembly inspection records.")
        c.showPage()
    else:
        for idx, row in enumerate(rows):
            if idx:
                c.showPage()
            draw_report(c, row, page_w, page_h)
    c.save()
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
