import csv
import io
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import require_admin
from ..calculations import standardized_voltage
from ..crud import build_crud_router
from ..database import get_db
from ..import_jobs import spawn_import


def _electrolyzer_aliases(name: str | None) -> list[str]:
    """Match plant names like 1A with LogSheets names like A1 (and vice versa)."""
    if not name:
        return []
    n = str(name).strip().upper()
    if not n:
        return []
    aliases = {n}
    letters = "".join(c for c in n if c.isalpha())
    digits = "".join(c for c in n if c.isdigit())
    if letters and digits:
        aliases.add(f"{letters}{digits}")
        aliases.add(f"{digits}{letters}")
    return list(aliases)


def _reading_value(row: models.VoltageReading) -> float | None:
    if row.standardized_voltage is not None:
        return float(row.standardized_voltage)
    if row.voltage is not None:
        return float(row.voltage)
    return None


def _filter_electrolyzer(query, column, electrolyzer: str | None):
    aliases = _electrolyzer_aliases(electrolyzer)
    if not aliases:
        return query
    return query.filter(func.upper(column).in_(aliases))


def _parse_day(value: str | date | datetime | None) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    if "T" in text:
        text = text.split("T", 1)[0]
    if " " in text:
        text = text.split(" ", 1)[0]
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _pos_key(pos: str | None):
    text = str(pos or "").strip()
    try:
        return (0, int(text))
    except ValueError:
        return (1, text)


def _select_readings(
    db: Session,
    electrolyzer: str | None,
    date_from: str | None = None,
    date_till: str | None = None,
) -> tuple[date | None, date | None, list[models.VoltageReading]]:
    """
    Readings for an electrolyzer.
    - no dates → latest reading day
    - only one bound → that single day
    - both → inclusive range
    """
    value_ok = or_(
        models.VoltageReading.standardized_voltage.isnot(None),
        models.VoltageReading.voltage.isnot(None),
    )
    start = _parse_day(date_from)
    end = _parse_day(date_till)
    if start and not end:
        end = start
    if end and not start:
        start = end

    q = db.query(models.VoltageReading).filter(value_ok)
    q = _filter_electrolyzer(q, models.VoltageReading.electrolyzer, electrolyzer)

    if start is None and end is None:
        date_q = db.query(func.max(models.VoltageReading.date)).filter(value_ok)
        date_q = _filter_electrolyzer(date_q, models.VoltageReading.electrolyzer, electrolyzer)
        max_date = date_q.scalar()
        if max_date is None:
            return None, None, []
        day = _parse_day(max_date)
        # SQLite stores datetimes as text; equality on Python datetime can miss rows.
        q = q.filter(func.date(models.VoltageReading.date) == func.date(max_date))
        rows = list(q.all())
        rows.sort(key=lambda r: (_pos_key(r.position), r.id or 0))
        return day, day, rows

    assert start is not None and end is not None
    if end < start:
        start, end = end, start
    q = q.filter(
        func.date(models.VoltageReading.date) >= start.isoformat(),
        func.date(models.VoltageReading.date) <= end.isoformat(),
    )
    rows = list(q.all())
    rows.sort(key=lambda r: (_parse_day(r.date) or date.min, _pos_key(r.position), r.id or 0))
    return start, end, rows

normalizations_router = build_crud_router(
    model=models.ElectrolyzerNormalization,
    read_schema=schemas.ElectrolyzerNormalizationRead,
    write_schema=schemas.ElectrolyzerNormalizationBase,
    prefix="/voltage-normalizations",
    tags=["voltage"],
    search_fields=["electrolyzer"],
    default_order="date",
)

readings_router = build_crud_router(
    model=models.VoltageReading,
    read_schema=schemas.VoltageReadingRead,
    write_schema=schemas.VoltageReadingBase,
    prefix="/voltage-readings",
    tags=["voltage"],
    search_fields=["electrolyzer", "position", "element_nr"],
    default_order="id",  # PK order — date.desc() on ~1.5M rows freezes Input Elements
)

# Replace generic GET list with a filtered/paginated one (Access-style browse).
_readings_get_routes = [
    route
    for route in readings_router.routes
    if getattr(route, "path", None) in {"", "/"} and "GET" in (getattr(route, "methods", set()) or set())
]
for route in _readings_get_routes:
    readings_router.routes.remove(route)


