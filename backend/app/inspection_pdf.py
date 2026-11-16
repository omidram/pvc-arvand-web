"""CZ-03-00-189-A inspection report as a printable PDF (matches the on-screen form)."""
from __future__ import annotations

import base64
import io
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi.responses import Response
from reportlab.lib.colors import Color, black, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from . import models

_ARABIC = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]")
_FONT_READY = False
_ROOT = Path(__file__).resolve().parents[2]

GRID_ROWS = list("ABCDEFGHJKLM")
GRID_COLS = list(range(18, 0, -1))
GRID_TYPES = [
    ("membrane_as", "Anode Side (top view)"),
    ("membrane_ks", "Cathode Side (plan view)"),
    ("membrane_lt", "Leak test anode side (plan view)"),
    ("anode_half", "Anode half shell (plan view)"),
    ("cathode_half", "cathode half shell (plan view)"),
]
CODE_FILL = {
    "w": Color(0.96, 0.84, 0.43),
    "pm": Color(0.94, 0.68, 0.31),
    "vh": Color(0.91, 0.30, 0.24),
    "T": Color(0.61, 0.35, 0.71),
}


def _ensure_value_font() -> str:
    global _FONT_READY
    if _FONT_READY:
        return "Vazir"
    regular = _ROOT / "docs" / "fonts" / "Vazirmatn-Regular.ttf"
    try:
        pdfmetrics.registerFont(TTFont("Vazir", str(regular)))
        _FONT_READY = True
        return "Vazir"
    except Exception:
        return "Helvetica"


def _shape(value: str) -> str:
    if not value or not _ARABIC.search(value):
        return value
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        return get_display(arabic_reshaper.reshape(value))
    except Exception:
        return value


def _fit(c: canvas.Canvas, text: str, font: str, size: float, max_w: float) -> str:
    shown = _shape(text or "")
    limit = max(max_w, 4)
    while shown and c.stringWidth(shown, font, size) > limit:
        shown = shown[:-1]
    return shown


