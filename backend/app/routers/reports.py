"""
Reports & Data Analysis.

Deterministic, in-process statistical analysis over the plant's own data:
KPI summaries, shutdown/voltage/current-efficiency trend series, and simple
z-score outlier detection - plus printable (PDF) / spreadsheet (Excel)
export of a full plant or per-electrolyzer report. No external services
or API keys required.
"""
import io
import math
import statistics as pystats
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from .. import models
from ..warehouse import dol_for_element, load_shutdown_windows
from ..database import get_db

router = APIRouter(prefix="/reports", tags=["reports"])


def _zscore_outliers(values: list[tuple[str, float]], threshold: float = 2.5) -> list[dict]:
    nums = [v for _, v in values]
    if len(nums) < 5:
        return []
    mean = pystats.fmean(nums)
    stdev = pystats.pstdev(nums) or 1e-9
    flagged = [
        {"label": label, "value": round(v, 4), "z_score": round((v - mean) / stdev, 2)}
        for label, v in values
        if abs((v - mean) / stdev) >= threshold
    ]
    return sorted(flagged, key=lambda x: abs(x["z_score"]), reverse=True)[:50]


def _voltage_filter(query, electrolyzer: str | None):
    query = query.filter(models.VoltageReading.standardized_voltage.isnot(None))
    if electrolyzer:
        query = query.filter(models.VoltageReading.electrolyzer == electrolyzer)
    return query


def _voltage_stats(db: Session, electrolyzer: str | None) -> tuple[dict | None, list[dict], int]:
    """Count, mean and outliers in SQL. Loading every cell voltage into Python stalls the page."""
    column = models.VoltageReading.standardized_voltage
    count, average, low, high, total, total_sq = _voltage_filter(
        db.query(func.count(column), func.avg(column), func.min(column), func.max(column), func.sum(column), func.sum(column * column)),
        electrolyzer,
    ).one()
    count = int(count or 0)
    if not count or average is None:
        return None, [], 0
    mean = float(average)
    variance = float(total_sq or 0) / count - mean * mean
    stdev = math.sqrt(variance) if variance > 0 else 0.0
    stats = {
        "count": count,
        "mean": round(mean, 4),
        "min": round(float(low), 4),
        "max": round(float(high), 4),
        "stdev": round(stdev, 4),
    }
    outliers: list[dict] = []
    if stdev > 0:
        lo = mean - 2.5 * stdev
        hi = mean + 2.5 * stdev
        rows = _voltage_filter(
            db.query(
                models.VoltageReading.electrolyzer,
                models.VoltageReading.position,
                models.VoltageReading.element_nr,
                column,
            ).filter((column < lo) | (column > hi)),
            electrolyzer,
        ).limit(50).all()
        outliers = [
            {
                "label": f"{el or '?'} / {pos or nr or '?'}",
                "value": round(float(value), 4),
                "z_score": round((float(value) - mean) / stdev, 2),
            }
            for el, pos, nr, value in rows
        ]
        outliers.sort(key=lambda item: abs(item["z_score"]), reverse=True)
    return stats, outliers, count


