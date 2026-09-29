"""
Bulk data import: a full Access (.mdb/.accdb) database, or a generic Excel
sheet for a single resource table. Both support "replace" (wipe target
table(s) first) or "merge"/"append" (keep existing rows, add new ones).
"""
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import require_form_access
from ..excel_import import import_excel_bytes, read_xlsx
from ..import_jobs import spawn_import
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


_RESOURCE_PK = {
    "elements": "id",
    "anodes": "anode_nr",
    "cathodes": "cathode_nr",
    "membranes": "membrane_nr",
    "shutdowns": "nr",
    "remarks": "id",
    "inspections": "id",
    "analyses": "id",
    "voltage_readings": "id",
    "voltage_normalizations": "id",
    "current_efficiency_entries": "id",
}


@router.post("/import/excel/{resource}")
async def import_excel(
    resource: str,
    file: UploadFile,
    mode: str = Query(default="merge", pattern="^(replace|merge)$"),
):
    if resource not in IMPORTABLE_RESOURCES:
        raise HTTPException(status_code=400, detail=f"Unknown resource. Choose one of: {sorted(IMPORTABLE_RESOURCES)}")
    model, write_schema = IMPORTABLE_RESOURCES[resource]
    content = await read_xlsx(file)
    pk_field = _RESOURCE_PK.get(resource, "id")

    def work(db: Session, progress):
        result = import_excel_bytes(
            db,
            model,
            write_schema,
            content,
            pk_field=pk_field,
            mode=mode,
            progress=progress,
        )
        result["imported"] = result["created"]
        return result

    return spawn_import(work)