def _txt(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return "Yes" if value else ""
    return str(value)


def _g(row: models.InspectionReport, name: str) -> str:
    return _txt(getattr(row, name, None))


def _xrf(row: models.InspectionReport, name: str, flag: str) -> str:
    text = _g(row, name)
    if getattr(row, flag, False):
        return f"{text}  N/A".strip()
    return text


def _image(data_url: str | None) -> ImageReader | None:
    raw = (data_url or "").strip()
    if not raw.startswith("data:image") or "," not in raw:
        return None
    try:
        payload = base64.b64decode(raw.split(",", 1)[1], validate=False)
        return ImageReader(io.BytesIO(payload))
    except Exception:
        return None


def _box(c: canvas.Canvas, x: float, y: float, w: float, h: float) -> None:
    c.setStrokeColor(black)
    c.setLineWidth(0.6)
    c.rect(x, y, w, h, stroke=1, fill=0)


def _center(c: canvas.Canvas, x: float, y: float, w: float, h: float, text: str, *, bold: bool = False, size: float = 7) -> None:
    """One line, centred in its own cell, so a heading never paints over the value."""
    _box(c, x, y, w, h)
    font = "Helvetica-Bold" if bold else _ensure_value_font()
    c.setFillColor(black)
    c.setFont(font, size)
    shown = _fit(c, text or "", font, size, w - 4)
    if shown:
        c.drawCentredString(x + w / 2, y + max((h - size) / 2, 1), shown)


def _cell(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str, value: str, *, label_w: float | None = None) -> None:
    _box(c, x, y, w, h)
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(x + 3, y + h - 10, label)
    lw = label_w if label_w is not None else c.stringWidth(label, "Helvetica-Bold", 7) + 8
    font = _ensure_value_font()
    c.setFont(font, 8)
    text = _fit(c, value or "", font, 8, w - lw - 6)
    if text:
        c.drawString(x + lw, y + 4, text)


def _multiline(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str, value: str) -> None:
    _box(c, x, y, w, h)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(x + 3, y + h - 10, label)
    font = _ensure_value_font()
    c.setFont(font, 8)
    text = c.beginText(x + 3, y + h - 20)
    text.setFont(font, 8)
    width = w - 6
    for raw_line in _shape(value or "").splitlines() or [""]:
        line = raw_line
        while line:
            cut = len(line)
            while cut > 1 and c.stringWidth(line[:cut], font, 8) > width:
                cut -= 1
            text.textLine(line[:cut])
            line = line[cut:]
            if text.getY() < y + 4:
                break
    c.drawText(text)


def _frame_text(data: dict[str, Any] | None, band: int, slot: int) -> str:
    return str((data or {}).get(f"p{band}-{slot}") or "")


def _is_frame(band: int, slot: int, bands: int, slots: int) -> bool:
    return band in (0, bands - 1) or slot in (0, slots - 1) or (band == 1 and slot == 1)


def _grid_cell(c: canvas.Canvas, x: float, y: float, w: float, h: float, code: str = "") -> None:
    fill = CODE_FILL.get(code)
    if fill:
        c.setFillColor(fill)
        c.rect(x, y, w, h, stroke=0, fill=1)
        c.setFillColor(black)
    c.setStrokeColor(black)
    c.setLineWidth(0.3)
    c.rect(x, y, w, h, stroke=1, fill=0)
    if code:
        size = 5 if len(code) <= 3 else 3.5
        c.setFont("Helvetica-Bold", size)
        c.drawCentredString(x + w / 2, y + (1.6 if size < 5 else 1.5), code[:6])
        c.setFont("Helvetica", 5)


def _grid(c: canvas.Canvas, x: float, y: float, w: float, h: float, title: str, data: dict[str, Any]) -> None:
    """18×A–M map with one empty cell on every side, matching the on-screen form."""
    _box(c, x, y, w, h)
    c.setFont("Helvetica-Bold", 7)
    c.drawCentredString(x + w / 2, y + h - 10, title)
    top = y + h - 14
    left = x + 4
    # pad + row letter + 18 columns + pad
    slots = 21
    # pad row + number row + 12 data rows + pad row
    bands = 15
    cw = (w - 8) / slots
    rh = (h - 16) / bands
    c.setFont("Helvetica", 5)
    for band in range(bands):
        yy = top - (band + 1) * rh
        for slot in range(slots):
            xx = left + slot * cw
            if _is_frame(band, slot, bands, slots):
                _grid_cell(c, xx, yy, cw, rh, _frame_text(data, band, slot))
                continue
            if band == 1:
                if slot >= 2:
                    c.drawCentredString(xx + cw / 2, yy + 1.5, str(GRID_COLS[slot - 2]))
                _grid_cell(c, xx, yy, cw, rh)
                continue
            row = GRID_ROWS[band - 2]
            if slot == 1:
                _grid_cell(c, xx, yy, cw, rh)
                c.drawCentredString(xx + cw / 2, yy + 1.5, row)
                continue
            code = str((data or {}).get(f"{row}{GRID_COLS[slot - 2]}") or "")
            _grid_cell(c, xx, yy, cw, rh, code)


def _sign(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str, name: str, image: str | None) -> None:
    _box(c, x, y, w, h)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x + 4, y + h - 11, label)
    pic = _image(image)
    pad = 3
    img_h = h - 16
    if pic is not None:
        try:
            c.drawImage(pic, x + pad, y + pad, width=w - 8, height=img_h, preserveAspectRatio=True, mask="auto")
        except Exception:
            pic = None
    if pic is None and name:
        c.setFont("Helvetica-Oblique", 11)
        c.drawCentredString(x + w / 2, y + h / 2 - 4, name)


