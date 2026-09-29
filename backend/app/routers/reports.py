"""
Reports & Data Analysis.

Deterministic, in-process statistical analysis over the plant's own data:
KPI summaries, shutdown/voltage/current-efficiency trend series, and simple
z-score outlier detection - plus printable (PDF) / spreadsheet (Excel)
export of a full plant or per-electrolyzer report. No external services
or API keys required.
"""
import io
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
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from .. import models
from ..calculations import installation_dol
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


def _build_summary(db: Session, electrolyzer: str | None) -> dict:
    voltage_q = db.query(models.VoltageReading).filter(models.VoltageReading.standardized_voltage.isnot(None))
    shutdowns_q = db.query(models.Shutdown)
    elements_q = db.query(models.Element)
    ce_q = db.query(models.CurrentEfficiencyEntry).filter(models.CurrentEfficiencyEntry.value_pct.isnot(None))
    if electrolyzer:
        voltage_q = voltage_q.filter(models.VoltageReading.electrolyzer == electrolyzer)
        shutdowns_q = shutdowns_q.filter(models.Shutdown.plant_part == electrolyzer)
        elements_q = elements_q.filter(models.Element.electrolyzer == electrolyzer)
        ce_q = ce_q.filter(models.CurrentEfficiencyEntry.scope_ref == electrolyzer)

    readings = voltage_q.all()
    shutdowns = shutdowns_q.all()
    ce_entries = ce_q.all()

    voltages = [r.standardized_voltage for r in readings]
    voltage_stats = None
    voltage_outliers = []
    if voltages:
        voltage_stats = {
            "count": len(voltages),
            "mean": round(pystats.fmean(voltages), 4),
            "min": round(min(voltages), 4),
            "max": round(max(voltages), 4),
            "stdev": round(pystats.pstdev(voltages), 4) if len(voltages) > 1 else 0,
        }
        voltage_outliers = _zscore_outliers(
            [(f"{r.electrolyzer or '?'} / {r.position or r.element_nr or '?'}", r.standardized_voltage) for r in readings]
        )

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
    dol_values = [
        d for e in elements_q.all()
        if (d := installation_dol(e.assembly_date, e.commissioning_date, e.disassembly_date, e.decommissioning_date)) is not None
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
            "voltage_readings": len(readings),
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
    voltage_q = db.query(models.VoltageReading).filter(
        models.VoltageReading.standardized_voltage.isnot(None), models.VoltageReading.date.isnot(None)
    )
    shutdowns_q = db.query(models.Shutdown).filter(models.Shutdown.shutdown_time.isnot(None))
    if electrolyzer:
        voltage_q = voltage_q.filter(models.VoltageReading.electrolyzer == electrolyzer)
        shutdowns_q = shutdowns_q.filter(models.Shutdown.plant_part == electrolyzer)

    voltage_by_month: dict[str, list[float]] = defaultdict(list)
    for r in voltage_q.all():
        voltage_by_month[_month_key(r.date)].append(r.standardized_voltage)
    voltage_trend = [
        {"period": period, "avg_voltage": round(pystats.fmean(vals), 4), "count": len(vals)}
        for period, vals in sorted(voltage_by_month.items())
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
    return _build_summary(db, electrolyzer)


@router.get("/trends")
def report_trends(electrolyzer: str | None = None, db: Session = Depends(get_db)):
    return _build_trends(db, electrolyzer)


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
