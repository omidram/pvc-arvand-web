"""AriaLIMS REST → Analysis samples (sampling points, preview, pull)."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import arialims_sync, models, schemas
from ..arialims_client import ANALYSIS_TYPES, AriaLimsNotConfigured, endpoint_catalog
from ..database import get_db
from ..excel_import import read_xlsx
from ..import_jobs import spawn_import

router = APIRouter(prefix="/arialims-sync", tags=["arialims-sync"])


def _get_or_create(db: Session) -> models.AriaLimsSyncSettings:
    return arialims_sync.get_or_create_settings(db)


def _to_read(obj: models.AriaLimsSyncSettings) -> schemas.AriaLimsSyncSettingsRead:
    data = schemas.AriaLimsSyncSettingsRead.model_validate(obj)
    data.password_set = bool(obj.password)
    data.api_token_set = bool(obj.api_token)
    data.contract_ready = True
    data.catalog = endpoint_catalog()
    try:
        from .. import arialims_sync_scheduler

        data.next_run_at = arialims_sync_scheduler.get_next_run_at() if obj.enabled else None
    except Exception:  # noqa: BLE001
        data.next_run_at = None
    return data


@router.get("/settings", response_model=schemas.AriaLimsSyncSettingsRead)
def get_arialims_sync_settings(db: Session = Depends(get_db)):
    return _to_read(_get_or_create(db))


@router.put("/settings", response_model=schemas.AriaLimsSyncSettingsRead)
def update_arialims_sync_settings(
    payload: schemas.AriaLimsSyncSettingsUpdate,
    db: Session = Depends(get_db),
):
    obj = _get_or_create(db)
    data = payload.model_dump(exclude_unset=True)
    password = data.pop("password", None)
    api_token = data.pop("api_token", None)
    for key, value in data.items():
        setattr(obj, key, value)
    if password is not None and str(password).strip() != "":
        obj.password = str(password)
    if api_token is not None and str(api_token).strip() != "":
        obj.api_token = str(api_token)
    if not (obj.daily_time or "").strip():
        obj.daily_time = "01:00"
    db.commit()
    db.refresh(obj)
    try:
        from .. import arialims_sync_scheduler

        arialims_sync_scheduler.apply_schedule(obj)
    except Exception:  # noqa: BLE001
        pass
    return _to_read(obj)


@router.get("/catalog")
def get_arialims_catalog():
    return {"items": endpoint_catalog(), "contract_ready": True, "analysis_types": list(ANALYSIS_TYPES.keys())}


@router.post("/test", response_model=schemas.AriaLimsTestResult)
def test_arialims_connection(db: Session = Depends(get_db)):
    row = _get_or_create(db)
    try:
        result = arialims_sync.ping(db, row)
    except AriaLimsNotConfigured as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return schemas.AriaLimsTestResult(**result)


@router.post("/run")
def run_arialims_sync_now(db: Session = Depends(get_db)):
    """Pull lab analyses for every enabled sampling point (includes today)."""
    _get_or_create(db)

    def work(session: Session, progress):
        row = session.query(models.AriaLimsSyncSettings).first()
        return arialims_sync.pull_from_arialims(
            session,
            row,
            include_today=True,
            progress=progress,
        )

    return spawn_import(work)


@router.post("/preview")
def preview_arialims_point(body: schemas.AriaLimsPreviewRequest, db: Session = Depends(get_db)):
    """Ask AriaLIMS for one SCID (nothing is saved) so the point can be mapped."""
    row = _get_or_create(db)
    try:
        return arialims_sync.preview_point(db, row, body.scid, body.days)
    except AriaLimsNotConfigured as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _clean_point(payload: schemas.AriaLimsSamplingPointBase) -> dict:
    data = payload.model_dump()
    if data["analysis_type"] not in ANALYSIS_TYPES:
        raise HTTPException(status_code=400, detail=f"analysis_type must be one of {sorted(ANALYSIS_TYPES)}")
    if data["scope"] not in arialims_sync.VALID_SCOPES:
        raise HTTPException(status_code=400, detail=f"scope must be one of {sorted(arialims_sync.VALID_SCOPES)}")
    for key in ("name", "electrolyzer", "position", "group_nr", "sub_plant"):
        data[key] = (data[key] or "").strip() or None
    data["parameter_map"] = {
        str(k).strip(): str(v).strip() for k, v in (data["parameter_map"] or {}).items() if str(k).strip() and str(v).strip()
    }
    return data


@router.post("/points/import-xlsx")
async def import_sampling_points(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Load the AriaLIMS sample-point list (SCID, SCNo, Location, UnitID, UnitTag)."""
    content = await read_xlsx(file)
    try:
        entries = arialims_sync.parse_sample_points_xlsx(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not entries:
        raise HTTPException(status_code=400, detail="No sample points found in the file")
    return arialims_sync.import_sample_points(db, entries)


@router.get("/points", response_model=list[schemas.AriaLimsSamplingPointRead])
def list_sampling_points(db: Session = Depends(get_db)):
    return db.query(models.AriaLimsSamplingPoint).order_by(models.AriaLimsSamplingPoint.scid).all()


@router.post("/points", response_model=schemas.AriaLimsSamplingPointRead, status_code=201)
def create_sampling_point(payload: schemas.AriaLimsSamplingPointBase, db: Session = Depends(get_db)):
    data = _clean_point(payload)
    if db.query(models.AriaLimsSamplingPoint).filter(models.AriaLimsSamplingPoint.scid == data["scid"]).first():
        raise HTTPException(status_code=409, detail=f"SCID {data['scid']} is already configured")
    obj = models.AriaLimsSamplingPoint(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/points/{point_id}", response_model=schemas.AriaLimsSamplingPointRead)
def update_sampling_point(point_id: int, payload: schemas.AriaLimsSamplingPointBase, db: Session = Depends(get_db)):
    obj = db.query(models.AriaLimsSamplingPoint).filter(models.AriaLimsSamplingPoint.id == point_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    data = _clean_point(payload)
    clash = (
        db.query(models.AriaLimsSamplingPoint)
        .filter(models.AriaLimsSamplingPoint.scid == data["scid"], models.AriaLimsSamplingPoint.id != point_id)
        .first()
    )
    if clash:
        raise HTTPException(status_code=409, detail=f"SCID {data['scid']} is already configured")
    for key, value in data.items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/points/{point_id}", status_code=204)
def delete_sampling_point(point_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.AriaLimsSamplingPoint).filter(models.AriaLimsSamplingPoint.id == point_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(obj)
    db.commit()
    return None


@router.post("/ingest-json")
def ingest_arialims_json(body: schemas.AriaLimsManualIngest, db: Session = Depends(get_db)):
    """Paste an AriaLIMS response (``{"results": [...]}``) to load it without calling the API."""
    try:
        return arialims_sync.apply_manual_payload(db, body.payload, analysis_type=body.analysis_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
