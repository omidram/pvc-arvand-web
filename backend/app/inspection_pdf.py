"""CZ-03-00-189-A inspection report as a printable PDF (matches the on-screen form)."""
from __future__ import annotations

import base64
import io
from datetime import date, datetime
from typing import Any

from fastapi.responses import StreamingResponse
from reportlab.lib.colors import Color, black, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from . import models

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


def _cell(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str, value: str, *, label_w: float | None = None) -> None:
    _box(c, x, y, w, h)
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(x + 3, y + h - 10, label)
    lw = label_w if label_w is not None else c.stringWidth(label, "Helvetica-Bold", 7) + 8
    c.setFont("Helvetica", 8)
    text = value or ""
    max_w = w - lw - 6
    while text and c.stringWidth(text, "Helvetica", 8) > max_w:
        text = text[:-1]
    c.drawString(x + lw, y + 4, text)


def _multiline(c: canvas.Canvas, x: float, y: float, w: float, h: float, label: str, value: str) -> None:
    _box(c, x, y, w, h)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(x + 3, y + h - 10, label)
    c.setFont("Helvetica", 8)
    text = c.beginText(x + 3, y + h - 20)
    text.setFont("Helvetica", 8)
    width = w - 6
    for raw_line in (value or "").splitlines() or [""]:
        line = raw_line
        while line:
            cut = len(line)
            while cut > 1 and c.stringWidth(line[:cut], "Helvetica", 8) > width:
                cut -= 1
            text.textLine(line[:cut])
            line = line[cut:]
            if text.getY() < y + 4:
                break
    c.drawText(text)


def _grid(c: canvas.Canvas, x: float, y: float, w: float, h: float, title: str, data: dict[str, Any]) -> None:
    _box(c, x, y, w, h)
    c.setFont("Helvetica-Bold", 7)
    c.drawCentredString(x + w / 2, y + h - 11, title)
    top = y + h - 16
    left = x + 14
    cols, rows = 18, 12
    cw = (w - 20) / cols
    rh = (h - 28) / (rows + 1)
    c.setFont("Helvetica", 5)
    for i, col in enumerate(GRID_COLS):
        c.drawCentredString(left + (i + 0.5) * cw, top - 8, str(col))
    for r, row in enumerate(GRID_ROWS):
        yy = top - (r + 2) * rh
        c.drawRightString(left - 2, yy + 2, row)
        for i, col in enumerate(GRID_COLS):
            key = f"{row}{col}"
            code = str((data or {}).get(key) or "")
            xx = left + i * cw
            fill = CODE_FILL.get(code)
            if fill:
                c.setFillColor(fill)
                c.rect(xx, yy, cw, rh, stroke=0, fill=1)
                c.setFillColor(black)
            c.setStrokeColor(black)
            c.setLineWidth(0.3)
            c.rect(xx, yy, cw, rh, stroke=1, fill=0)
            if code:
                c.setFont("Helvetica-Bold", 5)
                c.drawCentredString(xx + cw / 2, yy + 2, code[:3])
                c.setFont("Helvetica", 5)


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
        [("Client:", "client"), ("Anode NO:", "anode_nr"), ("Date:", "inspection_date")],
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
    blister_h = 140
    y -= blister_h
    _grid(c, m, y, left_w, blister_h, "Membrane inspection — Anode Side (top view)", grids.get("membrane_as") or {})
    bx = m + left_w
    _box(c, bx, y, right_w, blister_h)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(bx + right_w / 2, y + blister_h - 11, "Blister")
    bw = right_w / 5
    labels = ["Anode Surface %", "Periph. %", "Periph. %", "Periph. %", "% Corner"]
    keys = ["blister_anode_area", "blister_periphery_top", "blister_periphery_bottom", "blister_periphery_side", "blister_corners"]
    hy = y + blister_h - 24
    for i, lab in enumerate(labels):
        _cell(c, bx + i * bw, hy, bw, 12, lab, _g(row, keys[i]), label_w=2)
    defects = [("Wrinkle(w)", "folds"), ("Pressure marks(pm)", "pressure_marks"), ("Visible holes(vh)", "visible_holes"), ("Tears(T)", "cracks")]
    dy = hy - 14
    for lab, key in defects:
        _cell(c, bx, dy, right_w, 13, lab, _g(row, key))
        dy -= 13
    xrf_h = 26
    _multiline(c, bx, y + xrf_h, right_w, dy - y - xrf_h, "Remarks:", _g(row, "blister_remarks"))
    _cell(c, bx, y + 13, right_w, 13, "XRF.Anode:", _g(row, "xrf_anode"))
    _cell(c, bx, y, right_w, 13, "XRF.Cathode:", _g(row, "xrf_cathode"))

    split_h = 92
    y -= split_h
    _grid(c, m, y, content_w / 2, split_h, "Cathode Side (plan view)", grids.get("membrane_ks") or {})
    _grid(c, m + content_w / 2, y, content_w / 2, split_h, "Leak test anode side (plan view)", grids.get("membrane_lt") or {})
    y -= split_h
    _grid(c, m, y, content_w / 2, split_h, "Anode half shell (plan view)", grids.get("anode_half") or {})
    _grid(c, m + content_w / 2, y, content_w / 2, split_h, "cathode half shell (plan view)", grids.get("cathode_half") or {})

    mid = content_w / 3
    y -= 13
    _cell(c, m, y, mid, 13, "Deformation pan (DP):", _g(row, "deformation_pan"))
    _cell(c, m + 2 * mid, y, mid, 13, "Leakage pan(LP):", _g(row, "leakage_pan"))
    dep_top = y + 13
    y -= 13
    _cell(c, m, y, mid, 13, "Deformation electrode (DP):", _g(row, "deformation_electrode"))
    _cell(c, m + 2 * mid, y, mid, 13, "Leakage Web area (Lw):", _g(row, "leakage_web"))
    y -= 13
    _cell(c, m, y, mid, 13, "coloured area (CA):", _g(row, "coloured_area"))
    _cell(c, m + 2 * mid, y, mid, 13, "Leakage corner area (LC):", _g(row, "leakage_corner"))
    y -= 13
    _cell(c, m, y, mid, 13, "coloured electrode(CE):", _g(row, "coloured_electrode"))
    _cell(c, m + 2 * mid, y, mid, 13, "Leakage outlet nozzle(LO):", _g(row, "leakage_outlet"))
    y -= 13
    _cell(c, m, y, mid, 13, "coloured pan (CP):", _g(row, "coloured_pan"))
    _cell(c, m + 2 * mid, y, mid, 13, "Leakage inlet nozzle (LI):", _g(row, "leakage_inlet"))
    _multiline(c, m + mid, y, mid, dep_top - y, "Deposits(D):", _g(row, "deposits"))

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


def inspection_pdf_response(reports: list[tuple[models.InspectionReport, dict[str, dict[str, Any]]]], filename: str) -> StreamingResponse:
    data = inspection_pdf_bytes(reports)
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