@readings_router.get("", response_model=list[schemas.VoltageReadingRead])
def list_voltage_readings(
    q: str | None = Query(default=None),
    electrolyzer: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_till: str | None = Query(default=None),
    skip: int = 0,
    limit: int = Query(default=500, le=2000),
    db: Session = Depends(get_db),
):
    """Browse recent readings. Always capped — never dump the full plant history."""
    query = db.query(models.VoltageReading)
    aliases = _electrolyzer_aliases(electrolyzer)
    if aliases:
        query = query.filter(func.upper(models.VoltageReading.electrolyzer).in_(aliases))
    start = _parse_day(date_from)
    end = _parse_day(date_till)
    if start and not end:
        end = start
    if end and not start:
        start = end
    if start and end:
        query = query.filter(
            func.date(models.VoltageReading.date) >= start.isoformat(),
            func.date(models.VoltageReading.date) <= end.isoformat(),
        )
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                models.VoltageReading.electrolyzer.ilike(like),
                models.VoltageReading.position.ilike(like),
                models.VoltageReading.element_nr.ilike(like),
            )
        )
    rows = query.order_by(models.VoltageReading.id.desc()).offset(skip).limit(limit).all()
    return [schemas.VoltageReadingRead.model_validate(r) for r in rows]


calc_router = APIRouter(prefix="/voltage", tags=["voltage"])


@calc_router.post("/calculate-standardized")
def calculate_standardized(
    u_meas: float,
    current_density: float,
    temp_meas: float,
    conc_meas: float,
    db: Session = Depends(get_db),
    reference_current_density: float | None = None,
    zero_voltage: float | None = None,
    temp_ref: float = 90.0,
    conc_ref: float | None = None,
):
    settings_row = db.query(models.PlantSettings).first()
    plant_type = settings_row.plant_type if settings_row else "NaOH"
    ref_cd = reference_current_density or (settings_row.reference_current_density if settings_row else (6.0 if plant_type == "NaOH" else 5.0))
    u0 = zero_voltage or (settings_row.zero_voltage if settings_row else (2.40 if plant_type == "NaOH" else 2.42))
    c_ref = conc_ref if conc_ref is not None else (32.0 if plant_type == "NaOH" else 28.5)

    factor = (
        db.query(models.CorrectionFactor)
        .filter(models.CorrectionFactor.reference_current_density == ref_cd)
        .first()
    )
    t_corr = factor.temp_correction if factor else (0.020 if plant_type == "NaOH" else 0.016)
    c_corr = factor.conc_correction if factor else (0.040 if plant_type == "NaOH" else 0.033)

    result = standardized_voltage(
        u_meas=u_meas,
        current_density=current_density,
        reference_current_density=ref_cd,
        zero_voltage=u0,
        temp_meas=temp_meas,
        temp_ref=temp_ref,
        conc_meas=conc_meas,
        conc_ref=c_ref,
        temp_correction=t_corr,
        conc_correction=c_corr,
    )
    return {"standardized_voltage": result.standardized_voltage, "inputs": result.inputs}


def _build_class_edges(ui_min: float, ui_max: float, step: float) -> list[tuple[str, float | None, float | None]]:
    """Access-style Un/Ui classes: <= min, then [x, x+step), finally >= max."""
    if step <= 0:
        step = 0.01
    if ui_max < ui_min:
        ui_min, ui_max = ui_max, ui_min
    edges: list[tuple[str, float | None, float | None]] = [
        (f"<= {ui_min:g}", None, ui_min),
    ]
    cursor = ui_min
    # Guard against float drift
    while cursor + step / 2 < ui_max:
        nxt = round(cursor + step, 6)
        if nxt > ui_max:
            break
        edges.append((f"{cursor:g} - {nxt:g}", cursor, nxt))
        cursor = nxt
    edges.append((f">= {ui_max:g}", ui_max, None))
    return edges