def _draw_report(c: canvas.Canvas, row: models.InspectionReport, grids: dict[str, dict[str, Any]]) -> None:
    width, height = landscape(A4)
    m = 16
    c.setFillColor(white)
    c.rect(0, 0, width, height, stroke=0, fill=1)
    c.setFillColor(black)
    y = height - m
    title_h = 16
    y -= title_h
    _box(c, m, y, width - 2 * m, title_h)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(width / 2, y + 4, "INSPECTION REPORT MEMBRANE/ANODE/CATHODE")

    col = (width - 2 * m) / 3
    row_h = 14
    header = [
        [("Client:", "client"), ("Anode NO:", "anode_nr"), ("Date Of Inspection:", "inspection_date")],
        [("electrolyzer No:", "electrolyzer"), ("Cathode No:", "cathode_nr"), ("Operation days:", "operation_days")],
        [("Position:", "position"), ("membrane No:", "membrane_nr"), ("Electrode No:(Anode)", "electrode_nr_anode")],
        [("Element no:", "element_nr"), ("membrane Type:", "membrane_type"), ("Electrode No:(Cathode)", "electrode_nr_cathode")],
    ]
    for cells in header:
        y -= row_h
        for i, (lab, key) in enumerate(cells):
            _cell(c, m + i * col, y, col, row_h, lab, _g(row, key))

    y -= row_h
    _cell(c, m, y, width - 2 * m, row_h, "Reason for inspection", _g(row, "inspection_reason"))

    content_w = width - 2 * m
    left_w = content_w * 0.55
    right_w = content_w - left_w
    blister_h = 156
    y -= blister_h
    _grid(c, m, y, left_w, blister_h, "Membrane inspection — Anode Side (top view)", grids.get("membrane_as") or {})
    bx = m + left_w
    _box(c, bx, y, right_w, blister_h)
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(bx + right_w / 2, y + blister_h - 11, "Blister")
    col_w = right_w / 5
    head_h = 10
    group_y = y + blister_h - 15 - head_h
    for start, span, label in ((0, 1, "Anode Surface"), (1, 3, "Periphery"), (4, 1, "Corner")):
        _center(c, bx + start * col_w, group_y, col_w * span, head_h, label, bold=True, size=7)
    pct_y = group_y - head_h
    for index in range(5):
        _center(c, bx + index * col_w, pct_y, col_w, head_h, "%", bold=True, size=7)
    val_h = 12
    val_y = pct_y - val_h
    value_keys = (
        "blister_anode_area",
        "blister_periphery_top",
        "blister_periphery_bottom",
        "blister_periphery_side",
        "blister_corners",
    )
    for index, key in enumerate(value_keys):
        _center(c, bx + index * col_w, val_y, col_w, val_h, _g(row, key), size=8)
    defects = [("Wrinkle(w)", "folds"), ("Pressure marks(pm)", "pressure_marks"), ("Visible holes(vh)", "visible_holes"), ("Tears(T)", "cracks")]
    dy = val_y - 12
    for lab, key in defects:
        _cell(c, bx, dy, right_w, 12, lab, _g(row, key))
        dy -= 12
    xrf_top = y + 24
    _multiline(c, bx, xrf_top, right_w, max(dy + 12 - xrf_top, 16), "Remarks:", _g(row, "blister_remarks"))
    _cell(c, bx, y + 12, right_w, 12, "XRF.Anode:", _xrf(row, "xrf_anode", "xrf_anode_na"))
    _cell(c, bx, y, right_w, 12, "XRF.Cathode:", _xrf(row, "xrf_cathode", "xrf_cathode_na"))

    split_h = 84
    y -= split_h
    _grid(c, m, y, content_w / 2, split_h, "Cathode Side (plan view)", grids.get("membrane_ks") or {})
    _grid(c, m + content_w / 2, y, content_w / 2, split_h, "Leak test anode side (plan view)", grids.get("membrane_lt") or {})
    y -= split_h
    _grid(c, m, y, content_w / 2, split_h, "Anode half shell (plan view)", grids.get("anode_half") or {})
    _grid(c, m + content_w / 2, y, content_w / 2, split_h, "cathode half shell (plan view)", grids.get("cathode_half") or {})

    mid = content_w / 3
    leak_rows = [
        ("Deformation pan (DP):", "deformation_pan", "Leakage pan(LP):", "leakage_pan", "leakage_pan_cathode"),
        ("Deformation electrode (DP):", "deformation_electrode", "Leakage Web area (Lw):", "leakage_web", "leakage_web_cathode"),
        ("coloured area (CA):", "coloured_area", "Leakage corner area (LC):", "leakage_corner", "leakage_corner_cathode"),
        ("coloured electrode(CE):", "coloured_electrode", "Leakage outlet nozzle(LO):", "leakage_outlet", "leakage_outlet_cathode"),
        ("coloured pan (CP):", "coloured_pan", "Leakage inlet nozzle (LI):", "leakage_inlet", "leakage_inlet_cathode"),
        ("", "", "Loose Flange:", "leakage_flange", "leakage_flange_cathode"),
    ]
    head_h, row_h = 11, 12
    block_h = head_h + len(leak_rows) * row_h
    y -= block_h
    _multiline(c, m + mid, y, mid, block_h, "Deposits(D): C-90", _g(row, "deposits"))
    _box(c, m + 2 * mid, y + block_h - head_h, mid, head_h)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(m + 2 * mid + mid * 0.46, y + block_h - head_h + 3, "Anode")
    c.drawString(m + 2 * mid + mid * 0.74, y + block_h - head_h + 3, "Cathode")
    for index, (left_lab, left_key, leak_lab, anode_key, cathode_key) in enumerate(leak_rows):
        yy = y + block_h - head_h - (index + 1) * row_h
        if left_lab:
            _cell(c, m, yy, mid, row_h, left_lab, _g(row, left_key))
        else:
            _box(c, m, yy, mid, row_h)
        _cell(c, m + 2 * mid, yy, mid * 0.46, row_h, leak_lab, "")
        _cell(c, m + 2 * mid + mid * 0.46, yy, mid * 0.27, row_h, "", _g(row, anode_key))
        _cell(c, m + 2 * mid + mid * 0.73, yy, mid * 0.27, row_h, "", _g(row, cathode_key))

    foot = 13
    y -= foot
    _cell(c, m, y, mid, foot, "sample taken:", "")
    _cell(c, m + mid, y, mid, foot, "insert pipe(Anode):", _g(row, "anode_tube_remark") or ("Yes" if row.anode_tube_ok else ""))
    _cell(c, m + 2 * mid, y, mid, foot, "Name:", _g(row, "inspector_name"))
    y -= foot
    _cell(c, m, y, mid, foot, "cathode:", _g(row, "sample_cathode_note") or ("Yes" if row.sample_cathode else ""))
    _cell(c, m + mid, y, mid, foot, "insert pipe(cathode):", _g(row, "cathode_tube_remark") or ("Yes" if row.cathode_tube_ok else ""))
    _cell(c, m + 2 * mid, y, mid, foot, "Date:", _g(row, "inspection_date"))

    sign_h = 54
    y -= sign_h
    _cell(c, m, y + sign_h - foot, mid, foot, "Anode:", _g(row, "sample_anode_note") or ("Yes" if row.sample_anode else ""))
    _cell(c, m + mid, y + sign_h - foot, mid, foot, "spacer strip(Anode):", _g(row, "anode_spacer_remark") or ("Yes" if row.anode_spacer_ok else ""))
    _cell(c, m, y + sign_h - 2 * foot, mid, foot, "Membrane:", _g(row, "sample_membrane_note") or ("Yes" if row.sample_membrane else ""))
    _cell(c, m + mid, y + sign_h - 2 * foot, mid, foot, "spacer strip(cathode):", _g(row, "cathode_spacer_remark") or ("Yes" if row.cathode_spacer_ok else ""))

    remarks_h = sign_h - 2 * foot
    rx, ry, rw = m, y, mid
    _box(c, rx, ry, rw, remarks_h)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(rx + 3, ry + remarks_h - 9, "REMARKS")
    c.setFont("Helvetica", 7)
    c.drawString(rx + 3, ry + remarks_h - 20, (_g(row, "general_remarks") or "")[:90])

    _cell(c, m + mid, y, mid, remarks_h, "Frame gasket:", _g(row, "frame_gasket_remark") or ("Yes" if row.frame_gasket_ok else ""))

    sw = mid / 3
    sx = m + 2 * mid
    insp_name = _g(row, "sign_insp_name") or _g(row, "signature")
    _sign(c, sx, y, sw, sign_h, "Insp.", insp_name, getattr(row, "sign_insp_image", None))
    _sign(c, sx + sw, y, sw, sign_h, "Maint.", _g(row, "sign_maint_name"), getattr(row, "sign_maint_image", None))
    _sign(c, sx + 2 * sw, y, sw, sign_h, "Proc.", _g(row, "sign_proc_name"), getattr(row, "sign_proc_image", None))

    c.setFont("Helvetica-Bold", 8)
    c.drawString(m, m - 2, "CZ-03-00-189-A")


