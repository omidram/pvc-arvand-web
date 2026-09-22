"""Shared helpers to export a list of ORM/dict rows to Excel (.xlsx) or PDF."""
import io
from datetime import date, datetime
from typing import Any

from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet


def _cell_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return str(value)
    return value


def rows_to_dicts(items: list, fields: list[str]) -> list[dict[str, Any]]:
    out = []
    for item in items:
        row = {}
        for f in fields:
            row[f] = _cell_value(getattr(item, f, None))
        out.append(row)
    return out


def export_xlsx(rows: list[dict[str, Any]], fields: list[str], title: str) -> StreamingResponse:
    wb = Workbook()
    ws = wb.active
    ws.title = title[:31] or "Data"
    header_fill = PatternFill(start_color="0A246A", end_color="0A246A", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    ws.append(fields)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
    for row in rows:
        ws.append([row.get(f) for f in fields])
    for i, f in enumerate(fields, start=1):
        max_len = max([len(str(f))] + [len(str(r.get(f, ""))) for r in rows[:200]])
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = min(max(max_len + 2, 10), 40)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"{title or 'export'}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def export_pdf(rows: list[dict[str, Any]], fields: list[str], title: str) -> StreamingResponse:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=1 * cm,
        rightMargin=1 * cm,
        topMargin=1 * cm,
        bottomMargin=1 * cm,
    )
    styles = getSampleStyleSheet()
    elements = [Paragraph(title, styles["Title"]), Spacer(1, 0.4 * cm)]

    data = [fields] + [[str(row.get(f, "") if row.get(f) is not None else "") for f in fields] for row in rows]
    table = Table(data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0A246A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#808080")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F0EFEA")]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    elements.append(table)
    doc.build(elements)
    buf.seek(0)
    filename = f"{title or 'export'}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