def _class_for_value(value: float, edges: list[tuple[str, float | None, float | None]]) -> str:
    for label, lo, hi in edges:
        if lo is None and hi is not None and value <= hi:
            return label
        if hi is None and lo is not None and value >= lo:
            return label
        if lo is not None and hi is not None and lo <= value < hi:
            return label
    return edges[-1][0] if edges else ""


@calc_router.get("/distribution")
def voltage_distribution(
    electrolyzer: str | None = None,
    date_from: str | None = None,
    date_till: str | None = None,
    ui_min: float = Query(default=3.0),
    ui_max: float = Query(default=3.4),
    step: float = Query(default=0.01),
    db: Session = Depends(get_db),
):
    """Access frmStatistikVerteilungUN: class histogram + detail rows (I, T, Ui, Un)."""
    start, end, readings = _select_readings(db, electrolyzer, date_from, date_till)

    # Parent normalization batches for I / temps / Co
    norm_keys = {
        (r.normalization_nr, (r.electrolyzer or "").strip().upper(), _parse_day(r.date), (r.time or "").strip())
        for r in readings
    }
    norms: dict[tuple, models.ElectrolyzerNormalization] = {}
    if readings:
        qn = db.query(models.ElectrolyzerNormalization)
        qn = _filter_electrolyzer(qn, models.ElectrolyzerNormalization.electrolyzer, electrolyzer)
        if start and end:
            qn = qn.filter(
                func.date(models.ElectrolyzerNormalization.date) >= start.isoformat(),
                func.date(models.ElectrolyzerNormalization.date) <= end.isoformat(),
            )
        for n in qn.all():
            key = (n.normalization_nr, (n.electrolyzer or "").strip().upper(), _parse_day(n.date), (n.time or "").strip())
            norms[key] = n
            # also index without normalization_nr / time for looser match
            norms[(None, key[1], key[2], key[3])] = n
            norms[(None, key[1], key[2], "")] = n

    edges = _build_class_edges(float(ui_min), float(ui_max), float(step))
    # Prefer configured plant classes when present and caller left defaults unused? Always use Access params.

    class_counts = {label: 0 for label, _, _ in edges}
    detail_rows = []
    values = []
    for r in readings:
        ui = float(r.voltage) if r.voltage is not None else None
        un = float(r.standardized_voltage) if r.standardized_voltage is not None else ui
        if un is None:
            continue
        values.append(un)
        class_label = _class_for_value(un, edges)
        class_counts[class_label] = class_counts.get(class_label, 0) + 1

        day = _parse_day(r.date)
        el_key = (r.electrolyzer or "").strip().upper()
        n = (
            norms.get((r.normalization_nr, el_key, day, (r.time or "").strip()))
            or norms.get((None, el_key, day, (r.time or "").strip()))
            or norms.get((None, el_key, day, ""))
        )
        i_total = n.total_current if n else None
        i_dens = n.reference_current_density if n else None
        if i_dens is None and i_total is not None:
            i_dens = float(i_total) / 2.7
        t_an = n.anolyte_temp if n else None
        t_ca = n.catholyte_temp if n else None
        tm = None
        if t_an is not None and t_ca is not None:
            tm = round((float(t_an) + float(t_ca)) / 2.0, 2)
        elif t_an is not None:
            tm = float(t_an)
        elif t_ca is not None:
            tm = float(t_ca)

        detail_rows.append(
            {
                "electrolyzer": r.electrolyzer,
                "position": r.position,
                "date": day.isoformat() if day else None,
                "time": r.time,
                "i_total": i_total,
                "i_density": round(float(i_dens), 3) if i_dens is not None else None,
                "co_pct": n.cl2_pct if n else None,
                "t_an": t_an,
                "t_ca": t_ca,
                "tm": tm,
                "ui": ui,
                "un": un,
                "class_label": class_label,
                "element_nr": r.element_nr,
            }
        )

    buckets = [
        {"label": label, "lower_bound": lo, "upper_bound": hi, "count": class_counts.get(label, 0)}
        for label, lo, hi in edges
    ]
    return {
        "electrolyzer": electrolyzer,
        "date": start.isoformat() if start and start == end else None,
        "date_from": start.isoformat() if start else None,
        "date_till": end.isoformat() if end else None,
        "ui_min": ui_min,
        "ui_max": ui_max,
        "step": step,
        "total_readings": len(values),
        "buckets": buckets,
        "class_sum": sum(b["count"] for b in buckets),
        "rows": detail_rows,
    }