def inspection_pdf_bytes(reports: list[tuple[models.InspectionReport, dict[str, dict[str, Any]]]]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=landscape(A4))
    if not reports:
        c.setFont("Helvetica", 12)
        c.drawString(40, 40, "No inspection reports")
        c.showPage()
    for index, (row, grids) in enumerate(reports):
        if index:
            c.showPage()
        _draw_report(c, row, grids)
    c.save()
    buf.seek(0)
    return buf.getvalue()


def inspection_form_xlsx(row: models.InspectionReport, grids: dict[str, dict[str, Any]]) -> Response:
    """One CZ-03 sheet, laid out like the form on screen. Not the whole inspection list."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    thin = Border(
        left=Side(style="thin", color="111111"),
        right=Side(style="thin", color="111111"),
        top=Side(style="thin", color="111111"),
        bottom=Side(style="thin", color="111111"),
    )
    bold = Font(name="Calibri", bold=True, size=9)
    title_font = Font(name="Calibri", bold=True, size=14)
    small = Font(name="Calibri", size=8)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left_align = Alignment(horizontal="left", vertical="center", wrap_text=True)
    fills = {
        "w": PatternFill("solid", fgColor="F5D76E"),
        "pm": PatternFill("solid", fgColor="F0AD4E"),
        "vh": PatternFill("solid", fgColor="E74C3C"),
        "T": PatternFill("solid", fgColor="9B59B6"),
    }

    wb = Workbook()
    ws = wb.active
    ws.title = "CZ-03"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.freeze_panes = "A2"

    def put(r: int, c: int, value: str, *, font=None, align=None, fill=None, span: int = 1) -> None:
        cell = ws.cell(r, c, value)
        cell.font = font or small
        cell.alignment = align or left_align
        cell.border = thin
        if fill is not None:
            cell.fill = fill
        if span > 1:
            ws.merge_cells(start_row=r, start_column=c, end_row=r, end_column=c + span - 1)
            for extra in range(1, span):
                ws.cell(r, c + extra).border = thin

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=12)
    title = ws.cell(1, 1, "INSPECTION REPORT MEMBRANE/ANODE/CATHODE")
    title.font = title_font
    title.alignment = center
    for col in range(1, 13):
        ws.cell(1, col).border = thin
        ws.cell(1, col).font = title_font

    header = [
        ("Client:", "client", "Anode NO:", "anode_nr", "Date Of Inspection:", "inspection_date"),
        ("electrolyzer No:", "electrolyzer", "Cathode No:", "cathode_nr", "Operation days:", "operation_days"),
        ("Position:", "position", "membrane No:", "membrane_nr", "Electrode No:(Anode)", "electrode_nr_anode"),
        ("Element no:", "element_nr", "membrane Type:", "membrane_type", "Electrode No:(Cathode)", "electrode_nr_cathode"),
    ]
    for offset, cells in enumerate(header):
        excel_row = 2 + offset
        for index in range(3):
            put(excel_row, 1 + index * 4, cells[index * 2], font=bold)
            put(excel_row, 2 + index * 4, _g(row, cells[index * 2 + 1]), span=3)
    put(6, 1, "Reason for inspection", font=bold)
    put(6, 2, _g(row, "inspection_reason"), span=11)

    cursor = 8

    def paint_grid(origin_col: int, origin_row: int, caption: str, data: dict[str, Any]) -> int:
        put(origin_row, origin_col, caption, font=bold, align=center, span=21)
        slots = 21
        bands = 15
        for band in range(bands):
            excel_row = origin_row + 1 + band
            for slot in range(slots):
                value = ""
                fill = None
                if _is_frame(band, slot, bands, slots):
                    value = _frame_text(data, band, slot)
                    fill = fills.get(value)
                elif band == 1 and slot >= 2:
                    value = str(GRID_COLS[slot - 2])
                elif band > 1:
                    grid_row = GRID_ROWS[band - 2]
                    if slot == 1:
                        value = grid_row
                    else:
                        value = str((data or {}).get(f"{grid_row}{GRID_COLS[slot - 2]}") or "")
                        fill = fills.get(value)
                put(excel_row, origin_col + slot, value, font=bold if value in fills or (band == 1 or (slot == 1 and band > 1)) else small, align=center, fill=fill)
        return origin_row + 1 + bands

    cursor = paint_grid(1, cursor, "Membrane inspection — Anode Side (top view)", grids.get("membrane_as") or {})
    cursor += 1
    left = paint_grid(1, cursor, "Cathode Side (plan view)", grids.get("membrane_ks") or {})
    paint_grid(23, cursor, "Leak test anode side (plan view)", grids.get("membrane_lt") or {})
    cursor = left + 1
    left = paint_grid(1, cursor, "Anode half shell (plan view)", grids.get("anode_half") or {})
    paint_grid(23, cursor, "cathode half shell (plan view)", grids.get("cathode_half") or {})
    cursor = left + 1

    blister = [
        ("Anode Surface %", "blister_anode_area"),
        ("Periphery %", "blister_periphery_top"),
        ("Periphery %", "blister_periphery_bottom"),
        ("Periphery %", "blister_periphery_side"),
        ("Corner %", "blister_corners"),
        ("Wrinkle(w)", "folds"),
        ("Pressure marks(pm)", "pressure_marks"),
        ("Visible holes(vh)", "visible_holes"),
        ("Tears(T)", "cracks"),
    ]
    put(cursor, 1, "Blister", font=bold, span=2)
    cursor += 1
    for label, key in blister:
        put(cursor, 1, label, font=bold)
        put(cursor, 2, _g(row, key), span=3)
        cursor += 1
    put(cursor, 1, "Remarks:", font=bold)
    put(cursor, 2, _g(row, "blister_remarks"), span=5)
    cursor += 1
    put(cursor, 1, "XRF.Anode:", font=bold)
    put(cursor, 2, _xrf(row, "xrf_anode", "xrf_anode_na"), span=3)
    put(cursor, 5, "N/A" if getattr(row, "xrf_anode_na", False) else "", align=center)
    cursor += 1
    put(cursor, 1, "XRF.Cathode:", font=bold)
    put(cursor, 2, _xrf(row, "xrf_cathode", "xrf_cathode_na"), span=3)
    put(cursor, 5, "N/A" if getattr(row, "xrf_cathode_na", False) else "", align=center)
    cursor += 2
    put(cursor, 1, "Deposits(D): C-90", font=bold)
    put(cursor, 2, _g(row, "deposits"), span=5)
    cursor += 1
    put(cursor, 1, "Leakage", font=bold)
    put(cursor, 2, "Anode", font=bold, align=center)
    put(cursor, 3, "Cathode", font=bold, align=center)
    cursor += 1
    for label, anode_key, cathode_key in (
        ("Leakage pan(LP)", "leakage_pan", "leakage_pan_cathode"),
        ("Leakage Web area (Lw)", "leakage_web", "leakage_web_cathode"),
        ("Leakage corner area (LC)", "leakage_corner", "leakage_corner_cathode"),
        ("Leakage outlet nozzle(LO)", "leakage_outlet", "leakage_outlet_cathode"),
        ("Leakage inlet nozzle (LI)", "leakage_inlet", "leakage_inlet_cathode"),
        ("Loose Flange", "leakage_flange", "leakage_flange_cathode"),
    ):
        put(cursor, 1, label, font=bold)
        put(cursor, 2, _g(row, anode_key), align=center)
        put(cursor, 3, _g(row, cathode_key), align=center)
        cursor += 1
    footer = [
        ("sample cathode", _g(row, "sample_cathode_note") or ("Yes" if getattr(row, "sample_cathode", False) else "")),
        ("sample anode", _g(row, "sample_anode_note") or ("Yes" if getattr(row, "sample_anode", False) else "")),
        ("sample membrane", _g(row, "sample_membrane_note") or ("Yes" if getattr(row, "sample_membrane", False) else "")),
        ("insert pipe (Anode)", _g(row, "anode_tube_remark") or ("Yes" if getattr(row, "anode_tube_ok", False) else "")),
        ("insert pipe (cathode)", _g(row, "cathode_tube_remark") or ("Yes" if getattr(row, "cathode_tube_ok", False) else "")),
        ("spacer strip (Anode)", _g(row, "anode_spacer_remark") or ("Yes" if getattr(row, "anode_spacer_ok", False) else "")),
        ("spacer strip (cathode)", _g(row, "cathode_spacer_remark") or ("Yes" if getattr(row, "cathode_spacer_ok", False) else "")),
        ("Frame gasket", _g(row, "frame_gasket_remark") or ("Yes" if getattr(row, "frame_gasket_ok", False) else "")),
        ("Name", _g(row, "inspector_name") or _g(row, "sign_insp_name")),
        ("Date", _g(row, "inspection_date")),
        ("REMARKS", _g(row, "general_remarks")),
    ]
    for label, value in footer:
        put(cursor, 1, label, font=bold)
        put(cursor, 2, value, span=5)
        cursor += 1
    put(cursor, 1, "CZ-03-00-189-A", font=bold, span=3)

    for index in range(1, 45):
        ws.column_dimensions[get_column_letter(index)].width = 4.2 if index > 6 else 18
    ws.row_dimensions[1].height = 22
    ws.oddHeader.left.text = "CZ-03-00-189-A"
    ws.print_title_rows = "1:1"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.sheet_view.view = "pageBreakPreview"

    buf = io.BytesIO()
    wb.save(buf)
    filename = f"inspection-{_g(row, 'element_nr') or row.id}.xlsx"
    return _download(buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename)


def _download(data: bytes, media_type: str, filename: str) -> Response:
    """Whole file in one response. A streamed body reaches Chrome's downloader as 0 bytes."""
    safe = filename.replace('"', "").replace("\r", "").replace("\n", "") or "export"
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{safe}"',
            "Content-Length": str(len(data)),
            "Cache-Control": "no-store",
        },
    )


def inspection_pdf_response(reports: list[tuple[models.InspectionReport, dict[str, dict[str, Any]]]], filename: str) -> Response:
    data = inspection_pdf_bytes(reports)
    return _download(data, "application/pdf", filename)