def _build_summary(db: Session, electrolyzer: str | None) -> dict:
    shutdowns_q = db.query(models.Shutdown)
    elements_q = db.query(models.Element)
    ce_q = db.query(models.CurrentEfficiencyEntry).filter(models.CurrentEfficiencyEntry.value_pct.isnot(None))
    if electrolyzer:
        shutdowns_q = shutdowns_q.filter(models.Shutdown.plant_part == electrolyzer)
        elements_q = elements_q.filter(models.Element.electrolyzer == electrolyzer)
        ce_q = ce_q.filter(models.CurrentEfficiencyEntry.scope_ref == electrolyzer)

    shutdowns = shutdowns_q.all()
    ce_entries = ce_q.all()
    voltage_stats, voltage_outliers, voltage_count = _voltage_stats(db, electrolyzer)

    by_category: dict[str, dict] = {}
    total_hours = 0.0
    for s in shutdowns:
        cat = s.category or "Unknown"
        entry = by_category.setdefault(cat, {"category": cat, "count": 0, "total_hours": 0.0})
        entry["count"] += 1
        if s.shutdown_time and s.startup_time:
            hours = max((s.startup_time - s.shutdown_time).total_seconds() / 3600, 0)
            entry["total_hours"] += hours
            total_hours += hours
    for entry in by_category.values():
        entry["total_hours"] = round(entry["total_hours"], 2)

    ce_values = [e.value_pct for e in ce_entries]
    ce_stats = None
    if ce_values:
        ce_stats = {
            "count": len(ce_values),
            "mean": round(pystats.fmean(ce_values), 3),
            "min": round(min(ce_values), 3),
            "max": round(max(ce_values), 3),
        }

    active_elements = elements_q.filter(models.Element.disassembly_date.is_(None)).count()
    windows = load_shutdown_windows(db)
    dol_values = [
        d for e in elements_q.all()
        if (d := dol_for_element(e, windows)) is not None
    ]

    recent_shutdowns = sorted(
        [s for s in shutdowns if s.shutdown_time],
        key=lambda s: s.shutdown_time,
        reverse=True,
    )[:10]

    return {
        "electrolyzer_filter": electrolyzer,
        "generated_at": datetime.utcnow().isoformat(),
        "counts": {
            "active_elements": active_elements,
            "total_elements": elements_q.count(),
            "shutdowns": len(shutdowns),
            "voltage_readings": voltage_count,
            "current_efficiency_entries": len(ce_entries),
        },
        "voltage_stats": voltage_stats,
        "voltage_outliers": voltage_outliers,
        "shutdown_stats": {
            "total": len(shutdowns),
            "total_hours": round(total_hours, 2),
            "avg_duration_hours": round(total_hours / len(shutdowns), 2) if shutdowns else None,
            "by_category": sorted(by_category.values(), key=lambda x: x["total_hours"], reverse=True),
        },
        "current_efficiency_stats": ce_stats,
        "dol_stats": {
            "count": len(dol_values),
            "mean_days": round(pystats.fmean(dol_values), 1) if dol_values else None,
            "min_days": min(dol_values) if dol_values else None,
            "max_days": max(dol_values) if dol_values else None,
        },
        "recent_shutdowns": [
            {
                "nr": s.nr,
                "plant_part": s.plant_part,
                "category": s.category,
                "cause": s.cause,
                "shutdown_time": s.shutdown_time.isoformat() if s.shutdown_time else None,
                "startup_time": s.startup_time.isoformat() if s.startup_time else None,
            }
            for s in recent_shutdowns
        ],
    }


def _month_key(dt: datetime) -> str:
    return f"{dt.year:04d}-{dt.month:02d}"


def _build_trends(db: Session, electrolyzer: str | None) -> dict:
    period = func.substr(models.VoltageReading.date, 1, 7)
    column = models.VoltageReading.standardized_voltage
    voltage_q = db.query(period, func.avg(column), func.count(column)).filter(
        column.isnot(None), models.VoltageReading.date.isnot(None)
    )
    shutdowns_q = db.query(models.Shutdown).filter(models.Shutdown.shutdown_time.isnot(None))
    if electrolyzer:
        voltage_q = voltage_q.filter(models.VoltageReading.electrolyzer == electrolyzer)
        shutdowns_q = shutdowns_q.filter(models.Shutdown.plant_part == electrolyzer)

    voltage_trend = [
        {"period": bucket, "avg_voltage": round(float(average), 4), "count": int(count)}
        for bucket, average, count in voltage_q.group_by(period).order_by(period).all()
        if bucket and average is not None
    ]

    shutdown_by_month: dict[str, dict] = defaultdict(lambda: {"count": 0, "total_hours": 0.0})
    for s in shutdowns_q.all():
        key = _month_key(s.shutdown_time)
        shutdown_by_month[key]["count"] += 1
        if s.startup_time:
            shutdown_by_month[key]["total_hours"] += max((s.startup_time - s.shutdown_time).total_seconds() / 3600, 0)
    shutdown_trend = [
        {"period": period, "count": v["count"], "total_hours": round(v["total_hours"], 2)}
        for period, v in sorted(shutdown_by_month.items())
    ]

    return {"voltage_trend": voltage_trend, "shutdown_trend": shutdown_trend}


@router.get("/summary")
def report_summary(electrolyzer: str | None = None, db: Session = Depends(get_db)):
    from ..read_cache import get_or_compute

    return get_or_compute(f"report-summary:{electrolyzer or ''}", 60, lambda: _build_summary(db, electrolyzer))


@router.get("/trends")
def report_trends(electrolyzer: str | None = None, db: Session = Depends(get_db)):
    from ..read_cache import get_or_compute

    return get_or_compute(f"report-trends:{electrolyzer or ''}", 60, lambda: _build_trends(db, electrolyzer))


