"""
Bulk data import: a full Access (.mdb/.accdb) database, or a generic Excel
sheet for a single resource table. Both support "replace" (wipe target
table(s) first) or "merge"/"append" (keep existing rows, add new ones).
"""
import io
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from openpyxl import load_workbook
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import require_form_access
from ..database import get_db
from ..migrate_access import run_migration

router = APIRouter(prefix="/data", tags=["data-transfer"], dependencies=[Depends(require_form_access("import_export"))])


IMPORTABLE_RESOURCES: dict[str, tuple[type, type]] = {
    "elements": (models.Element, schemas.ElementBase),
    "anodes": (models.Anode, schemas.AnodeBase),
    "cathodes": (models.Cathode, schemas.CathodeBase),
    "membranes": (models.Membrane, schemas.MembraneBase),
    "shutdowns": (models.Shutdown, schemas.ShutdownBase),
    "remarks": (models.Remark, schemas.RemarkBase),
    "inspections": (models.InspectionReport, schemas.InspectionReportBase),
    "analyses": (models.AnalysisSample, schemas.AnalysisSampleBase),
    "voltage_readings": (models.VoltageReading, schemas.VoltageReadingBase),
    "voltage_normalizations": (models.ElectrolyzerNormalization, schemas.ElectrolyzerNormalizationBase),
    "current_efficiency_entries": (models.CurrentEfficiencyEntry, schemas.CurrentEfficiencyEntryBase),
}


@router.get("/importable-resources")
def importable_resources():
    return sorted(IMPORTABLE_RESOURCES.keys())


@router.post("/import/access")
async def import_access_file(
    file: UploadFile,
    mode: str = Query(default="replace", pattern="^(replace|merge)$"),
):
    if not file.filename or not file.filename.lower().endswith((".mdb", ".accdb")):
        raise HTTPException(status_code=400, detail="File must be a .mdb or .accdb Access database")

    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    log: list[str] = []
    try:
        result = run_migration(db_path=tmp_path, mode=mode, progress=log.append)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Import failed: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return {"ok": True, "mode": result["mode"], "log": log}


def _normalize_key(key: str) -> str:
    return key.strip().lower().replace(" ", "_").replace("-", "_")


@router.post("/import/excel/{resource}")
async def import_excel(
    resource: str,
    file: UploadFile,
    mode: str = Query(default="merge", pattern="^(replace|merge)$"),
    db: Session = Depends(get_db),
):
    if resource not in IMPORTABLE_RESOURCES:
        raise HTTPException(status_code=400, detail=f"Unknown resource. Choose one of: {sorted(IMPORTABLE_RESOURCES)}")
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="File must be an .xlsx Excel workbook")

    model, write_schema = IMPORTABLE_RESOURCES[resource]
    valid_fields = set(write_schema.model_fields.keys())

    content = await file.read()
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header = next(rows_iter)
    except StopIteration:
        raise HTTPException(status_code=400, detail="Sheet is empty")

    normalized_header = [_normalize_key(str(h)) if h is not None else None for h in header]
    matched_columns = {i: h for i, h in enumerate(normalized_header) if h in valid_fields}
    if not matched_columns:
        raise HTTPException(
            status_code=400,
            detail=f"No matching columns found. Expected headers (any subset of): {sorted(valid_fields)}",
        )

    if mode == "replace":
        db.query(model).delete()
        db.commit()

    imported, skipped, errors = 0, 0, []
    for row in rows_iter:
        if row is None or all(v is None for v in row):
            continue
        raw = {matched_columns[i]: row[i] for i in matched_columns if i < len(row)}
        raw = {k: v for k, v in raw.items() if v is not None and v != ""}
        if not raw:
            continue
        try:
            payload = write_schema(**raw)
            db.add(model(**payload.model_dump()))
            imported += 1
        except Exception as exc:  # noqa: BLE001
            skipped += 1
            if len(errors) < 20:
                errors.append(str(exc))
    db.commit()

    return {"ok": True, "imported": imported, "skipped": skipped, "errors": errors}