@calc_router.get("/high-deviation")
def high_deviation_elements(
    threshold: float = Query(0.05, description="Fractional deviation from average, e.g. 0.05 = 5%"),
    threshold_mv: float | None = Query(
        None, description="Access-style absolute deviation in mV from electrolyzer average (e.g. 100)"
    ),
    electrolyzer: str | None = None,
    date_from: str | None = None,
    date_till: str | None = None,
    db: Session = Depends(get_db),
):
    """Elements whose voltage differs from the electrolyzer average by more than threshold.

    Access frmStatistikAbweichungUn uses absolute mV (default 100 mV). Prefer
    ``threshold_mv`` when provided; otherwise keep fractional ``threshold``.
    """
    use_mv = threshold_mv is not None
    try:
        thr_mv = float(threshold_mv) if use_mv else None
    except (TypeError, ValueError):
        thr_mv = 100.0
        use_mv = True
    try:
        thr = float(threshold)
    except (TypeError, ValueError):
        thr = 0.05
    start, end, readings = _select_readings(db, electrolyzer, date_from, date_till)
    valued = [(r, _reading_value(r)) for r in readings]
    valued = [(r, v) for r, v in valued if v is not None]
    empty = {
        "electrolyzer": electrolyzer,
        "date": start.isoformat() if start and start == end else None,
        "date_from": start.isoformat() if start else None,
        "date_till": end.isoformat() if end else None,
        "average": None,
        "threshold_pct": None if use_mv else thr * 100,
        "threshold_mv": thr_mv if use_mv else None,
        "flagged": [],
    }
    if not valued:
        return empty
    avg = sum(v for _, v in valued) / len(valued)

    def _is_high(v: float) -> bool:
        if use_mv:
            return abs(v - avg) * 1000.0 > (thr_mv or 0.0)
        return bool(avg) and abs(v - avg) / avg > thr

    flagged = [
        {
            "electrolyzer": r.electrolyzer,
            "position": r.position,
            "element_nr": r.element_nr,
            "date": (_parse_day(r.date).isoformat() if _parse_day(r.date) else None),
            "voltage": r.voltage,
            "standardized_voltage": r.standardized_voltage,
            "value": v,
            "deviation_pct": round((v - avg) / avg * 100, 2) if avg else None,
            "deviation_mv": round((v - avg) * 1000.0, 2),
        }
        for r, v in valued
        if _is_high(v)
    ]
    flagged.sort(
        key=lambda x: abs(x.get("deviation_mv") if use_mv else x.get("deviation_pct") or 0),
        reverse=True,
    )
    return {
        "electrolyzer": electrolyzer,
        "date": start.isoformat() if start and start == end else None,
        "date_from": start.isoformat() if start else None,
        "date_till": end.isoformat() if end else None,
        "average": round(avg, 4),
        "threshold_pct": None if use_mv else thr * 100,
        "threshold_mv": thr_mv if use_mv else None,
        "flagged": flagged,
    }


@calc_router.get("/element-voltages")
def element_voltages(
    electrolyzer: str = Query(..., min_length=1),
    date_from: str | None = None,
    date_till: str | None = None,
    db: Session = Depends(get_db),
):
    """Per-position voltages for a day or an inclusive date range."""
    start, end, readings = _select_readings(db, electrolyzer, date_from, date_till)
    rows = []
    values = []
    for r in readings:
        v = _reading_value(r)
        if v is None:
            continue
        values.append(v)
        day = _parse_day(r.date)
        rows.append(
            {
                "date": day.isoformat() if day else None,
                "position": r.position,
                "element_nr": r.element_nr,
                "voltage": r.voltage,
                "standardized_voltage": r.standardized_voltage,
                "value": v,
            }
        )
    avg = (sum(values) / len(values)) if values else None
    return {
        "electrolyzer": electrolyzer,
        "date": start.isoformat() if start and start == end else None,
        "date_from": start.isoformat() if start else None,
        "date_till": end.isoformat() if end else None,
        "count": len(rows),
        "average": round(avg, 4) if avg is not None else None,
        "min": round(min(values), 4) if values else None,
        "max": round(max(values), 4) if values else None,
        "rows": rows,
    }