@router.get("/export.xlsx", include_in_schema=False)
def export_report_xlsx(electrolyzer: str | None = None, db: Session = Depends(get_db)):
    summary = _build_summary(db, electrolyzer)
    trends = _build_trends(db, electrolyzer)

    wb = Workbook()
    header_fill = PatternFill(start_color="0A246A", end_color="0A246A", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)

    def style_header(ws):
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font

    ws = wb.active
    ws.title = "Summary"
    ws.append(["Metric", "Value"])
    style_header(ws)
    for row in [
        ["Electrolyzer filter", summary["electrolyzer_filter"] or "All"],
        ["Generated at", summary["generated_at"]],
        ["Active elements", summary["counts"]["active_elements"]],
        ["Total elements", summary["counts"]["total_elements"]],
        ["Shutdowns", summary["counts"]["shutdowns"]],
        ["Voltage readings", summary["counts"]["voltage_readings"]],
        ["Avg standardized voltage", summary["voltage_stats"]["mean"] if summary["voltage_stats"] else "n/a"],
        ["Avg shutdown duration (h)", summary["shutdown_stats"]["avg_duration_hours"]],
        ["Total shutdown hours", summary["shutdown_stats"]["total_hours"]],
        ["Avg DOL (days)", summary["dol_stats"]["mean_days"]],
    ]:
        ws.append(row)

    ws = wb.create_sheet("Shutdowns by Category")
    ws.append(["Category", "Count", "Total Hours"])
    for c in ws[1]:
        c.fill, c.font = header_fill, header_font
    for row in summary["shutdown_stats"]["by_category"]:
        ws.append([row["category"], row["count"], row["total_hours"]])

    ws = wb.create_sheet("Voltage Outliers")
    ws.append(["Label", "Standardized Voltage", "Z-Score"])
    for c in ws[1]:
        c.fill, c.font = header_fill, header_font
    for row in summary["voltage_outliers"]:
        ws.append([row["label"], row["value"], row["z_score"]])

    ws = wb.create_sheet("Voltage Trend")
    ws.append(["Period", "Avg Standardized Voltage", "Sample Count"])
    for c in ws[1]:
        c.fill, c.font = header_fill, header_font
    for row in trends["voltage_trend"]:
        ws.append([row["period"], row["avg_voltage"], row["count"]])

    ws = wb.create_sheet("Shutdown Trend")
    ws.append(["Period", "Count", "Total Hours"])
    for c in ws[1]:
        c.fill, c.font = header_fill, header_font
    for row in trends["shutdown_trend"]:
        ws.append([row["period"], row["count"], row["total_hours"]])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    name = f"report-{electrolyzer or 'plant'}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/export.pdf", include_in_schema=False)
def export_report_pdf(electrolyzer: str | None = None, db: Session = Depends(get_db)):
    summary = _build_summary(db, electrolyzer)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.5 * cm, bottomMargin=1.5 * cm)
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"Plant Report{' - ' + electrolyzer if electrolyzer else ''}", styles["Title"]),
        Paragraph(f"Generated: {summary['generated_at']}", styles["Normal"]),
        Spacer(1, 0.5 * cm),
        Paragraph("Key Metrics", styles["Heading2"]),
    ]

    kpi_rows = [
        ["Active elements", summary["counts"]["active_elements"]],
        ["Total elements", summary["counts"]["total_elements"]],
        ["Shutdowns", summary["counts"]["shutdowns"]],
        ["Voltage readings", summary["counts"]["voltage_readings"]],
        ["Avg standardized voltage", summary["voltage_stats"]["mean"] if summary["voltage_stats"] else "n/a"],
        ["Total shutdown hours", summary["shutdown_stats"]["total_hours"]],
        ["Avg shutdown duration (h)", summary["shutdown_stats"]["avg_duration_hours"]],
        ["Avg DOL (days)", summary["dol_stats"]["mean_days"]],
    ]
    kpi_table = Table([["Metric", "Value"]] + [[str(a), str(b)] for a, b in kpi_rows], colWidths=[9 * cm, 6 * cm])
    kpi_table.setStyle(_table_style())
    story += [kpi_table, Spacer(1, 0.6 * cm), Paragraph("Shutdowns by Category", styles["Heading2"])]

    cat_rows = [[c["category"], c["count"], c["total_hours"]] for c in summary["shutdown_stats"]["by_category"]]
    cat_table = Table([["Category", "Count", "Total Hours"]] + cat_rows, colWidths=[7 * cm, 4 * cm, 4 * cm])
    cat_table.setStyle(_table_style())
    story += [cat_table, Spacer(1, 0.6 * cm), Paragraph("Voltage Outliers (|z| >= 2.5)", styles["Heading2"])]

    outlier_rows = [[o["label"], o["value"], o["z_score"]] for o in summary["voltage_outliers"][:25]]
    if outlier_rows:
        outlier_table = Table([["Label", "Un (V)", "Z-Score"]] + outlier_rows, colWidths=[9 * cm, 4 * cm, 4 * cm])
        outlier_table.setStyle(_table_style())
        story.append(outlier_table)
    else:
        story.append(Paragraph("No significant outliers detected.", styles["Normal"]))

    doc.build(story)
    buf.seek(0)
    name = f"report-{electrolyzer or 'plant'}.pdf"
    return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _table_style() -> TableStyle:
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0A246A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#808080")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F0EFEA")]),
        ]
    )
