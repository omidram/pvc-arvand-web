"""AriaLims REST → Analysis samples (scaffold until API contract arrives)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import arialims_sync, models, schemas
from ..arialims_client import AriaLimsNotConfigured, endpoint_catalog
from ..database import get_db
from ..import_jobs import spawn_import

router = APIRouter(prefix="/arialims-sync", tags=["arialims-sync"])


def _get_or_create(db: Session) -> models.AriaLimsSyncSettings:
    return arialims_sync.get_or_create_settings(db)


def _to_read(obj: models.AriaLimsSyncSettings) -> schemas.AriaLimsSyncSettingsRead:
    data = schemas.AriaLimsSyncSettingsRead.model_validate(obj)
    data.password_set = bool(obj.password)
    data.api_token_set = bool(obj.api_token)
    data.contract_ready = False
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
    """Planned AriaLims analysis endpoints (all pending_contract until docs arrive)."""
    return {"items": endpoint_catalog(), "contract_ready": False}


@router.post("/test", response_model=schemas.AriaLimsTestResult)
def test_arialims_connection(db: Session = Depends(get_db)):
    row = _get_or_create(db)
    try:
        result = arialims_sync.ping(row)
    except AriaLimsNotConfigured as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return schemas.AriaLimsTestResult(**result)


@router.post("/run")
def run_arialims_sync_now(db: Session = Depends(get_db)):
    """Pull lab analyses from AriaLims (includes today). Scaffold returns pending_contract until API docs land."""
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


@router.post("/ingest-json")
def ingest_arialims_json(body: schemas.AriaLimsManualIngest, db: Session = Depends(get_db)):
    """Dev helper: paste a sample AriaLims JSON payload to exercise normalize/upsert before the live API exists."""
    try:
        return arialims_sync.apply_manual_payload(db, body.payload, analysis_type=body.analysis_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