@calc_router.post("/import")
async def import_voltage_csv(
    file: UploadFile,
    electrolyzer: str,
    reading_date: str,
):
    """
    Bulk import of per-position voltage readings from a CSV file with columns
    'position,voltage' (mirrors the manual's Excel import workflow, section 3.5).
    """
    content = await file.read()
    text = content.decode("utf-8-sig", errors="ignore")
    rows = list(csv.DictReader(io.StringIO(text)))

    def work(db: Session, progress):
        date_val = datetime.fromisoformat(reading_date)
        created = 0
        total = len(rows)
        if progress:
            progress(0, total)
        for done, row in enumerate(rows, start=1):
            position = row.get("position") or row.get("Position")
            voltage = row.get("voltage") or row.get("Voltage") or row.get("Ui")
            if position is not None and voltage not in (None, ""):
                try:
                    voltage_f = float(voltage)
                except ValueError:
                    voltage_f = None
                if voltage_f is not None:
                    db.add(
                        models.VoltageReading(
                            electrolyzer=electrolyzer,
                            position=position,
                            date=date_val,
                            voltage=voltage_f,
                        )
                    )
                    created += 1
            if progress and (done == total or done % 25 == 0):
                progress(done, total)
        db.commit()
        return {"imported_rows": created}

    return spawn_import(work)


@calc_router.post("/import-excel")
async def import_voltage_excel(
    file: UploadFile,
    electrolyzer: str | None = None,
    reading_date: str | None = None,
    _admin=Depends(require_admin),
):
    """Import SiteMan / F2 / ARIAORMS LogSheets Excel (upsert by electrolyzer+date+time+position)."""
    from .. import voltage_sync

    content = await file.read()
    filename = file.filename or ""

    def work(db: Session, progress):
        try:
            info = voltage_sync.apply_excel_bytes(
                db,
                content,
                electrolyzer=electrolyzer,
                reading_date=reading_date,
                hint_from_name=filename,
                progress=progress,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        db.commit()
        return {
            "imported_rows": info.get("rows_upserted"),
            "electrolyzer": info.get("electrolyzer"),
            "reading_date": info.get("reading_date"),
            "times": info.get("times") or [],
            "operators": info.get("operators") or [],
            "sheet": info.get("sheet"),
            "out_of_range_count": info.get("out_of_range_count") or 0,
            "mode": "upsert",
        }

    return spawn_import(work)


current_efficiency_router = build_crud_router(
    model=models.CurrentEfficiencyEntry,
    read_schema=schemas.CurrentEfficiencyEntryRead,
    write_schema=schemas.CurrentEfficiencyEntryBase,
    prefix="/current-efficiency-entries",
    tags=["current-efficiency"],
    default_order="date",
)

ce_calc_router = APIRouter(prefix="/current-efficiency", tags=["current-efficiency"])


@ce_calc_router.post("/calculate")
def calculate_current_efficiency(
    n_cells: int,
    current_ka: float,
    v_pure_brine: float | None = None,
    v_anolyte: float | None = None,
    c_naclo3_pb: float | None = None,
    c_naclo3_an: float | None = None,
    c_hocl_an: float | None = None,
    c_hcl_pb: float | None = None,
    c_hcl_an: float | None = None,
    c_naoh_pb: float | None = None,
    c_na2co3_pb: float | None = None,
    acidified: bool = False,
):
    from ..calculations import current_efficiency

    result = current_efficiency(
        n_cells=n_cells,
        current_ka=current_ka,
        v_pure_brine=v_pure_brine,
        v_anolyte=v_anolyte,
        c_naclo3_pb=c_naclo3_pb,
        c_naclo3_an=c_naclo3_an,
        c_hocl_an=c_hocl_an,
        c_hcl_pb=c_hcl_pb,
        c_hcl_an=c_hcl_an,
        c_naoh_pb=c_naoh_pb,
        c_na2co3_pb=c_na2co3_pb,
        acidified=acidified,
    )
    return result
