"""Admin-only view of database files, download, and local/online switch."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from .. import models
from ..auth import require_admin
from ..config import settings
from .. import db_connection as dbc

router = APIRouter(prefix="/database", tags=["database"], dependencies=[Depends(require_admin)])


class SwitchPayload(BaseModel):
    mode: str = "local"
    kind: str = "postgresql"
    host: str = ""
    port: int = 5432
    database: str = ""
    username: str = ""
    password: str | None = None
    sqlite_path: str = ""
    url: str = ""
    copy_data: bool = False


class TestPayload(BaseModel):
    kind: str = "postgresql"
    host: str = ""
    port: int = 5432
    database: str = ""
    username: str = ""
    password: str | None = None
    sqlite_path: str = ""
    url: str = ""


class RevealPayload(BaseModel):
    path: str = Field(min_length=1)


@router.get("/status")
def database_status(_admin: models.User = Depends(require_admin)):
    return dbc.inventory(live_url=settings.DATABASE_URL)


@router.post("/test")
def test_connection(payload: TestPayload, _admin: models.User = Depends(require_admin)):
    data = payload.model_dump()
    if data.get("password") in (None, ""):
        existing = dbc.load_profile().get("online") or {}
        if existing.get("password"):
            data["password"] = existing["password"]
    try:
        url = dbc.build_url(data)
        return dbc.test_url(url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/switch")
def switch_database(payload: SwitchPayload, _admin: models.User = Depends(require_admin)):
    try:
        return dbc.apply_switch(payload.model_dump(), live_url=settings.DATABASE_URL)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/download")
def download_database(_admin: models.User = Depends(require_admin)):
    try:
        path, filename, delete_after = dbc.make_download_file(settings.DATABASE_URL)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    background = BackgroundTask(path.unlink, missing_ok=True) if delete_after else None
    return FileResponse(
        path,
        filename=filename,
        media_type="application/octet-stream",
        background=background,
    )


@router.post("/reveal")
def reveal_database_path(payload: RevealPayload, _admin: models.User = Depends(require_admin)):
    requested = Path(payload.path)
    try:
        resolved = requested.resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    allowed = dbc.allowed_reveal_paths(settings.DATABASE_URL)
    if resolved not in allowed and requested not in {Path(p) for p in (str(x) for x in allowed)}:
        # Compare as resolved strings too — Windows path casing
        allowed_norm = {str(p).lower() for p in allowed}
        if str(resolved).lower() not in allowed_norm:
            raise HTTPException(status_code=400, detail="That path is not a known database file.")
    try:
        dbc.reveal_path(resolved)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True, "path": str(resolved)}
